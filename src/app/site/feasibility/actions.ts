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

const ACTOR = "camila"; // the site coordinator (a human — required for approving D)
const NOW = () => new Date().toISOString();

/** Load a FieldAnswer (+ its field's archetype) into the pure ReviewAnswer shape. */
async function toReviewAnswer(faId: string) {
  const fa = await prisma.fieldAnswer.findUnique({ where: { id: faId } });
  if (!fa) return null;
  const ff = await prisma.formField.findUnique({ where: { id: fa.fieldId } });
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

export async function approveField(formData: FormData): Promise<void> {
  const faId = String(formData.get("fieldId"));
  const loaded = await toReviewAnswer(faId);
  if (!loaded) return;
  const next = approveAnswer(loaded.ra, ACTOR); // throws if D + non-human — never here (ACTOR is human)
  await prisma.fieldAnswer.update({ where: { id: faId }, data: { status: next.status, reviewerId: next.reviewerId, version: next.version } });
  await writeAudit(faId, "approve", loaded.fa.siteId, { status: loaded.ra.status }, { status: next.status });
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
  const fields = await prisma.formField.findMany({ where: { requestId } });
  const answers = await prisma.fieldAnswer.findMany({ where: { fieldId: { in: fields.map((f) => f.id) } } });
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
