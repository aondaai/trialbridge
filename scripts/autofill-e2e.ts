/**
 * Headless round-trip driver (npm run autofill:e2e). Drives the whole user loop end to end with
 * NO API key — docx → request → autofill → approve → export — and prints a summary the goal
 * evaluator can read. Deterministic A/B/C + template D; cohort runs in-process (aggregates only).
 */

import { prisma } from "../src/lib/db";
import { makeDocx } from "../src/lib/feasibility-autofill/render/docx";
import { extractFormText, createFeasibilityRequest } from "../src/lib/feasibility-autofill/intakeRequest";
import { CANONICAL_SECTIONS } from "../src/lib/feasibility-autofill/canonicalTemplate";
import { orchestrateAutofill } from "../src/lib/feasibility-autofill/mcp/orchestrator";
import { buildInProcessDeps } from "../src/lib/feasibility-autofill/inProcessDeps";
import { persistAnswers, loadRenderAnswers } from "../src/lib/feasibility-autofill/persist";
import { loadLearnedSynonyms } from "../src/lib/feasibility-autofill/learnPersist";
import { bulkApproveHighConfidence, type ReviewAnswer } from "../src/lib/feasibility-autofill/review";
import { buildExportDocx } from "../src/lib/feasibility-autofill/render/exportDocx";
import { escapeXml } from "../src/lib/feasibility-autofill/render/docx";
import type { FormFieldDraft, CellType } from "../src/lib/feasibility-autofill/ingest";
import type { Archetype } from "../src/lib/feasibility-autofill/fixtures/questionBankLabels";
import type { AnswerRecord } from "../src/lib/feasibility-autofill/render/diff";
import type { Criterion, Patient } from "../src/lib/matcher/types";

const SITE = "site-e2e";
const ASOF = "2026-07-11T00:00:00Z";
const CRITERIA: Criterion[] = [
  { id: "c1", kind: "inclusion", field: "age", operator: "gte", value: 18, rawText: "Idade ≥ 18", confidence: 1 },
  { id: "c2", kind: "inclusion", field: "diagnosis", operator: "eq", value: "breast", rawText: "Câncer de mama", confidence: 1 },
];

function patient(id: string, age: number, diagnosis: string): Patient {
  return { id, siteId: SITE, diagnosis, stage: null, biomarkers: {}, priorLines: null, ecog: null, labs: {}, sex: null, age };
}

async function ensureSite() {
  await prisma.site.upsert({
    where: { id: SITE },
    update: {},
    create: { id: SITE, name: "E2E site", country: "Brazil", city: "São Paulo", region: "Sudeste", persona: "site", monthlyIncidence: 6 },
  });
  await prisma.patient.deleteMany({ where: { siteId: SITE } });
  const rows = [56, 61, 47, 39, 66, 71, 52].map((a, i) => patient(`ep${i}`, a, "breast")).concat([patient("ep7", 44, "lung")]);
  await prisma.patient.createMany({ data: rows.map((p) => ({ id: p.id, siteId: SITE, data: JSON.stringify(p) })) });
  // A profile so archetype-A answers resolve high-confidence (more of the loop gets approved).
  await prisma.institutionProfile.upsert({
    where: { id: `${SITE}-profile` },
    update: {},
    create: { id: `${SITE}-profile`, siteId: SITE, legalName: "E2E Institution", anonymizationLevel: "pseudonymized", acceptsEsignature: true, materials: JSON.stringify({ data_dictionary: true }) },
  });
}

/** A synthetic sponsor form as a real .docx (exercises the docx ingest path). */
function formDocx(): Uint8Array {
  const body = CANONICAL_SECTIONS.map((s) => `<w:p><w:r><w:t>${s.idx}. ${escapeXml(s.name)}</w:t></w:r></w:p><w:p><w:r><w:t>${escapeXml(s.content.split(",")[0])}?</w:t></w:r></w:p>`).join("");
  return makeDocx(body);
}

async function main() {
  await ensureSite();

  // US-1: upload a .docx → request + parsed fields.
  const text = extractFormText("MSD_form.docx", formDocx());
  const { requestId, fieldCount } = await createFeasibilityRequest({ text, filename: "MSD_form.docx", siteId: SITE, sponsorId: "MSD (e2e)" });
  await prisma.feasibilityRequest.update({ where: { id: requestId }, data: { criteria: JSON.stringify(CRITERIA) } });

  // US-2: auto-fill.
  const fields = await prisma.formField.findMany({ where: { requestId }, orderBy: { orderIdx: "asc" } });
  const drafts: FormFieldDraft[] = fields.map((f) => ({ section: f.section, label: f.label, cellType: f.cellType as CellType, archetypeHint: f.archetype as Archetype, orderIdx: f.orderIdx }));
  const learnedSynonyms = await loadLearnedSynonyms();
  const result = await orchestrateAutofill({ siteId: SITE, fields: drafts, criteria: CRITERIA, learnedSynonyms }, buildInProcessDeps(ASOF));
  await persistAnswers(requestId, SITE, result);

  // US-3: approve all high-confidence (deterministic A/B/C; D stays proposed).
  const fs = await prisma.formField.findMany({ where: { requestId } });
  const as = await prisma.fieldAnswer.findMany({ where: { fieldId: { in: fs.map((f) => f.id) } } });
  const archByField = new Map(fs.map((f) => [f.id, f.archetype as Archetype]));
  const ras: ReviewAnswer[] = as.map((a) => ({ fieldId: a.id, archetype: archByField.get(a.fieldId) ?? "D", status: a.status as ReviewAnswer["status"], confidence: a.confidence as ReviewAnswer["confidence"], version: a.version }));
  const { approved } = bulkApproveHighConfidence(ras, "camila");
  for (const a of approved) await prisma.fieldAnswer.update({ where: { id: a.fieldId }, data: { status: a.status, reviewerId: a.reviewerId, version: a.version } });

  // US-5: export the approved answers to a .docx.
  const render = await loadRenderAnswers(requestId);
  const records: AnswerRecord[] = render.map((r) => ({ fieldId: r.fieldId, label: r.label, value: r.metric.value == null ? "" : String(r.metric.value), status: r.status as AnswerRecord["status"] }));
  const { bytes, approvedCount, withheldCount } = buildExportDocx("HER2+ MBC (e2e)", records);
  const cohortN = render.find((r) => r.archetype === "C")?.metric.value ?? "n/a";

  console.log("=== autofill:e2e — round-trip ===");
  console.log(`request id      : ${requestId}`);
  console.log(`fields parsed   : ${fieldCount}`);
  console.log(`answers         : ${render.length}`);
  console.log(`approved        : ${approvedCount} (withheld ${withheldCount})`);
  console.log(`cohort N        : ${cohortN}`);
  console.log(`exported .docx  : ${bytes.length} bytes`);
  console.log("round-trip OK — docx → request → autofill → approve → export");
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
