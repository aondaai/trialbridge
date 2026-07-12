/**
 * Feasibility-autofill demo seed — makes the /site/feasibility multi-agent
 * workspace render a live, fully-populated run out of the box.
 *
 * The workspace keys off site `site-ihealth-demo` and reads persisted answers, so
 * on a fresh (ephemeral) database it shows only an empty inbox. This seeds one
 * pharma feasibility request, runs the multi-agent orchestrator IN-PROCESS
 * (deterministic A/B/C + template D — no API key, no outbound Anthropic calls),
 * and persists the answers, so Camila lands on a complete field-by-field review.
 *
 * Extracted from scripts/seed-demo-request.ts into a shared module so both the
 * server-boot hook (src/instrumentation-node.ts, via seedAll) and the CLI call it.
 * Idempotent: guarded by the request row, and every write is an upsert/replace.
 */

import { prisma } from "@/lib/db";
import { CANONICAL_SECTIONS } from "@/lib/feasibility-autofill/canonicalTemplate";
import { parseFormText } from "@/lib/feasibility-autofill/ingest";
import { orchestrateAutofill } from "@/lib/feasibility-autofill/mcp/orchestrator";
import { buildInProcessDeps } from "@/lib/feasibility-autofill/inProcessDeps";
import { persistAutofill } from "@/lib/feasibility-autofill/persist";
import type { Criterion, Patient } from "@/lib/matcher/types";

const SITE = "site-ihealth-demo";
const REQ_ID = "req-demo-001";
// Clock-free: the demo baseline is fixed, not created live by a real user.
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

/**
 * Seed the feasibility-autofill demo. Idempotent and non-destructive: if the demo
 * request already exists, it leaves everything untouched (so a Camila who has been
 * reviewing/approving fields on a warm instance is never reset). Returns a short
 * status string for one-line logging.
 */
export async function seedFeasibilityDemo(): Promise<"already-present" | "seeded"> {
  const existing = await prisma.feasibilityRequest.findUnique({ where: { id: REQ_ID } }).catch(() => null);
  if (existing) {
    console.log("[seed-feasibility-demo] demo request already present — leaving review state untouched.");
    return "already-present";
  }

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

  // Synthetic form covering every canonical section, then the multi-agent fill.
  const text = CANONICAL_SECTIONS.map((s) => `${s.idx}. ${s.name}\n${s.content.split(",")[0]}?`).join("\n\n");
  const fields = parseFormText(text).fields;

  const result = await orchestrateAutofill({ siteId: SITE, fields, criteria: CRITERIA }, buildInProcessDeps(ASOF));
  await persistAutofill(REQ_ID, SITE, result);

  console.log(
    `[seed-feasibility-demo] seeded request ${REQ_ID}: ${result.answers.length} answers, cohort n=${result.cohort?.n ?? "n/a"}, ${PATIENTS.length} demo patients`,
  );
  return "seeded";
}
