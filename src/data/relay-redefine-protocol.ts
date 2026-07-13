/**
 * Offline parse fixture for ReDiscover-2 (NCT06982521).
 *
 * Transcribed from the ClinicalTrials.gov record on 2026-07-13. The registry
 * record was last updated on 2026-07-08. This is a registry-derived fallback,
 * not a substitute for sponsor verification: conditional and temporal rules
 * deliberately remain low-confidence/manual-review criteria.
 * https://clinicaltrials.gov/study/NCT06982521
 */

import type { Criterion } from "@/lib/matcher/types";

export const RELAY_REDEFINE_META = {
  id: "relay-rediscover-2",
  title: "Phase III — RLY-2608 + fulvestrant in PIK3CA-mutant HR+/HER2− advanced breast cancer",
  sponsorName: "Relay Therapeutics, Inc.",
  nct: "NCT06982521",
  sourceUrl: "https://clinicaltrials.gov/study/NCT06982521",
  sourceNote:
    "Registry-derived from ClinicalTrials.gov on 2026-07-13 (record updated 2026-07-08). Sponsor review is required, especially for prior-treatment timing and molecular exceptions.",
} as const;

export const RELAY_REDEFINE_PROTOCOL_TEXT = `Inclusion Criteria:

* Minimum age: 18 years.
* Patient has ECOG performance status of 0-1.
* One or more known primary oncogenic PIK3CA mutation(s).
* Adult females, pre- and/or post-menopausal, and adult males. Pre-menopausal and peri-menopausal women can be enrolled if amenable to treatment with a GnRH agonist commenced at least 4 weeks prior to randomization and continued for the duration of the study.
* Histologically or cytologically confirmed HR+/HER2- locally advanced or metastatic breast cancer with radiological or objective evidence of recurrence or progression; locally advanced disease must not be amenable to resection with curative intent.
* Measurable disease per RECIST v1.1 or evaluable bone-only disease.
* Radiological evidence of progression on or after 1 to 2 prior lines of endocrine therapy and 1 prior line of CDK4/6 inhibitor therapy, subject to the timing and setting conditions in the registry.

Exclusion Criteria:

* Prior treatment with CDK2 or selective CDK4 inhibitors or investigational therapies targeting cyclin-dependent kinases.
* Prior treatment with PI3K, AKT, or mTOR inhibitors or another agent targeting the PI3K/AKT/mTOR pathway.
* Prior immunotherapy.
* Prior antibody-drug conjugates.
* Type 1 diabetes, or Type 2 diabetes requiring antihyperglycemic medication, or fasting plasma glucose >= 140 mg/dL, or HbA1c >= 7.0% (>= 53 mmol/mol).
* Clinically significant, uncontrolled cardiovascular disease.
* Factors that increase the risk of QTc prolongation or arrhythmic events.
* Known active uncontrolled or symptomatic CNS metastases associated with progressive neurological symptoms or requiring ongoing corticosteroids or anticonvulsants for symptomatic control.
* History of interstitial lung disease, drug-induced interstitial lung disease, radiation pneumonitis requiring steroid treatment, or clinically active interstitial lung disease.
* Hypersensitivity to fulvestrant, RLY-2608, capivasertib, similar drugs, or their excipients.
* Activating AKT mutations, loss-of-function PTEN mutations, or loss of PTEN expression resulting in oncogenic pathway activation downstream of PI3K.`;

export const RELAY_REDEFINE_CRITERIA: Criterion[] = [
  {
    id: "relay_age",
    kind: "inclusion",
    field: "age",
    operator: "gte",
    value: 18,
    unit: "years",
    rawText: "Minimum age: 18 years.",
    confidence: 0.99,
  },
  {
    id: "relay_ecog",
    kind: "inclusion",
    field: "ecog",
    operator: "lte",
    value: 1,
    rawText: "Patient has ECOG performance status of 0-1.",
    confidence: 0.97,
  },
  {
    id: "relay_pik3ca",
    kind: "inclusion",
    field: "pik3ca_mutation",
    operator: "exists",
    value: null,
    rawText: "One or more known primary oncogenic PIK3CA mutation(s).",
    confidence: 0.72,
  },
  {
    id: "relay_dx",
    kind: "inclusion",
    field: "diagnosis",
    operator: "eq",
    value: "breast cancer",
    rawText: "Histologically or cytologically confirmed breast cancer.",
    confidence: 0.97,
  },
  {
    id: "relay_hr",
    kind: "inclusion",
    field: "hormone_receptor_status",
    operator: "eq",
    value: "positive",
    rawText: "Hormone receptor-positive (HR+) breast cancer.",
    confidence: 0.82,
  },
  {
    id: "relay_her2",
    kind: "inclusion",
    field: "her2_status",
    operator: "eq",
    value: "negative",
    rawText: "HER2-negative (HER2-) breast cancer.",
    confidence: 0.9,
  },
  {
    id: "relay_stage",
    kind: "inclusion",
    field: "stage",
    operator: "in",
    value: ["locally advanced", "metastatic"],
    rawText:
      "Locally advanced or metastatic breast cancer; locally advanced disease must not be amenable to resection with curative intent.",
    confidence: 0.68,
  },
  {
    id: "relay_measurable",
    kind: "inclusion",
    field: "measurable_or_evaluable_disease",
    operator: "exists",
    value: null,
    rawText: "Measurable disease per RECIST v1.1 or evaluable bone-only disease.",
    confidence: 0.58,
  },
  {
    id: "relay_endocrine_lines",
    kind: "inclusion",
    field: "prior_lines",
    operator: "between",
    value: [1, 2],
    rawText: "At least 1 and no more than 2 prior lines of endocrine therapy, subject to the protocol setting and recurrence timing rules.",
    confidence: 0.62,
  },
  {
    id: "relay_cdk46_line",
    kind: "inclusion",
    field: "prior_cdk46_lines",
    operator: "eq",
    value: 1,
    rawText: "One prior line of CDK4/6 inhibitor therapy, subject to the protocol setting and progression timing rules.",
    confidence: 0.55,
  },
  {
    id: "relay_progression",
    kind: "inclusion",
    field: "radiological_progression_after_prior_therapy",
    operator: "exists",
    value: null,
    rawText: "Radiological evidence of progression on or after the required previous treatment for HR+/HER2- advanced breast cancer.",
    confidence: 0.52,
  },
  {
    id: "relay_gnrh",
    kind: "inclusion",
    field: "gnrh_agonist_requirement",
    operator: "exists",
    value: null,
    rawText:
      "Pre-menopausal and peri-menopausal women must be amenable to GnRH agonist treatment started at least 4 weeks before randomization and continued during the study.",
    confidence: 0.42,
  },
  {
    id: "relay_prior_cdk",
    kind: "exclusion",
    field: "prior_cdk2_or_selective_cdk4_inhibitor",
    operator: "exists",
    value: null,
    rawText: "Prior CDK2 or selective CDK4 inhibitor, or investigational therapy targeting cyclin-dependent kinases.",
    confidence: 0.55,
    groupId: "relay_prior_disallowed_therapy",
    groupLabel: "Disallowed prior therapies",
  },
  {
    id: "relay_prior_pi3k",
    kind: "exclusion",
    field: "prior_pi3k_akt_mtor_inhibitor",
    operator: "exists",
    value: null,
    rawText: "Prior PI3K, AKT, or mTOR inhibitor or another agent targeting the PI3K/AKT/mTOR pathway.",
    confidence: 0.58,
    groupId: "relay_prior_disallowed_therapy",
    groupLabel: "Disallowed prior therapies",
  },
  {
    id: "relay_prior_immunotherapy",
    kind: "exclusion",
    field: "prior_immunotherapy",
    operator: "exists",
    value: null,
    rawText: "Prior immunotherapy.",
    confidence: 0.62,
    groupId: "relay_prior_disallowed_therapy",
    groupLabel: "Disallowed prior therapies",
  },
  {
    id: "relay_prior_adc",
    kind: "exclusion",
    field: "prior_antibody_drug_conjugate",
    operator: "exists",
    value: null,
    rawText: "Prior antibody-drug conjugate.",
    confidence: 0.62,
    groupId: "relay_prior_disallowed_therapy",
    groupLabel: "Disallowed prior therapies",
  },
  {
    id: "relay_diabetes",
    kind: "exclusion",
    field: "diabetes",
    operator: "in",
    value: ["type 1", "type 2 requiring antihyperglycemic medication"],
    rawText: "Type 1 diabetes or Type 2 diabetes requiring antihyperglycemic medication.",
    confidence: 0.68,
    groupId: "relay_glycemic_control",
    groupLabel: "Disqualifying glycemic status",
  },
  {
    id: "relay_glucose",
    kind: "exclusion",
    field: "fasting_plasma_glucose",
    operator: "gte",
    value: 140,
    unit: "mg/dL",
    rawText: "Fasting plasma glucose ≥ 140 mg/dL.",
    confidence: 0.94,
    groupId: "relay_glycemic_control",
    groupLabel: "Disqualifying glycemic status",
  },
  {
    id: "relay_hba1c",
    kind: "exclusion",
    field: "hba1c",
    operator: "gte",
    value: 7,
    unit: "%",
    rawText: "Glycosylated hemoglobin (HbA1c) ≥ 7.0% (≥ 53 mmol/mol).",
    confidence: 0.94,
    groupId: "relay_glycemic_control",
    groupLabel: "Disqualifying glycemic status",
  },
  {
    id: "relay_cardiac",
    kind: "exclusion",
    field: "significant_cardiac_disease",
    operator: "eq",
    value: "uncontrolled",
    rawText: "Clinically significant, uncontrolled cardiovascular disease.",
    confidence: 0.68,
  },
  {
    id: "relay_qtc",
    kind: "exclusion",
    field: "qtc_prolongation_or_arrhythmia_risk",
    operator: "exists",
    value: null,
    rawText: "Factors that increase the risk of QTc prolongation or arrhythmic events.",
    confidence: 0.55,
  },
  {
    id: "relay_cns",
    kind: "exclusion",
    field: "brain_metastases",
    operator: "eq",
    value: "active uncontrolled or symptomatic",
    rawText:
      "Active uncontrolled or symptomatic CNS metastases with progressive neurological symptoms or requiring ongoing corticosteroids or anticonvulsants.",
    confidence: 0.68,
  },
  {
    id: "relay_ild",
    kind: "exclusion",
    field: "interstitial_lung_disease",
    operator: "exists",
    value: null,
    rawText:
      "Interstitial lung disease, drug-induced interstitial lung disease, radiation pneumonitis requiring steroids, or clinically active interstitial lung disease.",
    confidence: 0.7,
  },
  {
    id: "relay_hypersensitivity",
    kind: "exclusion",
    field: "study_drug_hypersensitivity",
    operator: "exists",
    value: null,
    rawText: "Hypersensitivity to fulvestrant, RLY-2608, capivasertib, similar drugs, or their excipients.",
    confidence: 0.55,
  },
  {
    id: "relay_akt",
    kind: "exclusion",
    field: "activating_akt_mutation",
    operator: "exists",
    value: null,
    rawText: "Known activating AKT mutation.",
    confidence: 0.7,
    groupId: "relay_downstream_alteration",
    groupLabel: "Disqualifying downstream PI3K-pathway alteration",
  },
  {
    id: "relay_pten",
    kind: "exclusion",
    field: "pten_loss_of_function_or_expression",
    operator: "exists",
    value: null,
    rawText: "PTEN loss-of-function mutation or loss of PTEN expression causing downstream oncogenic pathway activation.",
    confidence: 0.68,
    groupId: "relay_downstream_alteration",
    groupLabel: "Disqualifying downstream PI3K-pathway alteration",
  },
];
