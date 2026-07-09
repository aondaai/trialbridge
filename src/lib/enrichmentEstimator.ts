/**
 * The enrichment estimator — `estimated eligible = base cohort × standardized
 * joint fraction ± CI`, the arithmetic core of the feasibility workflow
 * (TrialBridge-Workflow-Explained.pdf, steps 3b/4).
 *
 * This is the honest, deterministic counterpart to `modeledPrevalence.ts`.
 * `modeledPrevalence.ts` MULTIPLIES marginal rates (independence assumed — it
 * says so) for the molecular-prevalence funnel. This module does NOT: the joint
 * fraction is a single directly-measured proportion (k patients with ALL depth
 * features present, out of n patients where all features are observed). That is
 * the whole point of the PDF's "measured, not multiplied" line, and it is what
 * lets us put an honest interval on the number that actually drives the estimate.
 *
 * The design answers three specific critiques of the pitch deck's methodology
 * (An Vy Le's "How it works", reviewed for Angelo Orru Neto):
 *
 *   1. THE JOINT FRACTION NEEDS ITS OWN INTERVAL, not the marginal HER2+ one.
 *      The deck shows a 95% CI on the marginal HER2+ rate (n=412) but reports
 *      the joint rate (~0.045) — driven by maybe 15-20 co-positive cases — as a
 *      bare point. `wilsonInterval` puts a proper interval on that small count;
 *      the Wilson score interval (not the normal approximation) is used *because*
 *      the count is small and near the 0 boundary, where the normal approximation
 *      produces limits below zero and understates width.
 *
 *   2. STANDARDIZATION MUST GENERALISE PAST ONE COVARIATE, and sparse cells are
 *      the failure mode. `standardizeRate` does direct standardization over any
 *      number of cross-classified strata, propagates the sampling variance, and
 *      applies an EXPLICIT thin/empty-cell policy (pooled fallback + diagnostics)
 *      instead of silently dropping population weight.
 *
 *   3. TRANSPORTABILITY IS AN ASSUMPTION, SO BOUND IT — don't leave it as prose.
 *      `transportabilityBound` widens the sampling CI by a stated bias factor τ.
 *      It is clearly labelled as an assumption (not derived from data), which is
 *      the honest way to give a reviewer a number instead of a shrug.
 *
 * Everything here is pure, deterministic arithmetic over frozen inputs — no RNG,
 * no model in the loop (ADR: "no model is anywhere near the numbers"). Given the
 * same rate tables it is byte-for-byte reproducible, which is the auditability
 * property the pitch leans on.
 */

/** z-multipliers for common two-sided confidence levels. 95% is the default. */
const Z_BY_CONFIDENCE: Record<number, number> = {
  0.9: 1.6448536269514722,
  0.95: 1.959963984540054,
  0.99: 2.5758293035489004,
};

/** Look up the z-multiplier for a confidence level, defaulting to 95%. */
export function zFor(confidence = 0.95): number {
  const z = Z_BY_CONFIDENCE[confidence];
  if (z == null) {
    throw new Error(
      `Unsupported confidence level ${confidence}; use one of ${Object.keys(Z_BY_CONFIDENCE).join(", ")}`,
    );
  }
  return z;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export interface Interval {
  /** Point estimate the interval is centred on (the proportion or count). */
  point: number;
  lower: number;
  upper: number;
  /** Two-sided confidence level, e.g. 0.95. */
  confidence: number;
}

/**
 * Wilson score interval for a binomial proportion k/n.
 *
 * Chosen over the Wald (normal-approximation) interval on purpose: the joint
 * depth fraction is a small count near zero (critique #1), exactly where Wald
 * misbehaves — it can dip below 0 and is too narrow. Wilson stays inside [0,1]
 * and widens correctly as n shrinks. `point` is the raw observed proportion
 * k/n (what the user reads), while the interval itself is the Wilson score
 * interval centred on the shrunk estimate; we clamp to [0,1] defensively.
 */
export function wilsonInterval(k: number, n: number, confidence = 0.95): Interval {
  if (!Number.isFinite(k) || !Number.isFinite(n)) {
    throw new Error("wilsonInterval: k and n must be finite");
  }
  if (n <= 0) throw new Error("wilsonInterval: n must be > 0");
  if (k < 0 || k > n) throw new Error("wilsonInterval: require 0 <= k <= n");

  const z = zFor(confidence);
  const phat = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (phat + z2 / (2 * n)) / denom;
  const margin =
    (z / denom) * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n));

  return {
    point: phat,
    lower: clamp01(centre - margin),
    upper: clamp01(centre + margin),
    confidence,
  };
}

/**
 * One stratum's contribution to a directly-standardized rate.
 *
 * `weight` is the stratum's share of the BASE (DataSUS) population — the target
 * population we are standardizing onto. `k`/`n` are the observed depth-feature
 * counts in the PROPRIETARY sample for that same stratum. Standardization
 * reweights the proprietary per-stratum rate by the base's weights, so the
 * proprietary population's own composition never leaks into the estimate.
 */
export interface Stratum {
  /** Human-readable stratum key, e.g. "age 60-75 · Sudeste". */
  label: string;
  /** Share of the base population in this stratum. Weights are normalised internally. */
  weight: number;
  /** Successes (depth features all present) observed in the proprietary sample. */
  k: number;
  /** Proprietary sample size in this stratum (patients with the features observed). */
  n: number;
}

export interface StratumDiagnostic {
  label: string;
  /** Normalised base weight actually applied. */
  weight: number;
  /** Own-stratum observed rate, or null when the cell was empty (n=0). */
  ownRate: number | null;
  n: number;
  /** True when n < minStratumN, so the pooled fallback rate was used instead of ownRate. */
  thin: boolean;
  /** True when n === 0 (a strict subset of `thin`). */
  empty: boolean;
  /** The rate actually contributed (ownRate for adequate cells, pooled rate for thin ones). */
  appliedRate: number;
}

export interface StandardizedRate {
  /** Directly-standardized rate as it would apply to the BASE population. */
  rate: Interval;
  /**
   * Fraction of base weight backed by an adequate own-stratum estimate. Weight
   * on thin/empty cells fell back to the pooled rate; this number tells the
   * reviewer how much of the estimate rests on that fallback. 1.0 = none did.
   */
  coveredWeight: number;
  /** Per-stratum audit trail — every input row, what it contributed, and why. */
  strata: StratumDiagnostic[];
  /** Pooled (crude) proprietary rate over adequate cells; the thin-cell fallback value. */
  pooledRate: number;
}

export interface StandardizeOptions {
  confidence?: number;
  /**
   * Cells with fewer than this many observations don't get to speak for their
   * own stratum — their base weight is redirected onto the pooled rate. This is
   * the explicit answer to "what happens as you add covariates and strata get
   * sparse" (critique #2): population weight is never silently dropped, but a
   * 2-patient cell never sets the rate for its slice of the base either.
   */
  minStratumN?: number;
}

const DEFAULT_MIN_STRATUM_N = 30;

/**
 * Direct standardization of a rate onto the base population, over arbitrarily
 * many cross-classified strata, with an explicit sparse-cell policy.
 *
 *   standardized rate = Σ_s ŵ_s · r_s
 *
 * where ŵ_s is the base weight (normalised to sum to 1) and r_s is the rate
 * applied for that stratum: its own observed k_s/n_s when the cell is adequate,
 * otherwise the pooled rate Σk/Σn over the adequate cells. Sampling variance is
 * propagated as Var = Σ_s ŵ_s² · r_s(1−r_s)/m_s, treating strata as independent
 * binomials (m_s is the cell's own n for adequate cells, and the pooled n for
 * thin cells — so leaning on the fallback widens, never narrows, the interval).
 *
 * The single-covariate worked example from the deck (age 50-59 at 0.20 with 60%
 * weight, age 60-75 at 0.15 with 40% weight → 0.18) is just the two-stratum case
 * of this function.
 */
export function standardizeRate(
  strata: Stratum[],
  opts: StandardizeOptions = {},
): StandardizedRate {
  if (strata.length === 0) throw new Error("standardizeRate: need at least one stratum");
  const confidence = opts.confidence ?? 0.95;
  const minN = opts.minStratumN ?? DEFAULT_MIN_STRATUM_N;

  const totalWeight = strata.reduce((s, x) => s + x.weight, 0);
  if (totalWeight <= 0) throw new Error("standardizeRate: total weight must be > 0");
  for (const s of strata) {
    if (s.weight < 0) throw new Error(`standardizeRate: negative weight in "${s.label}"`);
    if (s.n < 0 || s.k < 0 || s.k > s.n) {
      throw new Error(`standardizeRate: require 0 <= k <= n in "${s.label}"`);
    }
  }

  // Pooled (crude) rate over ADEQUATE cells only — the fallback for thin cells.
  // Falls back to all cells if no cell clears the threshold, so it is always defined.
  const adequate = strata.filter((s) => s.n >= minN);
  const pool = adequate.length > 0 ? adequate : strata;
  const pooledK = pool.reduce((s, x) => s + x.k, 0);
  const pooledN = pool.reduce((s, x) => s + x.n, 0);
  const pooledRate = pooledN > 0 ? pooledK / pooledN : 0;

  let rate = 0;
  let variance = 0;
  let coveredWeight = 0;
  const diagnostics: StratumDiagnostic[] = [];

  for (const s of strata) {
    const w = s.weight / totalWeight;
    const empty = s.n === 0;
    const thin = s.n < minN;
    const ownRate = empty ? null : s.k / s.n;
    const appliedRate = thin ? pooledRate : (ownRate as number);
    // Effective sample size behind the applied rate: the cell's own n when we
    // trust it, the pooled n when we fell back. Using pooledN here means the
    // fallback contributes the pooled rate's (smaller) variance per unit weight,
    // so a slice resting on the fallback is not pretended to be more certain
    // than the pool it came from.
    const m = thin ? pooledN : s.n;

    rate += w * appliedRate;
    if (m > 0) variance += w * w * (appliedRate * (1 - appliedRate)) / m;
    if (!thin) coveredWeight += w;

    diagnostics.push({ label: s.label, weight: w, ownRate, n: s.n, thin, empty, appliedRate });
  }

  const se = Math.sqrt(variance);
  const z = zFor(confidence);
  return {
    rate: {
      point: rate,
      lower: clamp01(rate - z * se),
      upper: clamp01(rate + z * se),
      confidence,
    },
    coveredWeight,
    strata: diagnostics,
    pooledRate,
  };
}

export interface TransportabilityBound {
  /** The input sampling interval, unchanged. */
  sampling: Interval;
  /** Sampling interval widened by the τ bias factor. Strictly contains `sampling`. */
  widened: Interval;
  /** The bias factor applied (e.g. 0.25 = "the rate could be ±25% off from residual population differences"). */
  tau: number;
}

/**
 * Widen a sampling interval by a stated transportability bias factor τ.
 *
 * The sampling CI only reflects proprietary-sample size. It does NOT reflect the
 * transportability assumption — that a rate standardized on the covariates we
 * *have* transports to the base population despite the covariates we *don't*
 * (referral patterns, public/private access, urban/rural mix). This turns that
 * caveat into a number: assume residual bias could scale the true rate by up to
 * (1 ± τ) and widen the interval multiplicatively. It is deliberately a stated
 * assumption, not an estimate from data — the honest framing is "sampling CI,
 * widened by a τ=X transportability assumption", which is a bound a reviewer can
 * argue with, instead of prose they can only nod at.
 */
export function transportabilityBound(sampling: Interval, tau: number): TransportabilityBound {
  if (tau < 0) throw new Error("transportabilityBound: tau must be >= 0");
  return {
    sampling,
    widened: {
      point: sampling.point,
      lower: clamp01(sampling.lower * (1 - tau)),
      upper: clamp01(sampling.upper * (1 + tau)),
      confidence: sampling.confidence,
    },
    tau,
  };
}

export interface EligibleEstimateInput {
  /** Exact base-cohort count from DataSUS for this region (the denominator, treated as exact). */
  base: number;
  /**
   * The directly-measured joint depth fraction: k patients with ALL depth
   * features present, out of n patients where all features are observed.
   * Measured, NOT multiplied from marginals.
   */
  jointK: number;
  jointN: number;
  confidence?: number;
  /** Optional τ; when set, the result also carries a transportability-widened count band. */
  tau?: number;
  /**
   * Optional standardization strata for the joint fraction. When supplied, the
   * standardized rate's interval is used for the count band, and the raw Wilson
   * interval on (jointK, jointN) is still reported alongside for comparison.
   */
  strata?: Stratum[];
}

export interface EligibleEstimate {
  region: string | null;
  base: number;
  /** The joint fraction as an interval — the number that actually drives the estimate. */
  jointFraction: Interval;
  /** Standardization detail, present only when `strata` were supplied. */
  standardized: StandardizedRate | null;
  /** estimated eligible = base × fraction, as a count band. `base` is exact, so the band is base × fraction band. */
  estimatedEligible: Interval;
  /** Count band after applying the τ transportability bound, when `tau` was supplied. */
  transportability: TransportabilityBound | null;
}

/** Scale a proportion interval by an exact count, producing a count interval. */
function scaleByBase(fraction: Interval, base: number): Interval {
  return {
    point: base * fraction.point,
    lower: base * fraction.lower,
    upper: base * fraction.upper,
    confidence: fraction.confidence,
  };
}

/**
 * The full step-4 estimator for one region: base × joint fraction ± CI.
 *
 * The base count is treated as exact (it is a real DataSUS count), so all
 * uncertainty in the eligible-count band comes from the joint fraction. When
 * standardization strata are supplied, the fraction interval is the standardized
 * one (covariate-adjusted); otherwise it is the raw Wilson interval on the joint
 * count. Either way the number the reviewer sees carries its interval — never a
 * bare point.
 */
export function estimateEligible(
  input: EligibleEstimateInput,
  region: string | null = null,
): EligibleEstimate {
  if (input.base < 0) throw new Error("estimateEligible: base must be >= 0");
  const confidence = input.confidence ?? 0.95;

  const rawJoint = wilsonInterval(input.jointK, input.jointN, confidence);
  const standardized = input.strata
    ? standardizeRate(input.strata, { confidence })
    : null;
  const jointFraction = standardized ? standardized.rate : rawJoint;

  const estimatedEligible = scaleByBase(jointFraction, input.base);
  const transportability =
    input.tau != null ? transportabilityBound(estimatedEligible, input.tau) : null;

  return {
    region,
    base: input.base,
    jointFraction,
    standardized,
    estimatedEligible,
    transportability,
  };
}
