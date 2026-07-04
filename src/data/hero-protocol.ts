/**
 * The hero protocol — a REAL oncology trial archetype, so the demo is anchored in
 * external reality (ADR red-team: don't author both patients and criteria).
 *
 * Modeled on the HER2-positive metastatic breast cancer second-line setting
 * (trastuzumab deruxtecan / T-DXd program, e.g. DESTINY-Breast03). The eligibility
 * below is HAND-TRANSCRIBED and SIMPLIFIED for the demo — it is not the verbatim
 * protocol. Verify the NCT id and criteria against ClinicalTrials.gov before using
 * any of these numbers in the pitch. (This is the "paste-in text → verified
 * Criterion[]" artifact the ADR says to parse offline and cache.)
 *
 * Hero bottleneck (the one Marcus loosens on stage): HER2 status = positive.
 * It is a single, expressible, NON-composite criterion (D4) and the field on which
 * the synthetic data carries ~35% missingness (R3) — so relaxing it produces a
 * large, correctly-attributed pool jump (D2).
 */

import { Criterion } from "@/lib/matcher/types";

export const HERO_META = {
  id: "hero-her2-mbc",
  title: "Phase III — T-DXd in HER2+ metastatic breast cancer (2nd line)",
  sponsorName: "Marcus / Meridian Oncology (composite persona)",
  nct: "NCT03529110",
  sourceNote:
    "Modeled on the HER2+ mBC second-line setting (DESTINY-Breast program). Criteria simplified & hand-transcribed for the demo; verify against ClinicalTrials.gov before the pitch.",
  /** The softening handle that is the intended hero bottleneck. */
  heroBottleneckHandle: "her2_status",
} as const;

/** The raw pasted protocol text (input to the parse-verification UI). */
export const HERO_PROTOCOL_TEXT = `Key Eligibility Criteria (simplified)

Inclusion:
- Age >= 18 years.
- Histologically confirmed breast cancer.
- Metastatic (stage IV) disease.
- HER2-positive (IHC 3+ or ISH-amplified).
- ECOG performance status 0 or 1.
- At least one prior line of therapy in the metastatic setting.
- Adequate organ function: creatinine <= 1.5 mg/dL, hemoglobin >= 9 g/dL,
  platelets >= 100 x10^9/L, total bilirubin <= 1.5 mg/dL.

Exclusion:
- Active (untreated/symptomatic) brain metastases.
- Left ventricular ejection fraction < 50%.`;

/**
 * The VERIFIED parsed criteria (what a coordinator confirmed after the parse).
 * confidence < 0.75 rows are the ones the demo shows being human-checked.
 */
export const HERO_CRITERIA: Criterion[] = [
  {
    id: "c_age",
    kind: "inclusion",
    field: "age",
    operator: "gte",
    value: 18,
    rawText: "Age >= 18 years.",
    confidence: 0.99,
  },
  {
    id: "c_dx",
    kind: "inclusion",
    field: "diagnosis",
    operator: "eq",
    value: "breast cancer",
    rawText: "Histologically confirmed breast cancer.",
    confidence: 0.96,
  },
  {
    id: "c_stage",
    kind: "inclusion",
    field: "stage",
    operator: "in",
    value: ["IV"],
    rawText: "Metastatic (stage IV) disease.",
    confidence: 0.9,
  },
  {
    // HERO BOTTLENECK — single, expressible, non-composite, ~35% unknown in data.
    id: "c_her2",
    kind: "inclusion",
    field: "her2_status",
    operator: "in",
    value: ["positive"],
    rawText: "HER2-positive (IHC 3+ or ISH-amplified).",
    confidence: 0.82,
    groupId: "her2_status",
    groupLabel: "HER2 status = positive",
  },
  {
    id: "c_ecog",
    kind: "inclusion",
    field: "ecog",
    operator: "lte",
    value: 1,
    rawText: "ECOG performance status 0 or 1.",
    confidence: 0.94,
  },
  {
    id: "c_prior",
    kind: "inclusion",
    field: "prior_lines",
    operator: "gte",
    value: 1,
    rawText: "At least one prior line of therapy in the metastatic setting.",
    confidence: 0.7, // temporal-ish → flagged for human check in the demo
  },
  // Composite group (D4): "adequate organ function" → four lab thresholds, one toggle.
  {
    id: "c_organ_creat",
    kind: "inclusion",
    field: "creatinine",
    operator: "lte",
    value: 1.5,
    unit: "mg/dL",
    rawText: "Adequate organ function: creatinine <= 1.5 mg/dL.",
    confidence: 0.88,
    groupId: "organ_function",
    groupLabel: "Adequate organ function",
  },
  {
    id: "c_organ_hgb",
    kind: "inclusion",
    field: "hemoglobin",
    operator: "gte",
    value: 9,
    unit: "g/dL",
    rawText: "Adequate organ function: hemoglobin >= 9 g/dL.",
    confidence: 0.88,
    groupId: "organ_function",
    groupLabel: "Adequate organ function",
  },
  {
    id: "c_organ_plt",
    kind: "inclusion",
    field: "platelets",
    operator: "gte",
    value: 100,
    unit: "10^9/L",
    rawText: "Adequate organ function: platelets >= 100 x10^9/L.",
    confidence: 0.88,
    groupId: "organ_function",
    groupLabel: "Adequate organ function",
  },
  {
    id: "c_organ_bili",
    kind: "inclusion",
    field: "bilirubin",
    operator: "lte",
    value: 1.5,
    unit: "mg/dL",
    rawText: "Adequate organ function: total bilirubin <= 1.5 mg/dL.",
    confidence: 0.88,
    groupId: "organ_function",
    groupLabel: "Adequate organ function",
  },
  // Exclusions — missing data on these is conservatively "possible", never definite (D3).
  {
    id: "c_brain",
    kind: "exclusion",
    field: "brain_metastases",
    operator: "eq",
    value: "present",
    rawText: "Active (untreated/symptomatic) brain metastases.",
    confidence: 0.85,
  },
  {
    id: "c_lvef",
    kind: "exclusion",
    field: "ejection_fraction",
    operator: "lt",
    value: 50,
    unit: "%",
    rawText: "Left ventricular ejection fraction < 50%.",
    confidence: 0.8,
  },
];
