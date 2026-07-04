/**
 * The deterministic matching engine.
 *
 * A PURE function: no I/O, no model calls, no randomness. `(patient, Criterion[])`
 * in, a fully-explained evaluation out. Purity is what makes it unit-testable,
 * instant, and honest — it is the source of truth the ADR forbids an LLM from
 * touching.
 *
 * Status convention (uniform across inclusion & exclusion so the UI reads simply):
 *   pass    → good for eligibility on this criterion
 *   fail    → disqualifies the patient on this criterion
 *   unknown → the patient record lacks the data this criterion needs (D3)
 *
 * Cohort (D1):
 *   excluded → any criterion is `fail`
 *   possible → no fails, but ≥1 `unknown`
 *   definite → every criterion `pass`, zero unknowns
 */

import {
  Criterion,
  CriterionResult,
  CriterionStatus,
  CriterionValue,
  Cohort,
  Patient,
  PatientEvaluation,
} from "./types";
import { canonicalizeLab, CANONICAL_UNIT } from "./units";

/** The stable softening handle for a criterion: its group if any, else its own id. */
export function groupHandle(c: Criterion): string {
  return c.groupId ?? c.id;
}

interface Resolved {
  present: boolean;
  value?: string | number;
  unit?: string;
}

/** Resolve a criterion's `field` against a patient record. Missing/null → not present. */
function resolveField(patient: Patient, field: string): Resolved {
  switch (field) {
    case "age":
      return present(patient.age);
    case "ecog":
      return present(patient.ecog);
    case "prior_lines":
      return present(patient.priorLines);
    case "sex":
      return present(patient.sex);
    case "stage":
      return present(patient.stage);
    case "diagnosis":
      return present(patient.diagnosis);
    default:
      break;
  }
  // Lab field (value + unit)?
  if (field in patient.labs) {
    const lab = patient.labs[field];
    if (lab === null || lab === undefined) return { present: false };
    return { present: true, value: lab.value, unit: lab.unit };
  }
  // Biomarker / free field?
  if (field in patient.biomarkers) {
    const v = patient.biomarkers[field];
    if (v === null || v === undefined) return { present: false };
    return { present: true, value: v };
  }
  return { present: false };
}

function present(v: string | number | null | undefined): Resolved {
  if (v === null || v === undefined) return { present: false };
  return { present: true, value: v };
}

/** Does the observed value satisfy the criterion's operator/value? null → cannot tell. */
function satisfies(
  field: string,
  operator: Criterion["operator"],
  target: CriterionValue,
  targetUnit: string | null | undefined,
  observed: string | number,
  observedUnit: string | undefined,
): boolean | null {
  // Presence operators don't need the value itself.
  if (operator === "exists") return true; // resolved => present
  if (operator === "not_exists") return false;

  // Numeric comparisons: canonicalize units on both sides (D5).
  const numericOps = ["lt", "lte", "gt", "gte", "between"];
  if (numericOps.includes(operator)) {
    const obs = toCanonicalNumber(field, observed, observedUnit);
    if (obs === null) return null;
    if (operator === "between") {
      if (!Array.isArray(target) || target.length !== 2) return null;
      const lo = toCanonicalNumber(field, target[0], targetUnit);
      const hi = toCanonicalNumber(field, target[1], targetUnit);
      if (lo === null || hi === null) return null;
      return obs >= lo && obs <= hi;
    }
    const t = toCanonicalNumber(field, target as string | number, targetUnit);
    if (t === null) return null;
    switch (operator) {
      case "lt":
        return obs < t;
      case "lte":
        return obs <= t;
      case "gt":
        return obs > t;
      case "gte":
        return obs >= t;
    }
  }

  // Set membership.
  if (operator === "in" || operator === "not_in") {
    if (!Array.isArray(target)) return null;
    const hit = target.map(norm).includes(norm(observed));
    return operator === "in" ? hit : !hit;
  }

  // Scalar equality.
  if (operator === "eq") return norm(observed) === norm(target as string | number);
  if (operator === "neq") return norm(observed) !== norm(target as string | number);

  return null;
}

/** Convert an observed/target numeric to the field's canonical unit, or null if impossible. */
function toCanonicalNumber(
  field: string,
  raw: string | number,
  unit: string | undefined | null,
): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  if (!(field in CANONICAL_UNIT)) return n; // non-lab numeric (age, ecog, prior_lines)
  const c = canonicalizeLab(field, n, unit);
  return c.canonicalized ? c.value : null; // unreconcilable unit → cannot compare (D5)
}

function norm(v: string | number): string {
  return String(v).trim().toLowerCase();
}

/** Evaluate one criterion against one patient. */
function evaluateCriterion(patient: Patient, c: Criterion): CriterionResult {
  const resolved = resolveField(patient, c.field);
  const base = {
    criterionId: c.id,
    field: c.field,
    kind: c.kind,
    rawText: c.rawText,
    groupId: groupHandle(c),
  };

  // Missing data → unknown, regardless of inclusion/exclusion (D3).
  // Exception: not_exists on a missing field is satisfiable ("patient does NOT have X").
  if (!resolved.present) {
    if (c.operator === "not_exists") {
      // Absence is exactly what not_exists checks; treat as answerable.
      return { ...base, status: verdict(c, true), observed: undefined };
    }
    if (c.operator === "exists") {
      return { ...base, status: verdict(c, false), observed: undefined };
    }
    return { ...base, status: "unknown", observed: undefined };
  }

  const sat = satisfies(
    c.field,
    c.operator,
    c.value,
    c.unit,
    resolved.value as string | number,
    resolved.unit,
  );
  if (sat === null) {
    return { ...base, status: "unknown", observed: resolved.value };
  }
  return { ...base, status: verdict(c, sat), observed: resolved.value };
}

/**
 * Turn "criterion condition satisfied?" into an eligibility status.
 *  - inclusion satisfied  → pass;  not satisfied → fail
 *  - exclusion satisfied  → fail (patient HAS the excluding condition);
 *    exclusion not satisfied → pass
 */
function verdict(c: Criterion, conditionMet: boolean): CriterionStatus {
  if (c.kind === "inclusion") return conditionMet ? "pass" : "fail";
  return conditionMet ? "fail" : "pass";
}

/** Classify a set of per-criterion results into the tri-state cohort (D1). */
export function classify(results: CriterionResult[]): Cohort {
  if (results.some((r) => r.status === "fail")) return "excluded";
  if (results.some((r) => r.status === "unknown")) return "possible";
  return "definite";
}

/** Evaluate a patient against a whole protocol. The one entry point. */
export function evaluatePatient(
  patient: Patient,
  criteria: Criterion[],
): PatientEvaluation {
  const results = criteria.map((c) => evaluateCriterion(patient, c));
  return {
    patientId: patient.id,
    cohort: classify(results),
    results,
    unknownCriterionIds: results.filter((r) => r.status === "unknown").map((r) => r.criterionId),
    failedCriterionIds: results.filter((r) => r.status === "fail").map((r) => r.criterionId),
  };
}

/** Evaluate a whole cohort. */
export function evaluateCohort(
  patients: Patient[],
  criteria: Criterion[],
): PatientEvaluation[] {
  return patients.map((p) => evaluatePatient(p, criteria));
}

export interface CohortCounts {
  definite: number;
  possible: number;
  excluded: number;
  total: number;
}

export function countCohorts(evals: PatientEvaluation[]): CohortCounts {
  const counts = { definite: 0, possible: 0, excluded: 0, total: evals.length };
  for (const e of evals) counts[e.cohort] += 1;
  return counts;
}
