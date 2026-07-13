/**
 * Offline parse fixture for IAM1363-01 (NCT06253871).
 *
 * Hand-transcribed from the ClinicalTrials.gov key eligibility criteria and
 * verified on 2026-07-13 against the record updated 2026-06-04:
 * https://clinicaltrials.gov/study/NCT06253871
 *
 * Qualitative and conditional clauses stay qualitative. We deliberately do
 * not invent lab thresholds or flatten protocol exceptions into broader rules;
 * those rows remain low-confidence/not-answerable for human verification.
 */

import type { Criterion } from "@/lib/matcher/types";

export const IAM1363_META = {
  id: "iambic-iam1363",
  title: "Phase I/1b — IAM1363 in advanced cancers harboring HER2 alterations",
  sponsorName: "Iambic Therapeutics, Inc.",
  nct: "NCT06253871",
  sourceUrl: "https://clinicaltrials.gov/study/NCT06253871",
  sourceNote:
    "NCT06253871 = IAM1363-01 (Iambic Therapeutics) — VERIFIED against the ClinicalTrials.gov record updated 2026-06-04. This fixture transcribes the registry's key criteria; qualitative thresholds and conditional exceptions remain flagged for human verification.",
} as const;

export const IAM1363_CRITERIA: Criterion[] = [
  {
    id: "iam_age",
    kind: "inclusion",
    field: "age",
    operator: "gte",
    value: 18,
    unit: "years",
    rawText: "Age ≥ 18 years.",
    confidence: 0.99,
  },
  {
    id: "iam_her2",
    kind: "inclusion",
    field: "her2_status",
    operator: "in",
    value: ["positive", "altered", "mutated", "amplified", "overexpressed"],
    rawText:
      "Have relapsed/refractory HER2-altered malignancy; for selected cohorts, prospective confirmation of HER2 alteration by central testing is required.",
    confidence: 0.78,
  },
  {
    id: "iam_progression",
    kind: "inclusion",
    field: "prior_therapy_progression_or_intolerance",
    operator: "exists",
    value: null,
    rawText:
      "Have progression of disease after the last systemic therapy, or be intolerant of last systemic therapy.",
    confidence: 0.58,
  },
  {
    id: "iam_measurable",
    kind: "inclusion",
    field: "measurable_disease_recist_or_rano_bm",
    operator: "exists",
    value: null,
    rawText: "Have radiographically measurable disease by RECIST v1.1 and/or RANO-BM.",
    confidence: 0.58,
  },
  {
    id: "iam_ecog",
    kind: "inclusion",
    field: "ecog",
    operator: "in",
    value: [0, 1],
    rawText: "Eastern Cooperative Oncology Group (ECOG) performance score 0-1.",
    confidence: 0.95,
  },
  {
    id: "iam_organ",
    kind: "inclusion",
    field: "adequate_hematologic_liver_renal_function",
    operator: "exists",
    value: null,
    rawText: "Have adequate baseline hematologic, liver and renal function.",
    confidence: 0.45,
  },
  {
    id: "iam_lvef",
    kind: "inclusion",
    field: "ejection_fraction",
    operator: "gte",
    value: 50,
    unit: "%",
    rawText: "Have left ventricular ejection fraction (LVEF) ≥ 50%.",
    confidence: 0.96,
  },
  {
    id: "iam_swallow",
    kind: "inclusion",
    field: "able_to_swallow",
    operator: "exists",
    value: null,
    rawText: "Able to swallow oral medication.",
    confidence: 0.7,
  },
  {
    id: "iam_cardiac",
    kind: "exclusion",
    field: "significant_cardiac_disease",
    operator: "exists",
    value: null,
    rawText: "Clinically significant cardiac disease.",
    confidence: 0.7,
  },
  {
    id: "iam_hiv",
    kind: "exclusion",
    field: "hiv",
    operator: "eq",
    value: "uncontrolled",
    rawText:
      "Infection with HIV-1 or HIV-2; participants with well-controlled HIV (for example CD4 >350/mm3 and undetectable viral load) are eligible.",
    confidence: 0.62,
  },
  {
    id: "iam_hepatitis",
    kind: "exclusion",
    field: "active_hepatitis",
    operator: "exists",
    value: null,
    rawText: "Current active liver disease including hepatitis A, hepatitis B, or hepatitis C.",
    confidence: 0.68,
  },
  {
    id: "iam_absorption",
    kind: "exclusion",
    field: "impaired_oral_absorption",
    operator: "exists",
    value: null,
    rawText:
      "Refractory nausea and vomiting, malabsorption, external biliary shunt, or significant small bowel resection that would preclude adequate absorption.",
    confidence: 0.55,
  },
  {
    id: "iam_diabetes",
    kind: "exclusion",
    field: "diabetes",
    operator: "eq",
    value: "uncontrolled",
    rawText: "Uncontrolled diabetes.",
    confidence: 0.7,
  },
  {
    id: "iam_transplant",
    kind: "exclusion",
    field: "solid_organ_transplant",
    operator: "exists",
    value: null,
    rawText: "History of solid organ transplantation.",
    confidence: 0.72,
  },
  {
    id: "iam_cns_hemorrhage",
    kind: "exclusion",
    field: "disqualifying_cns_hemorrhage",
    operator: "exists",
    value: null,
    rawText:
      "History of Grade ≥2 CNS hemorrhage, or any CNS hemorrhage within 28 days before C1D1.",
    confidence: 0.58,
  },
  {
    id: "iam_ild",
    kind: "exclusion",
    field: "interstitial_lung_disease",
    operator: "eq",
    value: "disqualifying",
    rawText:
      "Prior history of non-infectious interstitial lung disease (ILD); prior Grade 1 ILD that has completely resolved is allowed.",
    confidence: 0.62,
  },
  {
    id: "iam_brain_local_therapy",
    kind: "exclusion",
    field: "brain_metastases_requires_immediate_local_therapy",
    operator: "exists",
    value: null,
    rawText: "Participants requiring immediate local therapy for brain metastases.",
    confidence: 0.6,
  },
];
