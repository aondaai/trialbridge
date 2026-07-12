/**
 * The load-bearing interface of TrialBridge.
 *
 * `Criterion` is the typed, machine-checkable representation shared by the parse
 * service, the deterministic matcher, and the softening simulator. Getting it
 * right is the whole ballgame (ADR-001).
 *
 * Semantic decisions baked in here (see the project /goal):
 *  - D1  Every patient resolves to a tri-state cohort: definite / possible / excluded.
 *  - D3  `unknown` is a first-class status. Missing data is never a silent fail and
 *        never a silent pass. For an exclusion criterion, missing data is treated
 *        conservatively (patient stays "possible", never auto-"definite").
 *  - D4  Composite protocol sentences (e.g. "adequate organ function" → several lab
 *        thresholds) expand into several Criterion rows that share a `groupId`. The
 *        softening UI toggles the whole group as one unit.
 */

export type Operator =
  | "eq"
  | "neq"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "in"
  | "not_in"
  | "exists"
  | "not_exists"
  | "between";

export type CriterionValue = string | number | (string | number)[] | null;

/**
 * Whether a real-world data source (e.g. a claims/EHR extract) can actually
 * answer this criterion for a given patient — a fact about the DATA SOURCE,
 * not about any individual patient record. Purely descriptive metadata for
 * the UI/report layer; the matcher's pass/fail/unknown logic (D3) already
 * handles missingness correctly regardless of whether this is set.
 *
 *  - "pass_able"    — routinely captured (e.g. age, diagnosis code).
 *  - "partial"      — sometimes captured; real, measurable missingness.
 *  - "not_evaluable" — the data source structurally can't (or essentially
 *    never does) capture this, independent of any one patient's record.
 */
export type Evaluability = "pass_able" | "partial" | "not_evaluable";

/** How the real base can answer a criterion. See src/lib/basefit/registry.ts. */
export type BaseFit = "checkable" | "depth" | "nlp_extractable" | "not_answerable";

export interface Criterion {
  /** Stable id, referenced by the matcher and the softening UI. */
  id: string;
  kind: "inclusion" | "exclusion";
  /** Patient field this rule reads, e.g. "ecog", "her2_status", "creatinine". */
  field: string;
  operator: Operator;
  value: CriterionValue;
  /** Unit for numeric/lab comparisons, e.g. "mg/dL". Canonicalized before compare (D5). */
  unit?: string | null;
  /** Original protocol sentence — travels with the rule for audit + UI. */
  rawText: string;
  /** Parser self-report 0..1; low-confidence rows are flagged for human verification. */
  confidence: number;
  /**
   * D4 composite grouping. Criteria derived from one protocol sentence share a
   * `groupId`; the softening simulator relaxes them together. Ungrouped criteria
   * are softened individually (groupId falls back to the criterion id).
   */
  groupId?: string;
  groupLabel?: string;
  /** Optional data-source evaluability tag — see `Evaluability`. */
  evaluability?: Evaluability;
  /** Base-fit tier — which real data source (if any) answers this. */
  baseFit?: BaseFit;
  /** nlp_extractable rows only: pt-BR clinical-text phrases the NLP layer would search. */
  nlpTerms?: string[];
}

/** Per-criterion, per-patient outcome. `pass` always means "good for eligibility". */
export type CriterionStatus = "pass" | "fail" | "unknown";

export interface CriterionResult {
  criterionId: string;
  field: string;
  kind: "inclusion" | "exclusion";
  status: CriterionStatus;
  /** The original protocol sentence, so the UI can show *why* next to the verdict. */
  rawText: string;
  /** The patient's observed value for this field, or undefined if missing. */
  observed: CriterionValue | undefined;
  groupId: string;
}

/** D1 tri-state cohort. */
export type Cohort = "definite" | "possible" | "excluded";

export interface PatientEvaluation {
  patientId: string;
  cohort: Cohort;
  results: CriterionResult[];
  /** Criteria that came back `unknown` (drive the "possible" classification). */
  unknownCriterionIds: string[];
  /** Criteria that came back `fail` (drive the "excluded" classification). */
  failedCriterionIds: string[];
}

/**
 * Synthetic patient record. Biomarkers and labs are open maps so the schema
 * generalises beyond the hero protocol. Labs are canonicalized to a fixed unit
 * at seed time (D5); `null` means the value was never recorded → `unknown`.
 */
export interface LabValue {
  value: number;
  unit: string;
}

export interface Patient {
  id: string;
  siteId: string;
  diagnosis: string;
  stage: string | null;
  /** e.g. { her2_status: "positive", er_status: "negative", pdl1: null } */
  biomarkers: Record<string, string | number | null>;
  priorLines: number | null;
  ecog: number | null;
  /** e.g. { creatinine: { value: 0.9, unit: "mg/dL" }, hemoglobin: null } */
  labs: Record<string, LabValue | null>;
  sex: string | null;
  age: number | null;
}
