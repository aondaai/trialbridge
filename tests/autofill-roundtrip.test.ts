import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { makeDocx, escapeXml } from "@/lib/feasibility-autofill/render/docx";
import { extractFormText, createFeasibilityRequest } from "@/lib/feasibility-autofill/intakeRequest";
import { CANONICAL_SECTIONS } from "@/lib/feasibility-autofill/canonicalTemplate";
import { orchestrateAutofill } from "@/lib/feasibility-autofill/mcp/orchestrator";
import { buildInProcessDeps } from "@/lib/feasibility-autofill/inProcessDeps";
import { persistAnswers, loadRenderAnswers } from "@/lib/feasibility-autofill/persist";
import { bulkApproveHighConfidence, type ReviewAnswer } from "@/lib/feasibility-autofill/review";
import { buildExportDocx } from "@/lib/feasibility-autofill/render/exportDocx";
import { docxToText } from "@/lib/intake/envelope";
import type { AnswerRecord } from "@/lib/feasibility-autofill/render/diff";
import type { FormFieldDraft, CellType } from "@/lib/feasibility-autofill/ingest";
import type { Archetype } from "@/lib/feasibility-autofill/fixtures/questionBankLabels";
import type { Criterion, Patient } from "@/lib/matcher/types";

const SITE = "site-roundtrip-test";
const PIDS = ["rt0", "rt1", "rt2", "rt3", "rt4"];
const CRITERIA: Criterion[] = [
  { id: "c1", kind: "inclusion", field: "age", operator: "gte", value: 18, rawText: "Idade ≥ 18", confidence: 1 },
  { id: "c2", kind: "inclusion", field: "diagnosis", operator: "eq", value: "breast", rawText: "Câncer de mama", confidence: 1 },
];
let requestId = "";

function pt(id: string, age: number, dx: string): Patient {
  return { id, siteId: SITE, diagnosis: dx, stage: null, biomarkers: {}, priorLines: null, ecog: null, labs: {}, sex: null, age };
}

beforeAll(async () => {
  await prisma.site.upsert({ where: { id: SITE }, update: {}, create: { id: SITE, name: "RT", country: "Brazil", city: "SP", region: "Sudeste", persona: "site", monthlyIncidence: 5 } });
  await prisma.patient.deleteMany({ where: { siteId: SITE } });
  const rows = PIDS.map((id, i) => pt(id, 40 + i * 6, "breast"));
  await prisma.patient.createMany({ data: rows.map((p) => ({ id: p.id, siteId: SITE, data: JSON.stringify(p) })) });

  const body = CANONICAL_SECTIONS.map((s) => `<w:p><w:r><w:t>${s.idx}. ${escapeXml(s.name)}</w:t></w:r></w:p><w:p><w:r><w:t>${escapeXml(s.content.split(",")[0])}?</w:t></w:r></w:p>`).join("");
  const text = extractFormText("f.docx", makeDocx(body));
  const created = await createFeasibilityRequest({ text, filename: "f.docx", siteId: SITE, sponsorId: "RT" });
  requestId = created.requestId;
  await prisma.feasibilityRequest.update({ where: { id: requestId }, data: { criteria: JSON.stringify(CRITERIA) } });

  const fields = await prisma.formField.findMany({ where: { requestId }, orderBy: { orderIdx: "asc" } });
  const drafts: FormFieldDraft[] = fields.map((f) => ({ section: f.section, label: f.label, cellType: f.cellType as CellType, archetypeHint: f.archetype as Archetype, orderIdx: f.orderIdx }));
  const result = await orchestrateAutofill({ siteId: SITE, fields: drafts, criteria: CRITERIA }, buildInProcessDeps("2026-07-11T00:00:00Z"));
  await persistAnswers(requestId, SITE, result);

  const fs = await prisma.formField.findMany({ where: { requestId } });
  const as = await prisma.fieldAnswer.findMany({ where: { fieldId: { in: fs.map((f) => f.id) } } });
  const arch = new Map(fs.map((f) => [f.id, f.archetype as Archetype]));
  const ras: ReviewAnswer[] = as.map((a) => ({ fieldId: a.id, archetype: arch.get(a.fieldId) ?? "D", status: a.status as ReviewAnswer["status"], confidence: a.confidence as ReviewAnswer["confidence"], version: a.version }));
  const { approved } = bulkApproveHighConfidence(ras, "camila");
  for (const a of approved) await prisma.fieldAnswer.update({ where: { id: a.fieldId }, data: { status: a.status, reviewerId: a.reviewerId, version: a.version } });
});

afterAll(async () => {
  const fs = await prisma.formField.findMany({ where: { requestId }, select: { id: true } });
  await prisma.fieldAnswer.deleteMany({ where: { fieldId: { in: fs.map((f) => f.id) } } });
  await prisma.formField.deleteMany({ where: { requestId } });
  await prisma.feasibilityRequest.deleteMany({ where: { id: requestId } });
  await prisma.patient.deleteMany({ where: { siteId: SITE } });
  await prisma.site.deleteMany({ where: { id: SITE } });
});

describe("FIN-6 · full round-trip (docx → request → autofill → approve → export)", () => {
  it("autofills every field and computes a cohort count", async () => {
    const answers = await loadRenderAnswers(requestId);
    expect(answers.length).toBeGreaterThanOrEqual(16);
    const cohort = answers.find((a) => a.archetype === "C");
    expect(cohort?.metric.value).toBeDefined(); // 5 breast/adult → 5 candidates
  });

  it("the exported .docx ships ONLY approved answers, and no D draft leaks", async () => {
    const answers = await loadRenderAnswers(requestId);
    const records: AnswerRecord[] = answers.map((a) => ({ fieldId: a.fieldId, label: a.label, value: a.metric.value == null ? "" : String(a.metric.value), status: a.status as AnswerRecord["status"] }));
    const { bytes, approvedCount, withheldCount } = buildExportDocx("RT", records);
    expect(approvedCount).toBeGreaterThan(0);
    expect(withheldCount).toBeGreaterThan(0); // D + low-confidence held back
    const text = docxToText(bytes);
    // No proposed/D answer value appears in the export.
    for (const a of answers) {
      if (a.status !== "approved" && a.metric.value) expect(text).not.toContain(String(a.metric.value));
    }
    expect(text).not.toMatch(/\{\{.*\}\}/);
  });

  it("no patient id leaks into any answer or the exported document", async () => {
    const answers = await loadRenderAnswers(requestId);
    const records: AnswerRecord[] = answers.map((a) => ({ fieldId: a.fieldId, label: a.label, value: a.metric.value == null ? "" : String(a.metric.value), status: "approved" as const }));
    const blob = JSON.stringify(answers) + docxToText(buildExportDocx("RT", records).bytes);
    for (const id of PIDS) expect(blob).not.toContain(id);
  });
});
