/**
 * Archetype C resolver — patient count / population (spec §6, resolver 4c).
 *
 * This is glue, not a new engine: it REUSES the existing deterministic matcher
 * (src/lib/matcher) end-to-end — `evaluateCohort` + `countCohorts` for the count,
 * `rankBottlenecks` for protocol softening, and `suppress` for small-cell privacy.
 * The questionnaire's criteria set is already a `Criterion[]` (the load-bearing type),
 * so the feasibility form feeds straight into the matcher with no translation.
 *
 * Output is aggregate-only and provenanced: the candidate count is a MODELED `Metric`
 * (TrialBridge-computed), suppressed to "<5" below the min cell. No patient rows ever
 * leave this function — the LGPD "results leave, data stays" invariant (spec §9).
 */

import { evaluateCohort, countCohorts, type CohortCounts } from "@/lib/matcher/engine";
import { rankBottlenecks } from "@/lib/matcher/soften";
import { suppress, MIN_CELL, type SafeCount } from "@/lib/matcher/aggregate";
import type { Criterion, Patient } from "@/lib/matcher/types";
import { Confidence, modeled, type Metric } from "@/lib/metric";

/** One criterion's softening delta, suppressed for display. */
export interface CriterionDelta {
  handle: string;
  label: string;
  rawTexts: string[];
  /** Additional patients who become definite if this criterion is relaxed (suppressed). */
  newlyDefinite: SafeCount;
  /** Additional patients who become possible if this criterion is relaxed (suppressed). */
  newlyPossible: SafeCount;
}

export interface CohortResult {
  /** The headline eligible-N as a provenanced Metric (candidates = definite + possible, suppressed). */
  count: Metric<number | string | null>;
  /** Was the candidate count suppressed (non-zero but < min cell)? */
  suppressed: boolean;
  /** Per-criterion softening deltas, ranked by pool growth (the marketplace differentiator). */
  perCriterionDeltas: CriterionDelta[];
  /** Unsuppressed counts — SERVER-SIDE ONLY, never sent to the sponsor UI. */
  _raw: CohortCounts;
}

/**
 * Resolve the eligible N for a criteria set over a site's patients, plus per-criterion
 * softening deltas. `asOf` is injected so the Metric stays clock-free.
 */
export function resolveCohort(
  patients: Patient[],
  criteria: Criterion[],
  asOf?: string | null,
): CohortResult {
  const evals = evaluateCohort(patients, criteria);
  const counts = countCohorts(evals);
  const candidates = counts.definite + counts.possible;
  const safe = suppress(candidates);
  const isSuppressed = candidates > 0 && candidates < MIN_CELL;

  const perCriterionDeltas: CriterionDelta[] = rankBottlenecks(patients, criteria).map((s) => ({
    handle: s.handle,
    label: s.label,
    rawTexts: s.rawTexts,
    newlyDefinite: suppress(s.newlyDefinite),
    newlyPossible: suppress(s.newlyPossible),
  }));

  const count = modeled<number | string | null>(
    "cohort.candidates",
    safe,
    isSuppressed ? Confidence.LOW : Confidence.HIGH,
    {
      unit: "patients",
      asOf: asOf ?? null,
      note: isSuppressed
        ? `candidate count <${MIN_CELL} suppressed for privacy`
        : `definite=${counts.definite}+possible=${counts.possible} of ${counts.total} evaluated`,
    },
  );

  return { count, suppressed: isSuppressed, perCriterionDeltas, _raw: counts };
}

/**
 * The `POST /cohorts/preview` payload shape (spec §7): {n, per_criterion_delta[],
 * suppressed}. Built from a `CohortResult` so the API never re-derives suppression.
 */
export interface CohortPreview {
  n: number | string | null;
  suppressed: boolean;
  perCriterionDelta: Array<{ handle: string; label: string; newlyDefinite: SafeCount; newlyPossible: SafeCount }>;
}

export function toCohortPreview(result: CohortResult): CohortPreview {
  return {
    n: result.count.value,
    suppressed: result.suppressed,
    perCriterionDelta: result.perCriterionDeltas.map((d) => ({
      handle: d.handle,
      label: d.label,
      newlyDefinite: d.newlyDefinite,
      newlyPossible: d.newlyPossible,
    })),
  };
}
