/**
 * Demo feasibility request — seeds a request + a handful of patients, runs the autofill
 * orchestrator in-process (deterministic A/B/C + template D, no API key), and persists the
 * answers so the review workspace (/site/feasibility) renders a live run. Idempotent.
 *
 *   npm run db:seed-demo-request
 */

import { prisma } from "../src/lib/db";
import { CANONICAL_SECTIONS } from "../src/lib/feasibility-autofill/canonicalTemplate";
import { parseFormText } from "../src/lib/feasibility-autofill/ingest";
import { orchestrateAutofill } from "../src/lib/feasibility-autofill/mcp/orchestrator";
import { buildInProcessDeps } from "../src/lib/feasibility-autofill/inProcessDeps";
import { persistAutofill } from "../src/lib/feasibility-autofill/persist";
import type { Criterion, Patient } from "../src/lib/matcher/types";

const SITE = "site-ihealth-demo";
const REQ_ID = "req-demo-001";
const ASOF = "2026-07-11T00:00:00Z";

const CRITERIA: Criterion[] = [
  { id: "c1", kind: "inclusion", field: "age", operator: "gte", value: 18, rawText: "Idade ≥ 18", confidence: 1 },
  { id: "c2", kind: "inclusion", field: "diagnosis", operator: "eq", value: "breast", rawText: "Câncer de mama", confidence: 1 },
];

function patient(id: string, age: number | null, diagnosis: string, her2: string | null): Patient {
  return { id, siteId: SITE, diagnosis, stage: null, biomarkers: { her2_status: her2 }, priorLines: null, ecog: null, labs: {}, sex: null, age };
}

// 7 breast/adult (definite) + 1 lung (excluded) → a real, non-suppressed candidate count.
const PATIENTS: Patient[] = [
  patient("dp1", 54, "breast", "positive"), patient("dp2", 61, "breast", "positive"),
  patient("dp3", 47, "breast", "negative"), patient("dp4", 38, "breast", "positive"),
  patient("dp5", 66, "breast", null), patient("dp6", 29, "breast", "positive"),
  patient("dp7", 72, "breast", "negative"), patient("dp8", 55, "lung", "positive"),
];

async function main() {
  await prisma.site.upsert({
    where: { id: SITE },
    update: {},
    create: { id: SITE, name: "iHealth (demo)", country: "Brazil", city: "São Paulo", region: "Sudeste", persona: "site", monthlyIncidence: 6 },
  });
  await prisma.patient.deleteMany({ where: { siteId: SITE } });
  await prisma.patient.createMany({ data: PATIENTS.map((p) => ({ id: p.id, siteId: SITE, data: JSON.stringify(p) })) });

  await prisma.feasibilityRequest.upsert({
    where: { id: REQ_ID },
    update: { criteria: JSON.stringify(CRITERIA) },
    create: {
      id: REQ_ID, siteId: SITE, sponsorId: "MSD (demo)", studyTitle: "HER2+ MBC — viabilidade (demo)",
      therapeuticArea: "Oncologia", indexWindow: "2019-01-01/2025-12-31", criteria: JSON.stringify(CRITERIA), status: "received",
    },
  });

  // Synthetic form covering every canonical section.
  const text = CANONICAL_SECTIONS.map((s) => `${s.idx}. ${s.name}\n${s.content.split(",")[0]}?`).join("\n\n");
  const fields = parseFormText(text).fields;

  const result = await orchestrateAutofill({ siteId: SITE, fields, criteria: CRITERIA }, buildInProcessDeps(ASOF));
  await persistAutofill(REQ_ID, SITE, result);

  console.log(`[seed-demo-request] ok — request ${REQ_ID}: ${result.answers.length} answers, cohort n=${result.cohort?.n ?? "n/a"}, ${PATIENTS.length} demo patients`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
