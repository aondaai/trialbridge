/**
 * D2 — the protocol-softening simulator.
 *
 * Two distinct relaxation modes, both re-running the pure matcher (trivially
 * correct and instant because the engine is a pure function):
 *
 *   softenCriterion — DROP a criterion (or composite group, D4) entirely.
 *   relaxToVariant  — WIDEN one criterion's accepted value set without
 *                     dropping it (e.g. PD-L1 "negative" -> "negative or low").
 *                     The honest lever when the real trade is "accept more
 *                     values", not "stop requiring this at all".
 *
 * The honesty requirement (D2, shared by both modes): when you relax a mostly-
 * *unknown* criterion, the candidate pool jumps — but most of that jump is
 * patients who were only ever `unknown` on that field. Counting them as
 * "newly definite" without saying so is the exact overcount TrialBridge
 * claims to fix. So the delta is always split:
 *
 *   newlyDefiniteFromFail    — were EXCLUDED because they FAILED this criterion,
 *                              now eligible. Genuine expansion (e.g. HER2- patients).
 *   newlyDefiniteFromUnknown — were POSSIBLE only because this field was UNKNOWN,
 *                              now "definite" purely because we stopped requiring it.
 *                              The caveat bucket — still unproven on that axis.
 *   newlyPossible            — were EXCLUDED, now merely POSSIBLE (they still carry
 *                              other unknowns), so not a confirmed gain.
 */

import { Criterion, CriterionValue, PatientEvaluation } from "./types";
import { evaluateCohort, countCohorts, CohortCounts, groupHandle, evaluatePatient } from "./engine";
import { Patient } from "./types";

export interface SofteningResult {
  /** The group handle (groupId or criterion id) that was relaxed. */
  handle: string;
  label: string;
  /** rawText of the relaxed criteria, for the UI. */
  rawTexts: string[];
  baseline: CohortCounts;
  relaxed: CohortCounts;
  newlyDefiniteFromFail: number;
  newlyDefiniteFromUnknown: number;
  newlyPossible: number;
  /** Total definite gain = fromFail + fromUnknown (for the headline number). */
  newlyDefinite: number;
}

/** List the distinct softenable handles in a protocol (one per criterion/group). */
export function softenableHandles(
  criteria: Criterion[],
): { handle: string; label: string; rawTexts: string[] }[] {
  const seen = new Map<string, { handle: string; label: string; rawTexts: string[] }>();
  for (const c of criteria) {
    const handle = groupHandle(c);
    const existing = seen.get(handle);
    if (existing) {
      existing.rawTexts.push(c.rawText);
    } else {
      seen.set(handle, {
        handle,
        label: c.groupLabel ?? c.rawText,
        rawTexts: [c.rawText],
      });
    }
  }
  return [...seen.values()];
}

/** Remove every criterion belonging to a handle (single id or whole group). */
function withoutHandle(criteria: Criterion[], handle: string): Criterion[] {
  return criteria.filter((c) => groupHandle(c) !== handle);
}

type RelaxationDiff = Pick<
  SofteningResult,
  "baseline" | "relaxed" | "newlyDefiniteFromFail" | "newlyDefiniteFromUnknown" | "newlyPossible" | "newlyDefinite"
>;

/**
 * Shared before/after diff + honesty split (D2). Used by every relaxation
 * mode (`softenCriterion`, `relaxToVariant`) so the attribution logic — and
 * the guarantee that a pool jump is never presented as more than it is —
 * lives in exactly one place.
 */
function diffRelaxation(
  patients: Patient[],
  baseEvals: PatientEvaluation[],
  relaxedEvals: PatientEvaluation[],
  handle: string,
): RelaxationDiff {
  const baseline = countCohorts(baseEvals);
  const relaxed = countCohorts(relaxedEvals);

  let fromFail = 0;
  let fromUnknown = 0;
  let toPossible = 0;

  for (let i = 0; i < patients.length; i++) {
    const before = baseEvals[i];
    const after = relaxedEvals[i];
    if (before.cohort === after.cohort) continue;

    const failedThisHandle = before.results.some(
      (r) => r.groupId === handle && r.status === "fail",
    );
    const unknownThisHandle = before.results.some(
      (r) => r.groupId === handle && r.status === "unknown",
    );

    if (after.cohort === "definite" && before.cohort !== "definite") {
      // Attribute the gain to the reason this handle was blocking them.
      if (failedThisHandle) fromFail += 1;
      else if (unknownThisHandle) fromUnknown += 1;
      else fromFail += 1; // conservative default: count as genuine, not caveat
    } else if (after.cohort === "possible" && before.cohort === "excluded") {
      toPossible += 1;
    }
  }

  return {
    baseline,
    relaxed,
    newlyDefiniteFromFail: fromFail,
    newlyDefiniteFromUnknown: fromUnknown,
    newlyPossible: toPossible,
    newlyDefinite: fromFail + fromUnknown,
  };
}

/**
 * Simulate relaxing one handle across a cohort by DROPPING it entirely. Takes
 * the pre-computed baseline evaluations to avoid recomputing them per handle.
 */
export function softenCriterion(
  patients: Patient[],
  criteria: Criterion[],
  handle: string,
  baselineEvals?: PatientEvaluation[],
): SofteningResult {
  const baseEvals = baselineEvals ?? evaluateCohort(patients, criteria);
  const relaxedCriteria = withoutHandle(criteria, handle);
  const meta = softenableHandles(criteria).find((h) => h.handle === handle);
  const relaxedEvals = patients.map((p) => evaluatePatient(p, relaxedCriteria));

  return {
    handle,
    label: meta?.label ?? handle,
    rawTexts: meta?.rawTexts ?? [],
    ...diffRelaxation(patients, baseEvals, relaxedEvals, handle),
  };
}

/**
 * Simulate relaxing ONE criterion by WIDENING its accepted value set instead
 * of dropping it — e.g. `pdl1_status in ["negative"]` -> `in ["negative",
 * "low"]`. The criterion stays in force; only what it accepts changes. Same
 * honesty split (D2) as `softenCriterion`. `criterionId` must name a single
 * `Criterion.id` (not a group handle) since only one row's value is replaced.
 */
export function relaxToVariant(
  patients: Patient[],
  criteria: Criterion[],
  criterionId: string,
  newValue: CriterionValue,
  baselineEvals?: PatientEvaluation[],
): SofteningResult {
  const target = criteria.find((c) => c.id === criterionId);
  if (!target) throw new Error(`relaxToVariant: no criterion with id "${criterionId}"`);

  const baseEvals = baselineEvals ?? evaluateCohort(patients, criteria);
  const handle = groupHandle(target);
  const relaxedCriteria = criteria.map((c) => (c.id === criterionId ? { ...c, value: newValue } : c));
  const relaxedEvals = patients.map((p) => evaluatePatient(p, relaxedCriteria));

  return {
    handle,
    label: target.groupLabel ?? target.rawText,
    rawTexts: [target.rawText],
    ...diffRelaxation(patients, baseEvals, relaxedEvals, handle),
  };
}

/** Rank every handle by how much relaxing it grows the definite pool (bottleneck finder). */
export function rankBottlenecks(
  patients: Patient[],
  criteria: Criterion[],
): SofteningResult[] {
  const baseEvals = evaluateCohort(patients, criteria);
  return softenableHandles(criteria)
    .map((h) => softenCriterion(patients, criteria, h.handle, baseEvals))
    .sort((a, b) => b.newlyDefinite + b.newlyPossible - (a.newlyDefinite + a.newlyPossible));
}
