/**
 * Offline parse fixture for the rentosertib IPF study (NCT07687459).
 *
 * Transcribed from the live ClinicalTrials.gov eligibility text fetched in the
 * sponsor flow on 2026-07-13. Compound laboratory and treatment clauses are
 * kept atomic and grouped. Qualitative investigator-judgment rules remain
 * low-confidence/manual-review criteria.
 */

import type { Criterion, CriterionValue, Operator } from "@/lib/matcher/types";

export const RENTOSERTIB_IPF_META = {
  id: "rentosertib-ipf",
  title: "Rentosertib in idiopathic pulmonary fibrosis",
  nct: "NCT07687459",
  sourceUrl: "https://clinicaltrials.gov/study/NCT07687459",
  sourceNote:
    "Registry-derived from ClinicalTrials.gov on 2026-07-13. Sponsor review is required for conditional treatment windows, investigator-judgment rules, and laboratory thresholds.",
} as const;

function row(
  id: string,
  kind: Criterion["kind"],
  field: string,
  operator: Operator,
  value: CriterionValue,
  rawText: string,
  confidence: number,
  extra: Partial<Pick<Criterion, "unit" | "groupId" | "groupLabel">> = {},
): Criterion {
  return { id: `ipf_${id}`, kind, field, operator, value, rawText, confidence, ...extra };
}

const screeningLungFunction = { groupId: "ipf_lung_function", groupLabel: "Screening lung-function thresholds" };
const liverLabs = { groupId: "ipf_liver_labs", groupLabel: "Disqualifying liver laboratory thresholds" };
const qtc = { groupId: "ipf_qtc", groupLabel: "Disqualifying QTcF thresholds" };
const prohibitedTherapy = { groupId: "ipf_prohibited_therapy", groupLabel: "Prohibited concomitant therapies" };

export const RENTOSERTIB_IPF_CRITERIA: Criterion[] = [
  row("consent", "inclusion", "informed_consent", "exists", null, "An informed consent form signed and dated before study-related procedures.", 0.45),
  row("age", "inclusion", "age", "gte", 40, "Patients aged ≥40 years at time of signing the ICF.", 0.99, { unit: "years" }),
  row("dx", "inclusion", "diagnosis", "eq", "idiopathic pulmonary fibrosis", "Diagnosis of IPF based on the 2022 ATS/ERS/JRS/ALAT Clinical Practice Guideline.", 0.97),
  row("hrct", "inclusion", "hrct_confirmed_ipf_within_3_months", "exists", null, "IPF diagnosis confirmed by an HRCT chest scan within 3 months prior to screening.", 0.62),
  row("uip", "inclusion", "uip_pattern", "in", ["UIP", "probable UIP"], "UIP or probable UIP at HRCT.", 0.64),
  row("fibrosis", "inclusion", "hrct_fibrosis_extent", "gt", 10, "Fibrosis extent >10% at HRCT.", 0.72, { unit: "%" }),
  row("fvc", "inclusion", "fvc_percent_predicted", "gte", 45, "FVC ≥45% predicted of normal during screening.", 0.94, { unit: "%", ...screeningLungFunction }),
  row("fev1_fvc", "inclusion", "fev1_fvc_ratio", "gte", 0.7, "FEV1/FVC ≥0.7 during screening.", 0.94, screeningLungFunction),
  row("dlco_min", "inclusion", "dlco_percent_predicted", "gte", 25, "DLCO corrected for hemoglobin ≥25% predicted of normal.", 0.94, { unit: "%", ...screeningLungFunction }),
  row("dlco_max", "inclusion", "dlco_percent_predicted", "lt", 80, "DLCO corrected for hemoglobin <80% predicted of normal.", 0.94, { unit: "%", ...screeningLungFunction }),
  row("antifibrotic", "inclusion", "background_antifibrotic_status", "in", ["stable nintedanib or pirfenidone for at least 12 weeks", "no nintedanib or pirfenidone for at least 8 weeks"], "Background antifibrotic treatment must meet either the stable-treatment or untreated protocol window.", 0.48),
  row("life_expectancy", "inclusion", "non_ipf_life_expectancy_months", "gte", 30, "Estimated minimum life expectancy of at least 30 months for non-IPF-related disease.", 0.52, { unit: "months" }),
  row("contraception", "inclusion", "contraception_commitment", "exists", null, "Applicable male and female patients agree to the protocol contraception measures through 90 days after the last dose.", 0.42),

  row("associated_ild", "exclusion", "autoimmune", "exists", null, "Interstitial lung disease associated with a known primary disease, exposure, or drug.", 0.72),
  row("prior_rentosertib", "exclusion", "prior_rentosertib_study", "exists", null, "Previous participation in a clinical study with rentosertib (active or placebo).", 0.58),
  row("investigational", "exclusion", "recent_or_concurrent_investigational_therapy", "exists", null, "Concurrent interventional research or investigational-agent use within the protocol washout window.", 0.55),
  row("pulmonary_hypertension", "exclusion", "clinically_relevant_pulmonary_hypertension", "exists", null, "Clinically relevant or severe pulmonary hypertension or other clinically significant pulmonary abnormality.", 0.58),
  row("cardiovascular", "exclusion", "significant_cardiac_disease", "eq", "unstable within 6 months", "Unstable cardiovascular or other disease within 6 months before screening or during screening.", 0.66),
  row("airway_disease", "exclusion", "significant_airway_disease", "exists", null, "Other clinically significant airway disease that could affect study safety or efficacy.", 0.55),
  row("ipf_exacerbation", "exclusion", "acute_ipf_exacerbation_within_6_months", "exists", null, "Acute exacerbation of IPF within 6 months before screening or during screening.", 0.65),
  row("liver_disease", "exclusion", "chronic_liver_disease", "exists", null, "Underlying chronic liver disease, including Child-Pugh A, B, or C impairment or hepatic steatosis.", 0.64),
  row("gilbert", "exclusion", "gilbert_syndrome", "exists", null, "Gilbert's disease.", 0.62),
  row("infection", "exclusion", "clinically_significant_infection", "exists", null, "Relevant chronic or acute infections.", 0.58),
  row("hiv", "exclusion", "hiv", "exists", null, "Human immunodeficiency virus (HIV).", 0.68),
  row("hepatitis", "exclusion", "active_hepatitis", "exists", null, "Clinically significant viral hepatitis.", 0.68),
  row("ast", "exclusion", "ast", "gte", 1.5, "Aspartate aminotransferase ≥1.5 × ULN at screening.", 0.94, { unit: "× ULN", ...liverLabs }),
  row("alt", "exclusion", "alt", "gte", 1.5, "Alanine aminotransferase ≥1.5 × ULN at screening.", 0.94, { unit: "× ULN", ...liverLabs }),
  row("bilirubin", "exclusion", "total_bilirubin", "gte", 1.5, "Total bilirubin ≥1.5 × ULN at screening.", 0.94, { unit: "× ULN", ...liverLabs }),
  row("ggt", "exclusion", "gamma_glutamyl_transferase", "gte", 3, "Gamma glutamyl transferase ≥3 × ULN at screening.", 0.94, { unit: "× ULN", ...liverLabs }),
  row("alp", "exclusion", "alkaline_phosphatase", "gte", 1.5, "Alkaline phosphatase ≥1.5 × ULN at screening.", 0.94, { unit: "× ULN", ...liverLabs }),
  row("egfr", "exclusion", "egfr", "lt", 60, "Estimated glomerular filtration rate <60 mL/min/1.73m² at screening.", 0.95, { unit: "mL/min/1.73m²" }),
  row("qtc_male", "exclusion", "qtcf_male", "gt", 450, "QTcF >450 ms for males at screening.", 0.94, { unit: "ms", ...qtc }),
  row("qtc_female", "exclusion", "qtcf_female", "gt", 470, "QTcF >470 ms for females at screening.", 0.94, { unit: "ms", ...qtc }),
  row("lung_surgery", "exclusion", "prior_lung_volume_reduction_surgery", "exists", null, "History of lung volume reduction surgery.", 0.65),
  row("lung_transplant", "exclusion", "solid_organ_transplant", "exists", null, "History of lung transplant.", 0.72),
  row("smoking", "exclusion", "current_smoker_or_positive_cotinine", "exists", null, "Current smoker and/or positive cotinine test.", 0.62),
  row("substance_abuse", "exclusion", "recent_drug_or_alcohol_abuse", "exists", null, "Drug or alcohol abuse within the past 3 months.", 0.55),
  row("major_surgery", "exclusion", "recent_or_planned_major_surgery", "exists", null, "Major surgery within 3 months before screening, during screening, or planned during the study.", 0.55),
  row("malignancy", "exclusion", "active_or_recent_malignancy", "exists", null, "Active or suspected malignancy or history of malignancy within 5 years before screening.", 0.58),
  row("warfarin", "exclusion", "warfarin_use", "exists", null, "Warfarin use within 4 weeks before screening, during screening, or planned during the study.", 0.64, prohibitedTherapy),
  row("immunosuppressive", "exclusion", "immunosuppressive_medication_use", "exists", null, "Immunosuppressive medication use within 4 weeks before screening, during screening, or planned during the study.", 0.64, prohibitedTherapy),
  row("pulmonary_vasodilators", "exclusion", "prohibited_pulmonary_vascular_therapy", "exists", null, "Current endothelin receptor antagonist, PDE5 inhibitor, soluble guanylate cyclase modulator, prostacyclin/prostanoid, or activin signaling inhibitor.", 0.58, prohibitedTherapy),
  row("nerandomilast", "exclusion", "recent_nerandomilast", "exists", null, "Nerandomilast treatment within 8 weeks before screening or during screening.", 0.62, prohibitedTherapy),
  row("cyp", "exclusion", "prohibited_cyp3a4_or_cyp1a2_drug", "exists", null, "Strong or moderate CYP3A4 or CYP1A2 inhibitors or inducers within 2 weeks before screening or planned during the study.", 0.58, prohibitedTherapy),
  row("qtc_drug", "exclusion", "qtc_prolonging_medication", "exists", null, "Medication associated with substantial QTc-prolongation risk within 2 weeks before screening or planned during the study.", 0.58, prohibitedTherapy),
  row("citrus", "exclusion", "prohibited_citrus_consumption", "exists", null, "Grapefruit, pomelo, Seville orange, or related products within 48 hours before Day 1.", 0.52),
  row("hrt", "exclusion", "hormone_replacement_therapy", "exists", null, "Hormone replacement therapy within 4 weeks before randomization or during the study.", 0.58),
  row("hypersensitivity", "exclusion", "serine_threonine_kinase_inhibitor_hypersensitivity", "exists", null, "Known hypersensitivity or contraindication to serine/threonine kinase inhibitors.", 0.58),
  row("assessment", "exclusion", "assessment_interference", "exists", null, "A condition that would interfere with study-assessment interpretation or impair participation.", 0.42),
  row("suitability", "exclusion", "investigator_determined_unsuitable", "exists", null, "A physical or psychological condition that may make the patient unsuitable or unable to complete study procedures.", 0.38),
];
