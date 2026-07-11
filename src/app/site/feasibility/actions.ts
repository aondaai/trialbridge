"use server";

/**
 * Review workspace HITL actions (F4-3). Every mutation goes through the pure review.ts logic
 * (so archetype-D can't be auto-approved) and writes an AuditLog row. Server actions, form-based
 * — no client JS required. `actor` is the demo coordinator (a human, so D approval is allowed).
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  approveAnswer,
  editAnswer,
  bulkApproveHighConfidence,
  type ReviewAnswer,
} from "@/lib/feasibility-autofill/review";
import { makeAuditEntry } from "@/lib/feasibility-autofill/audit";
import type { Archetype } from "@/lib/feasibility-autofill/fixtures/questionBankLabels";
import { orchestrateAutofill } from "@/lib/feasibility-autofill/mcp/orchestrator";
import { buildInProcessDeps } from "@/lib/feasibility-autofill/inProcessDeps";
import { persistAnswers } from "@/lib/feasibility-autofill/persist";
import type { CellType, FormFieldDraft } from "@/lib/feasibility-autofill/ingest";
import type { Criterion } from "@/lib/matcher/types";
import { loadLearnedSynonyms, persistLearnedSynonym, persistApprovedNarrative } from "@/lib/feasibility-autofill/learnPersist";

const ACTOR = "camila"; // the site coordinator (a human — required for approving D)
const SITE = "site-ihealth-demo"; // the authenticated tenant (no auth yet — scope everything to it)
const NOW = () => new Date().toISOString();

/** Load a FieldAnswer (+ its field's archetype) into the pure ReviewAnswer shape. Tenant-scoped. */
async function toReviewAnswer(faId: string) {
  const fa = await prisma.fieldAnswer.findFirst({ where: { id: faId, siteId: SITE } });
  if (!fa) return null;
  const ff = await prisma.formField.findFirst({ where: { id: fa.fieldId, siteId: SITE } });
  if (!ff) return null;
  const ra: ReviewAnswer = {
    fieldId: fa.id,
    archetype: ff.archetype as Archetype,
    status: fa.status as ReviewAnswer["status"],
    confidence: fa.confidence as ReviewAnswer["confidence"],
    reviewerId: fa.reviewerId,
    version: fa.version,
  };
  return { fa, ff, ra };
}

async function writeAudit(entityId: string, action: string, siteId: string, before: unknown, after: unknown) {
  const e = makeAuditEntry({
    siteId, entity: "FieldAnswer", entityId, action, actor: ACTOR,
    before: before as Record<string, unknown>, after: after as Record<string, unknown>, at: NOW(),
  });
  await prisma.auditLog.create({ data: { siteId: e.siteId, entity: e.entity, entityId: e.entityId, action: e.action, actor: e.actor, diff: e.diff } });
}

/** US-2: run the orchestrator on a received request (in-process deps, no key) and persist answers. */
export async function runAutofill(formData: FormData): Promise<void> {
  const requestId = String(formData.get("requestId"));
  const request = await prisma.feasibilityRequest.findFirst({ where: { id: requestId, siteId: SITE } });
  if (!request) return;
  // Re-filling discards any prior (incl. approved) answers — record that in the audit trail.
  const priorApproved = await prisma.fieldAnswer.count({ where: { siteId: SITE, fieldId: { in: (await prisma.formField.findMany({ where: { requestId }, select: { id: true } })).map((f) => f.id) }, status: "approved" } });
  if (priorApproved > 0) await writeAudit(requestId, "autofill-reset", SITE, { approvedAnswers: priorApproved }, { approvedAnswers: 0 });
  const fields = await prisma.formField.findMany({ where: { requestId }, orderBy: { orderIdx: "asc" } });
  const drafts: FormFieldDraft[] = fields.map((f) => ({
    section: f.section, label: f.label, cellType: f.cellType as CellType, archetypeHint: f.archetype as Archetype, orderIdx: f.orderIdx,
  }));
  const criteria = safeParse(request.criteria) as Criterion[] | null;
  const learnedSynonyms = await loadLearnedSynonyms(); // US-6: the KB improves each run
  const deps = buildInProcessDeps(NOW());
  const result = await orchestrateAutofill({ siteId: request.siteId, fields: drafts, criteria: criteria ?? [], learnedSynonyms }, deps);
  await persistAnswers(requestId, request.siteId, result);
  await prisma.feasibilityRequest.update({ where: { id: requestId }, data: { status: "filled" } });
  revalidatePath("/site/feasibility");
}

export async function approveField(formData: FormData): Promise<void> {
  const faId = String(formData.get("fieldId"));
  const loaded = await toReviewAnswer(faId);
  if (!loaded) return;
  const next = approveAnswer(loaded.ra, ACTOR); // throws if D + non-human — never here (ACTOR is human)
  await prisma.fieldAnswer.update({ where: { id: faId }, data: { status: next.status, reviewerId: next.reviewerId, version: next.version } });
  await writeAudit(faId, "approve", loaded.fa.siteId, { status: loaded.ra.status }, { status: next.status });

  // US-6 learn: an APPROVED D answer becomes a prior-form exemplar. Index the CURRENT value
  // (the human's edit if editField changed it), not the original draft in sourceRef.
  if (loaded.ff.archetype === "D") {
    const current = safeParse(loaded.fa.value); // FieldAnswer.value = the (possibly edited) answer text
    const ref = safeParse(loaded.ff.sourceRef ?? "null") as { narrativeDraft?: string | null } | null;
    const answerText = typeof current === "string" && current.trim() ? current : ref?.narrativeDraft ?? "";
    if (answerText.trim()) {
      await persistApprovedNarrative(
        { siteId: loaded.fa.siteId, section: loaded.ff.section, label: loaded.ff.label, answerText, status: "approved" },
        NOW(),
      );
    }
  }
  revalidatePath("/site/feasibility");
}

/** US-6: map an unmapped field to a concept — persists the phrasing as a learned synonym. */
export async function mapConcept(formData: FormData): Promise<void> {
  const faId = String(formData.get("fieldId"));
  const conceptId = String(formData.get("conceptId") || "").trim();
  const loaded = await toReviewAnswer(faId);
  if (!loaded || !conceptId) return;
  await persistLearnedSynonym(conceptId, loaded.ff.label);
  await prisma.formField.update({ where: { id: loaded.ff.id }, data: { conceptId } });
  await writeAudit(faId, "map-concept", loaded.fa.siteId, { conceptId: loaded.ff.conceptId }, { conceptId });
  revalidatePath("/site/feasibility");
}

export async function rejectField(formData: FormData): Promise<void> {
  const faId = String(formData.get("fieldId"));
  const loaded = await toReviewAnswer(faId);
  if (!loaded) return;
  await prisma.fieldAnswer.update({ where: { id: faId }, data: { status: "rejected", reviewerId: ACTOR, version: loaded.ra.version + 1 } });
  await writeAudit(faId, "reject", loaded.fa.siteId, { status: loaded.ra.status }, { status: "rejected" });
  revalidatePath("/site/feasibility");
}

export async function editField(formData: FormData): Promise<void> {
  const faId = String(formData.get("fieldId"));
  const value = String(formData.get("value") ?? "").trim();
  const loaded = await toReviewAnswer(faId);
  if (!loaded) return;
  const next = editAnswer(loaded.ra, ACTOR); // → status "edited" (needs re-approval to ship)
  // Update the stored value + the metric's value inside provenance, keeping provenance intact.
  const metric = safeParse(loaded.fa.provenance) as Record<string, unknown> | null;
  if (metric) metric.value = value;
  await prisma.fieldAnswer.update({
    where: { id: faId },
    data: { status: next.status, reviewerId: ACTOR, version: next.version, value: JSON.stringify(value), provenance: JSON.stringify(metric ?? {}) },
  });
  await writeAudit(faId, "edit", loaded.fa.siteId, { status: loaded.ra.status }, { status: next.status, value });
  revalidatePath("/site/feasibility");
}

export async function approveHighConfidence(formData: FormData): Promise<void> {
  const requestId = String(formData.get("requestId"));
  const fields = await prisma.formField.findMany({ where: { requestId, siteId: SITE } });
  const answers = await prisma.fieldAnswer.findMany({ where: { siteId: SITE, fieldId: { in: fields.map((f) => f.id) } } });
  const archByField = new Map(fields.map((f) => [f.id, f.archetype as Archetype]));
  const ras: ReviewAnswer[] = answers.map((a) => ({
    fieldId: a.id, archetype: archByField.get(a.fieldId) ?? "D",
    status: a.status as ReviewAnswer["status"], confidence: a.confidence as ReviewAnswer["confidence"], version: a.version,
  }));
  const { approved } = bulkApproveHighConfidence(ras, ACTOR); // excludes D + non-high-confidence by construction
  for (const a of approved) {
    await prisma.fieldAnswer.update({ where: { id: a.fieldId }, data: { status: a.status, reviewerId: a.reviewerId, version: a.version } });
    await writeAudit(a.fieldId, "approve-bulk", fields[0]?.siteId ?? "", { status: "proposed" }, { status: "approved" });
  }
  revalidatePath("/site/feasibility");
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
