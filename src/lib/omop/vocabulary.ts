/**
 * Field -> OMOP concept shape. Covers every `Criterion.field` in the
 * parser's vocabulary (src/lib/parse.ts SYSTEM_PROMPT) plus the extra
 * fields used by the NSCLC fixture (src/data/nsclc-kras-protocol.ts).
 *
 * domain/table/vocabularyId are asserted with confidence — they follow
 * directly from the OMOP CDM spec and PRD v4's Tier 2 mapping table
 * (docs/trialbridge-prd-v4.md). Numeric `conceptId` is left unset (defaults
 * to 0/unmapped in transform.ts) unless explicitly verified below. See
 * docs/omop-vocabulary-mapping.md for the full verified-vs-placeholder ledger.
 */

import type { OmopDomain, OmopTable, VocabularyId } from "./types";

export interface FieldConcept {
  domain: OmopDomain;
  table: OmopTable;
  vocabularyId: VocabularyId;
  conceptName: string;
  /** Only set for concepts checked against a real, citable vocabulary source. */
  conceptId?: number;
  verified?: boolean;
}

export const FIELD_CONCEPT_MAP: Record<string, FieldConcept> = {
  age: {
    domain: "Person",
    table: "person",
    vocabularyId: "None",
    conceptName: "Age (derived from person.birth_datetime, not concept-coded)",
  },
  sex: {
    domain: "Person",
    table: "person",
    vocabularyId: "Gender",
    conceptName: "Sex/gender (OMOP Gender vocabulary)",
  },
  diagnosis: {
    domain: "Condition",
    table: "condition_occurrence",
    vocabularyId: "SNOMED",
    conceptName: "Primary diagnosis",
  },
  stage: {
    domain: "Observation",
    table: "observation",
    vocabularyId: "SNOMED",
    conceptName: "Cancer stage (TNM/AJCC) — PRD v4 flags this as not consistently structured in Tier 2",
  },
  histology: {
    domain: "Observation",
    table: "observation",
    vocabularyId: "SNOMED",
    conceptName: "Tumor histology",
  },
  her2_status: {
    domain: "Measurement",
    table: "measurement",
    vocabularyId: "LOINC",
    conceptName: "HER2 status (IHC/ISH)",
  },
  er_status: {
    domain: "Measurement",
    table: "measurement",
    vocabularyId: "LOINC",
    conceptName: "Estrogen receptor status",
  },
  pr_status: {
    domain: "Measurement",
    table: "measurement",
    vocabularyId: "LOINC",
    conceptName: "Progesterone receptor status",
  },
  pdl1_status: {
    domain: "Measurement",
    table: "measurement",
    vocabularyId: "LOINC",
    conceptName: "PD-L1 expression status",
  },
  kras_g12c: {
    domain: "Measurement",
    table: "measurement",
    vocabularyId: "LOINC",
    conceptName: "KRAS G12C mutation status (NGS)",
  },
  ecog: {
    domain: "Measurement",
    table: "measurement",
    vocabularyId: "LOINC",
    conceptName: "ECOG performance status score",
  },
  prior_lines: {
    domain: "Drug",
    table: "drug_exposure",
    vocabularyId: "RxNorm",
    conceptName: "Prior lines of systemic anticancer therapy",
  },
  prior_kras_inhibitor: {
    domain: "Drug",
    table: "drug_exposure",
    vocabularyId: "RxNorm",
    conceptName: "Prior KRAS G12C inhibitor exposure",
  },
  brain_metastases: {
    domain: "Condition",
    table: "condition_occurrence",
    vocabularyId: "SNOMED",
    conceptName: "Brain metastases",
  },
  mi_recent: {
    domain: "Condition",
    table: "condition_occurrence",
    vocabularyId: "SNOMED",
    conceptName: "Recent myocardial infarction",
  },
  ejection_fraction: {
    domain: "Measurement",
    table: "measurement",
    vocabularyId: "LOINC",
    conceptName: "Left ventricular ejection fraction",
  },
  creatinine: {
    domain: "Measurement",
    table: "measurement",
    vocabularyId: "LOINC",
    conceptName: "Serum creatinine",
  },
  hemoglobin: {
    domain: "Measurement",
    table: "measurement",
    vocabularyId: "LOINC",
    conceptName: "Hemoglobin",
  },
  platelets: {
    domain: "Measurement",
    table: "measurement",
    vocabularyId: "LOINC",
    conceptName: "Platelet count",
  },
  bilirubin: {
    domain: "Measurement",
    table: "measurement",
    vocabularyId: "LOINC",
    conceptName: "Total bilirubin",
  },
};

/**
 * The one verified mapping in this file — OMOP's stable, ubiquitous Gender
 * vocabulary (Male=8507, Female=8532). Keyed by lowercase Criterion.value.
 */
export const VERIFIED_GENDER_CONCEPTS: Record<string, number> = {
  male: 8507,
  female: 8532,
};

/** Fallback for any field not yet in FIELD_CONCEPT_MAP — the transform never throws on an unknown field. */
export const UNMAPPED_FIELD_CONCEPT: FieldConcept = {
  domain: "Observation",
  table: "observation",
  vocabularyId: "None",
  conceptName: "Unmapped field",
};
