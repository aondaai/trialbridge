/**
 * The SECOND scenario — proves the matching engine generalizes to a new
 * disease with zero changes to `engine.ts`/`types.ts` matching logic (only an
 * additive `evaluability` tag was added, purely for UI/reporting).
 *
 * Modeled on CodeBreaK 202 (NCT05920356, Amgen) — Phase 3, RECRUITING:
 * sotorasib + platinum-doublet vs. pembrolizumab + platinum-doublet,
 * first-line, nonsquamous advanced/metastatic NSCLC, KRAS G12C-positive AND
 * PD-L1-negative. HAND-TRANSCRIBED and SIMPLIFIED for the demo — not the
 * verbatim protocol. Verify against ClinicalTrials.gov before using any of
 * these numbers in the pitch (same discipline as hero-protocol.ts).
 *
 * The teaching point (sharper than the HER2 scenario): TWO of the criteria
 * that gate entry to this trial — the KRAS mutation and PD-L1 status — sit on
 * fields a claims-style data source essentially can't observe (`evaluability:
 * "not_evaluable"`), and a third (ECOG) is structurally never coded at all.
 * Unlike HER2 (one softenable bottleneck), no single criterion drop "fixes"
 * this trial — see `docs/citations.md` and `tests/nsclc.test.ts`.
 *
 * Bottleneck the demo highlights (Beat 3): PD-L1 status. The traditional
 * drop-the-criterion lever (`softenCriterion`) is available like any other
 * criterion, but the honest lever from the source material is narrower —
 * widen the accepted PD-L1 value set from "negative only" to "negative or
 * low" via `relaxToVariant` (see `src/lib/matcher/soften.ts`).
 */

import { Criterion } from "@/lib/matcher/types";

export const NSCLC_META = {
  id: "nsclc-kras-g12c",
  title: "Phase III — Sotorasib + chemo vs. pembrolizumab + chemo, 1L KRAS G12C+/PD-L1- NSCLC",
  sponsorName: "Marcus / Meridian Oncology (composite persona)",
  nct: "NCT05920356",
  sourceNote:
    "NCT05920356 = CodeBreaK 202 (Amgen) — VERIFIED, Phase 3, RECRUITING: sotorasib + platinum-doublet vs. pembrolizumab + platinum-doublet, first-line, nonsquamous advanced/metastatic NSCLC, KRAS G12C-positive AND PD-L1-negative. N=750, 383 sites incl. 21 in Brazil. Criteria simplified for the demo: real scope is stage IV or unresectable/advanced IIIB–IIIC (we use stage IV only); the real protocol's molecular gates are central-lab NGS (KRAS) and IHC (PD-L1 TPS), not further sub-typed here. See docs/citations.md.",
  /** The softening handle the demo highlights first (Beat 3). */
  heroBottleneckHandle: "pdl1_status",
} as const;

/** The raw pasted protocol text (input to the parse-verification UI, for reference only — this scenario ships as a pre-verified fixture, not via the live parse flow). */
export const NSCLC_PROTOCOL_TEXT = `Key Eligibility Criteria (simplified)

Inclusion:
- Age >= 18 years.
- Nonsquamous non-small-cell lung cancer (NSCLC).
- Stage IV (advanced/metastatic) disease.
- KRAS p.G12C mutation (central or central-confirmed).
- PD-L1-negative (central or central-confirmed).
- No prior systemic anticancer therapy in the metastatic/non-curable setting.
- ECOG performance status 0 or 1.

Exclusion:
- Symptomatic or untreated brain metastases.
- Myocardial infarction within 6 months, or unstable arrhythmia/angina.
- Prior treatment with a KRAS G12C inhibitor.`;

/**
 * The VERIFIED parsed criteria. Two rows carry `evaluability: "not_evaluable"`
 * AND are the trial's actual gating criteria (the sharper honesty point vs.
 * the HER2 scenario, where the un-provable criterion was a lone bottleneck).
 * A third (ECOG) is also `not_evaluable` but not gating in the same
 * mutation/biomarker sense — included so `rankBottlenecks` shows that no
 * single drop reaches "definite" on its own.
 */
export const NSCLC_CRITERIA: Criterion[] = [
  {
    id: "n_age",
    kind: "inclusion",
    field: "age",
    operator: "gte",
    value: 18,
    rawText: "Age >= 18 years.",
    confidence: 0.99,
    evaluability: "pass_able",
  },
  {
    id: "n_dx",
    kind: "inclusion",
    field: "diagnosis",
    operator: "eq",
    value: "lung cancer",
    rawText: "Non-small-cell lung cancer (NSCLC).",
    confidence: 0.95,
    evaluability: "pass_able",
  },
  {
    id: "n_histology",
    kind: "inclusion",
    field: "histology",
    operator: "in",
    value: ["nonsquamous"],
    rawText: "Nonsquamous histology.",
    confidence: 0.85,
    evaluability: "partial",
  },
  {
    id: "n_stage",
    kind: "inclusion",
    field: "stage",
    operator: "in",
    value: ["IV"],
    rawText: "Stage IV (advanced/metastatic) disease.",
    confidence: 0.9,
    evaluability: "pass_able",
  },
  {
    // GATING #1 — the mutation this whole trial selects for.
    id: "n_kras",
    kind: "inclusion",
    field: "kras_g12c",
    operator: "in",
    value: ["positive"],
    rawText: "KRAS p.G12C mutation (central or central-confirmed).",
    confidence: 0.9,
    evaluability: "not_evaluable",
  },
  {
    // GATING #2 — the biomarker the demo's softening lever widens (Beat 3).
    id: "n_pdl1",
    kind: "inclusion",
    field: "pdl1_status",
    operator: "in",
    value: ["negative"],
    rawText: "PD-L1-negative (central or central-confirmed).",
    confidence: 0.88,
    evaluability: "not_evaluable",
  },
  {
    id: "n_prior_tx",
    kind: "inclusion",
    field: "prior_lines",
    operator: "lte",
    value: 0,
    rawText: "No prior systemic anticancer therapy in the metastatic/non-curable setting.",
    confidence: 0.75,
    evaluability: "pass_able",
  },
  {
    id: "n_ecog",
    kind: "inclusion",
    field: "ecog",
    operator: "lte",
    value: 1,
    rawText: "ECOG performance status 0 or 1.",
    confidence: 0.9,
    evaluability: "not_evaluable",
  },
  {
    id: "n_brain",
    kind: "exclusion",
    field: "brain_metastases",
    operator: "eq",
    value: "present",
    rawText: "Symptomatic or untreated brain metastases.",
    confidence: 0.85,
    evaluability: "partial",
  },
  {
    id: "n_mi",
    kind: "exclusion",
    field: "mi_recent",
    operator: "eq",
    value: "present",
    rawText: "Myocardial infarction within 6 months, or unstable arrhythmia/angina.",
    confidence: 0.85,
    evaluability: "pass_able",
  },
  {
    id: "n_prior_kras_inhibitor",
    kind: "exclusion",
    field: "prior_kras_inhibitor",
    operator: "eq",
    value: "present",
    rawText: "Prior treatment with a KRAS G12C inhibitor.",
    confidence: 0.85,
    evaluability: "partial",
  },
];
