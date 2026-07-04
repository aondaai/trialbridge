/**
 * D2 — the protocol-softening simulator.
 *
 * "Relaxing" a criterion (or a composite group, D4) means dropping it from the
 * protocol and re-running the pure matcher. Because the matcher is a pure
 * function, this is trivially correct and instant.
 *
 * The honesty requirement (D2): when you relax a mostly-*unknown* criterion, the
 * candidate pool jumps — but most of that jump is patients who were only ever
 * `unknown` on that field. Counting them as "newly definite" without saying so is
 * the exact overcount TrialBridge claims to fix. So the delta is split:
 *
 *   newlyDefiniteFromFail    — were EXCLUDED because they FAILED this criterion,
 *                              now eligible. Genuine expansion (e.g. HER2- patients).
 *   newlyDefiniteFromUnknown — were POSSIBLE only because this field was UNKNOWN,
 *                              now "definite" purely because we stopped requiring it.
 *                              The caveat bucket — still unproven on that axis.
 *   newlyPossible            — were EXCLUDED, now merely POSSIBLE (they still carry
 *                              other unknowns), so not a confirmed gain.
 */

import { Criterion, PatientEvaluation } from "./types";
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

/**
 * Simulate relaxing one handle across a cohort. Takes the pre-computed baseline
 * evaluations to avoid recomputing them per handle.
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

  const baseline = countCohorts(baseEvals);
  const relaxedEvals = patients.map((p) => evaluatePatient(p, relaxedCriteria));
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
    handle,
    label: meta?.label ?? handle,
    rawTexts: meta?.rawTexts ?? [],
    baseline,
    relaxed,
    newlyDefiniteFromFail: fromFail,
    newlyDefiniteFromUnknown: fromUnknown,
    newlyPossible: toPossible,
    newlyDefinite: fromFail + fromUnknown,
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
