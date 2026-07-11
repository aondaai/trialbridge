/**
 * Normalizers — raw metric → 0..100 (engineering spec §6.1).
 *
 * A scorecard composite is a weighted mean of sub-scores, and a weighted mean is
 * only meaningful if every input lives on the same 0..100 scale with the same
 * "higher = better" polarity. Each dimension/component declares WHICH normalizer it
 * uses and its direction, so a $ cost, a day-count, and a checklist all become
 * comparable. Pure arithmetic — no I/O, no clock.
 *
 * Three rules, matching the product spec §10.1:
 *   - benchmark-relative: vs. the program's US/EU benchmark. 50 = parity, 100 = best.
 *   - absolute-anchored:  piecewise-linear over fixed (input, score) anchors.
 *   - categorical:        presence / tier lookup.
 */

/** Clamp to the 0..100 score range. */
export function clampScore(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(100, x));
}

export type Direction = "higher" | "lower";

/**
 * Benchmark-relative: score a value against a program benchmark, 50 = parity.
 *
 * `better="higher"` (e.g. patients/month): score = 50·(value/benchmark), so parity→50,
 * 2×benchmark→100, 0→0.
 * `better="lower"` (e.g. cost/patient, time): score = 50·(2 − value/benchmark), so
 * parity→50, half→75, zero→100, 2×→0.
 *
 * Deliberately a simple linear curve capped at 2× (documented, not tuned). If the
 * benchmark is 0/negative/NaN the comparison is undefined → returns 50 (parity, we
 * assert nothing).
 */
export function normBenchmarkRelative(
  value: number,
  benchmark: number,
  better: Direction = "higher",
): number {
  if (!Number.isFinite(benchmark) || benchmark <= 0 || !Number.isFinite(value)) return 50;
  const ratio = value / benchmark;
  const raw = better === "lower" ? 50 * (2 - ratio) : 50 * ratio;
  return clampScore(raw);
}

/** A normalization anchor: an input value mapped to a 0..100 score. */
export type Anchor = [input: number, score: number];

/**
 * Absolute, anchored: piecewise-linear interpolation over `anchors` (sorted by input
 * ascending). Below the first anchor clamps to its score; above the last clamps to
 * its score. Score direction is free — anchors can descend (e.g. time_to_fpi:
 * [(90,100),(180,70),(270,40),(365,0)]) or ascend.
 */
export function normAbsolute(value: number, anchors: Anchor[]): number {
  if (anchors.length === 0) return 0;
  const sorted = [...anchors].sort((a, b) => a[0] - b[0]);
  if (!Number.isFinite(value)) return 0;
  if (value <= sorted[0][0]) return clampScore(sorted[0][1]);
  const last = sorted[sorted.length - 1];
  if (value >= last[0]) return clampScore(last[1]);
  for (let i = 0; i < sorted.length - 1; i++) {
    const [x0, s0] = sorted[i];
    const [x1, s1] = sorted[i + 1];
    if (value >= x0 && value <= x1) {
      const t = x1 === x0 ? 0 : (value - x0) / (x1 - x0);
      return clampScore(s0 + t * (s1 - s0));
    }
  }
  return clampScore(last[1]); // unreachable given the bounds checks
}

/**
 * Categorical: look a value up in a tier/presence map. Unknown keys fall to
 * `fallback` (default 0). Boolean inputs are coerced to "true"/"false" keys so a
 * presence check reads naturally.
 */
export function normCategorical(
  value: string | number | boolean,
  mapping: Record<string, number>,
  fallback = 0,
): number {
  const key = typeof value === "boolean" ? String(value) : String(value);
  const score = mapping[key];
  return score == null ? clampScore(fallback) : clampScore(score);
}

/**
 * A checklist fit ratio → 0..100 (used by infrastructure_fit): fraction of required
 * items present, as a percentage. `required` = 0 means "nothing required" → full fit.
 */
export function normChecklist(present: number, required: number): number {
  if (required <= 0) return 100;
  return clampScore((100 * Math.max(0, Math.min(present, required))) / required);
}
