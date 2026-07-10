/**
 * demo-intake — headless proof of the universal sponsor-intake layer.
 *
 * Runs EVERY registered SourceAdapter over a cached fixture (no network, no API
 * key required) and prints, per source: the id, registry, trust tier, and the
 * resulting criteria count. Structured sources (FHIR) report the exact number of
 * preParsedCriteria; document/registry (text) sources report what the existing
 * parse.ts yields — or, offline with no key, a bullet-line estimate clearly
 * labelled "text → parse+verify" (those criteria are produced by the LLM parse +
 * verify table, exactly as before).
 *
 *   npm run demo:intake
 */

import { defaultRegistry } from "@/lib/intake";
import type { IntakeInput, IntakeResult } from "@/lib/intake";
import { parseCriteria } from "@/lib/parse";
import { HERO_META } from "@/data/hero-protocol";
import { FHIR_EVIDENCE_VARIABLE, EUCTR_FIXTURE, ATLAS_COHORT } from "@/data/intakeFixtures";
// Dev-only fixture builders (scripts/ and tests/ are both dev tooling, not shipped).
import { makeEctd, makeXlsx } from "../tests/helpers/fixtures";

/** A multi-section protocol document (exercises the envelope + eligibility locator). */
const PROTOCOL_DOC = `PROTOCOL ONC-2026-07 — A Phase III Study

1. Background
Long background prose about the disease and mechanism of action, not eligibility.

3. Study Population

Inclusion Criteria:
- Age >= 18 years.
- Histologically confirmed breast cancer.
- HER2-positive (IHC 3+).
- ECOG performance status 0 or 1.

Exclusion Criteria:
- Active brain metastases.
- Left ventricular ejection fraction < 50%.

4. Study Design
Randomized, open-label, with statistical analysis described below.
`;

interface DemoCase {
  label: string;
  input: IntakeInput;
}

const ELIG_MATRIX = [
  ["kind", "field", "operator", "value", "unit"],
  ["inclusion", "age", ">=", "18", "years"],
  ["inclusion", "her2_status", "eq", "positive", ""],
  ["exclusion", "ejection_fraction", "<", "50", "%"],
];

const CASES: DemoCase[] = [
  { label: "ClinicalTrials.gov (NCT id)", input: { kind: "id", id: HERO_META.nct } },
  { label: "Protocol document (PDF/DOCX/text)", input: { kind: "text", text: PROTOCOL_DOC, filename: "protocol.txt" } },
  { label: "FHIR EvidenceVariable (structured)", input: { kind: "json", data: FHIR_EVIDENCE_VARIABLE } },
  { label: "EU CTR (EudraCT id)", input: { kind: "id", id: EUCTR_FIXTURE.eudractNumber } },
  { label: "eCTD package (Module 5 protocol)", input: { kind: "file", filename: "submission.zip", bytes: makeEctd(PROTOCOL_DOC) } },
  { label: "XLSX eligibility matrix", input: { kind: "file", filename: "elig.xlsx", bytes: makeXlsx(ELIG_MATRIX) } },
  { label: "ATLAS cohort JSON", input: { kind: "json", data: ATLAS_COHORT, filename: "cohort.json" } },
];

async function criteriaCount(result: IntakeResult): Promise<{ n: number; how: string }> {
  if (result.preParsedCriteria) return { n: result.preParsedCriteria.length, how: "structured" };
  const text = result.eligibilityText ?? "";
  const nctHint =
    result.metadata.sourceRegistry === "clinicaltrials.gov" ? result.metadata.sourceId : undefined;
  try {
    const parsed = await parseCriteria(text, nctHint);
    return { n: parsed.criteria.length, how: parsed.source };
  } catch {
    const bullets = (text.match(/^[ \t]*[-*•\d]/gm) ?? []).length;
    return { n: bullets, how: "≈ lines (text → parse+verify)" };
  }
}

function pad(s: string, w: number): string {
  // Always leave at least one trailing space so columns never abut.
  if (s.length >= w) return s.slice(0, w - 1) + " ";
  return s + " ".repeat(w - s.length);
}

async function main(): Promise<void> {
  const reg = defaultRegistry();
  console.log(`\nTrialBridge · universal sponsor-intake — ${reg.list().length} adapters registered`);
  console.log(`Adapters: ${reg.list().map((a) => a.id).join(", ")}\n`);
  console.log(
    pad("SOURCE", 44) + pad("REGISTRY", 20) + pad("TRUST", 8) + pad("CRITERIA", 10) + "HOW",
  );
  console.log("-".repeat(100));

  let failures = 0;
  for (const c of CASES) {
    try {
      const detected = reg.detectBest(c.input);
      const result = await reg.ingest(c.input);
      const { n, how } = await criteriaCount(result);
      console.log(
        pad(`${c.label} [${detected?.adapter.id}]`, 44) +
          pad(result.metadata.sourceRegistry, 20) +
          pad(result.provenance.trust, 8) +
          pad(String(n), 10) +
          how,
      );
    } catch (err) {
      failures++;
      console.log(pad(`${c.label} — FAILED`, 44) + (err as Error).message);
    }
  }

  console.log("-".repeat(100));
  console.log(
    `\nLanes: structured sources skip the LLM (preParsedCriteria → verify); ` +
      `document/registry sources feed parse.ts (eligibilityText → verify).`,
  );
  if (failures > 0) {
    console.error(`\n${failures} adapter(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${CASES.length} sources ingested OK.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
