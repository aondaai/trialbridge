/**
 * Patient[] -> OMOP CDM coding view. The site-side counterpart to transform.ts
 * (which codes a sponsor's Criterion[]). Pure — the only I/O is the frozen
 * concept map read through conceptResolver, exactly like transform.ts.
 *
 * This is what turns the site's STRUCTURED patient database into an OMOP DB
 * deliverable: every source field a site uploaded is coded to an OMOP
 * domain/table/vocabulary/concept_id, honestly flagged verified vs. needs-mapping
 * (only fields backed by the Athena vocab bundle resolve to a real concept_id;
 * everything else stays needsMapping rather than inventing a code). We summarise
 * per field with cohort coverage and emit a few concrete CDM rows so the view is
 * tangible without exploding thousands of rows into the page.
 */

import type { Patient } from "@/lib/matcher/types";
import type { Criterion } from "@/lib/matcher/types";
import type { OmopConcept, OmopTable } from "./types";
import { resolveConcept } from "./conceptResolver";
import { VERIFIED_GENDER_CONCEPTS } from "./vocabulary";

/** OMOP concept id for a person's gender, from the stable OMOP Gender vocabulary. */
const GENDER_CONCEPT_BY_SEX: Record<string, number> = {
  f: VERIFIED_GENDER_CONCEPTS.female,
  female: VERIFIED_GENDER_CONCEPTS.female,
  m: VERIFIED_GENDER_CONCEPTS.male,
  male: VERIFIED_GENDER_CONCEPTS.male,
};

/**
 * The OMOP-relevant fields we extract from a Patient, in CDM-table order. Each
 * entry names the concept key used by FIELD_CONCEPT_MAP / the concept resolver
 * and how to pull the observed value off a Patient record.
 */
interface FieldSpec {
  /** Concept key (matches FIELD_CONCEPT_MAP and Criterion.field). */
  key: string;
  /** Human label for the source column. */
  label: string;
  extract: (p: Patient) => { value: string | number; unit?: string } | null;
}

function labVal(p: Patient, k: string) {
  const v = p.labs?.[k];
  return v == null ? null : { value: v.value, unit: v.unit };
}
function bioVal(p: Patient, k: string) {
  const v = p.biomarkers?.[k];
  return v == null || v === "" ? null : { value: v };
}

const FIELD_SPECS: FieldSpec[] = [
  { key: "sex", label: "Sex / gender", extract: (p) => (p.sex ? { value: p.sex } : null) },
  { key: "age", label: "Age", extract: (p) => (p.age == null ? null : { value: p.age, unit: "years" }) },
  { key: "diagnosis", label: "Primary diagnosis", extract: (p) => (p.diagnosis ? { value: p.diagnosis } : null) },
  { key: "stage", label: "Cancer stage", extract: (p) => (p.stage ? { value: p.stage } : null) },
  { key: "histology", label: "Histology", extract: (p) => bioVal(p, "histology") },
  { key: "her2_status", label: "HER2 status", extract: (p) => bioVal(p, "her2_status") },
  { key: "er_status", label: "ER status", extract: (p) => bioVal(p, "er_status") },
  { key: "pr_status", label: "PR status", extract: (p) => bioVal(p, "pr_status") },
  { key: "pdl1_status", label: "PD-L1 status", extract: (p) => bioVal(p, "pdl1_status") },
  { key: "kras_g12c", label: "KRAS G12C", extract: (p) => bioVal(p, "kras_g12c") },
  { key: "brain_metastases", label: "Brain metastases", extract: (p) => bioVal(p, "brain_metastases") },
  { key: "mi_recent", label: "Recent MI", extract: (p) => bioVal(p, "mi_recent") },
  { key: "ecog", label: "ECOG", extract: (p) => (p.ecog == null ? null : { value: p.ecog }) },
  { key: "creatinine", label: "Creatinine", extract: (p) => labVal(p, "creatinine") },
  { key: "hemoglobin", label: "Hemoglobin", extract: (p) => labVal(p, "hemoglobin") },
  { key: "platelets", label: "Platelets", extract: (p) => labVal(p, "platelets") },
  { key: "bilirubin", label: "Bilirubin", extract: (p) => labVal(p, "bilirubin") },
  { key: "ejection_fraction", label: "LVEF", extract: (p) => labVal(p, "ejection_fraction") },
  { key: "prior_lines", label: "Prior therapy lines", extract: (p) => (p.priorLines == null ? null : { value: p.priorLines }) },
  { key: "prior_kras_inhibitor", label: "Prior KRAS inhibitor", extract: (p) => bioVal(p, "prior_kras_inhibitor") },
];

/** A stub Criterion so we can reuse the shared concept resolver per field. */
function conceptFor(key: string, sampleValue: string | number): OmopConcept {
  const c: Criterion = {
    id: `omop-${key}`,
    field: key,
    kind: "inclusion",
    operator: "eq",
    value: typeof sampleValue === "number" ? sampleValue : String(sampleValue),
    rawText: "",
    confidence: 1,
  };
  return resolveConcept(c);
}

export interface OmopFieldCoding {
  sourceField: string;
  label: string;
  domain: string;
  table: OmopTable;
  vocabularyId: string;
  conceptId: number;
  conceptName: string;
  verified: boolean;
  /** How many patients in the cohort carry a value for this field. */
  patientsWithValue: number;
  coveragePct: number;
}

export interface OmopCdmRow {
  personId: string;
  table: OmopTable;
  sourceField: string;
  conceptId: number;
  conceptName: string;
  vocabularyId: string;
  value: string;
}

export interface PatientOmopView {
  personCount: number;
  fields: OmopFieldCoding[];
  rowCountsByTable: Record<string, number>;
  totalRows: number;
  verifiedFieldCount: number;
  mappedFieldCount: number;
  /** A few concrete CDM rows (first patients) so the coding is tangible. */
  sampleRows: OmopCdmRow[];
}

/**
 * Build the OMOP CDM coding view for a set of structured patient records.
 * @param samplePersons how many patients to expand into concrete sample CDM rows.
 */
export function patientToOmop(patients: Patient[], samplePersons = 3): PatientOmopView {
  const fields: OmopFieldCoding[] = [];
  const rowCountsByTable: Record<string, number> = {};
  let totalRows = 0;

  for (const spec of FIELD_SPECS) {
    // Find a representative value to resolve the concept, and count coverage.
    let sample: string | number | null = null;
    let withValue = 0;
    for (const p of patients) {
      const got = spec.extract(p);
      if (got != null) {
        withValue++;
        if (sample === null) sample = got.value;
      }
    }
    if (withValue === 0 && patients.length > 0) {
      // Field never populated in this cohort — skip it from the coding table.
      continue;
    }

    const concept = conceptFor(spec.key, sample ?? "");
    fields.push({
      sourceField: spec.key,
      label: spec.label,
      domain: concept.domain,
      table: concept.table,
      vocabularyId: concept.vocabularyId,
      conceptId: spec.key === "sex" ? genderConceptId(sample) : concept.conceptId,
      conceptName: concept.conceptName,
      verified: spec.key === "sex" ? genderConceptId(sample) !== 0 : concept.verified,
      patientsWithValue: withValue,
      coveragePct: patients.length ? Math.round((100 * withValue) / patients.length) : 0,
    });

    rowCountsByTable[concept.table] = (rowCountsByTable[concept.table] ?? 0) + withValue;
    totalRows += withValue;
  }

  // Concrete sample rows for the first N patients.
  const sampleRows: OmopCdmRow[] = [];
  for (const p of patients.slice(0, samplePersons)) {
    for (const spec of FIELD_SPECS) {
      const got = spec.extract(p);
      if (got == null) continue;
      const concept = conceptFor(spec.key, got.value);
      const conceptId = spec.key === "sex" ? genderConceptId(got.value) : concept.conceptId;
      sampleRows.push({
        personId: p.id,
        table: concept.table,
        sourceField: spec.key,
        conceptId,
        conceptName: concept.conceptName,
        vocabularyId: concept.vocabularyId,
        value: got.unit ? `${got.value} ${got.unit}` : String(got.value),
      });
    }
  }

  return {
    personCount: patients.length,
    fields,
    rowCountsByTable,
    totalRows,
    verifiedFieldCount: fields.filter((f) => f.verified).length,
    mappedFieldCount: fields.length,
    sampleRows,
  };
}

function genderConceptId(sample: string | number | null): number {
  if (sample == null) return 0;
  return GENDER_CONCEPT_BY_SEX[String(sample).toLowerCase()] ?? 0;
}
