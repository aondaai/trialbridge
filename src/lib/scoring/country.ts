/**
 * Country scorecard — Brazil (engineering spec §6.3, scorecard §5).
 *
 * Seven dimensions, each normalized to 0..100, weighted, and combined into a
 * composite with a Go / Conditional-Go / No-Go recommendation. Pure: reference
 * signals come in as a typed `CountryInput`; a `CountryScorecard` goes out. The
 * defensible Brazil input is assembled from the cited constants (constants.ts) plus
 * the national eligible pool from the funnel — the Tier-1 path the P0 demo needs.
 */

import { Confidence, Metric, modeled } from "@/lib/metric";
import {
  COST_LATAM_PCT_OF_NA,
  FDA_GCP_OAI_RATE,
  TRIALS_PER_MILLION_BR,
  TRIALS_PER_MILLION_US,
  BR_ANVISA_DAYS,
  BR_CEP_ETHICS_DAYS,
  brazilCostAddsUsd,
} from "@/lib/constants";
import {
  normAbsolute,
  normBenchmarkRelative,
  clampScore,
  Anchor,
} from "@/lib/scoring/normalize";
import {
  CountryWeights,
  CountryDimension,
  resolveCountryWeights,
  TrialProfile,
} from "@/lib/scoring/weights";
import { CountryScorecard, DimensionScore, HardFlag, Recommendation } from "@/lib/scoring/types";

/** Typed, already-resolved reference signals for the 7 dimensions. */
export interface CountryInput {
  asOf?: string | null;
  // D1 regulatory
  statutoryReviewDays: number; // total parallel-review target (business days)
  implementationMaturity: number; // 0..1 penalty on the statutory score (young INAEP, backlog)
  // D2 patient supply
  nationalEligiblePool: number; // from the funnel
  /** Pre-built pool Metric (CI + citation) when the pool comes from a real source
   *  (DataSUS estimator); when absent, a plain modeled Metric is built from the number. */
  nationalPoolMetric?: Metric | null;
  targetSampleSize: number; // sponsor's Brazil sample target
  treatmentNaiveAdvantage: boolean;
  // D3 competition
  trialsPerMillion?: number; // defaults to the cited BR anchor
  benchmarkTrialsPerMillion?: number; // defaults to US anchor
  // D4 cost
  costPctOfBenchmark?: number; // Brazil cost as % of US/EU program benchmark (default Qiao 59%)
  // D5 infrastructure
  researchReadySites: number;
  geoConcentrationPenalty: number; // 0..1 fraction removed (SE/S concentration)
  // D6 data quality
  gcpOaiRate?: number; // default FDA GCP OAI 4.1%
  // D7 logistics
  impLeadTimeWeeks: number;
  regionalInequalityPenalty: number; // 0..1
  // Cross-cutting
  activeHardFlags?: HardFlag[];
}

// ── Documented anchors (cited where a constant backs them) ───────────────────────
const REG_DAYS_ANCHORS: Anchor[] = [
  [60, 100], // parallel-review target
  [120, 70],
  [215, 40], // measured ANVISA mean 2020–22
  [365, 10],
];
const COMPETITION_ANCHORS: Anchor[] = [
  [54, 100], // BR ~54 trials/million = maximally under-penetrated = opportunity
  [200, 70],
  [400, 45],
  [566, 25], // US saturation
];
const OAI_ANCHORS: Anchor[] = [
  [2, 100],
  [4.1, 90], // FDA GCP ex-US OAI rate
  [10, 55],
  [20, 15],
];
const INFRA_SITES_ANCHORS: Anchor[] = [
  [0, 0],
  [20, 45],
  [60, 75],
  [120, 100],
];
const IMP_WEEKS_ANCHORS: Anchor[] = [
  [4, 100],
  [8, 70],
  [12, 45], // recommended ~10–12 week lead time
  [20, 15],
];

const CRITICAL_DIMENSIONS: CountryDimension[] = ["regulatory", "patient_supply", "data_quality"];

function dim(
  key: CountryDimension,
  score: number,
  weight: number,
  contributing: Metric[],
): DimensionScore {
  const score0100 = clampScore(score);
  return {
    key,
    score0100,
    weight,
    scoreMetric: modeled(`country.${key}.score`, Math.round(score0100), Confidence.MEDIUM, {
      unit: "score_0_100",
    }),
    contributingMetrics: contributing,
    narrativeKey: `country.${key}.narrative`,
  };
}

/** Score Brazil across the 7 dimensions. */
export function scoreCountry(input: CountryInput, weights?: CountryWeights): CountryScorecard {
  const w = weights ?? resolveCountryWeights("default");
  const asOf = input.asOf ?? null;

  // D1 regulatory: statutory-day score attenuated by implementation maturity.
  const regBase = normAbsolute(input.statutoryReviewDays, REG_DAYS_ANCHORS);
  const regScore = regBase * clamp01(input.implementationMaturity);
  const d1 = dim("regulatory", regScore, w.regulatory, [BR_ANVISA_DAYS, BR_CEP_ETHICS_DAYS]);

  // D2 patient supply: eligible pool vs. required sample (headroom), plus a naïve-advantage bump.
  const supplyBase = normBenchmarkRelative(
    input.nationalEligiblePool,
    Math.max(1, input.targetSampleSize),
    "higher",
  );
  const supplyScore = clampScore(supplyBase + (input.treatmentNaiveAdvantage ? 8 : 0));
  const poolMetric =
    input.nationalPoolMetric ??
    modeled("country.patient_supply.national_pool", Math.round(input.nationalEligiblePool), Confidence.MEDIUM, {
      unit: "patients",
      note: "National eligible pool from the funnel; SUS-access caveat applies.",
    });
  const d2 = dim("patient_supply", supplyScore, w.patient_supply, [poolMetric]);

  // D3 competition: under-penetration = opportunity (lower trials/million scores higher).
  const tpm = input.trialsPerMillion ?? (TRIALS_PER_MILLION_BR.value as number);
  const compScore = normAbsolute(tpm, COMPETITION_ANCHORS);
  const d3 = dim("competition", compScore, w.competition, [TRIALS_PER_MILLION_BR, TRIALS_PER_MILLION_US]);

  // D4 cost: Brazil as % of benchmark (lower is better), netted against Brazil-specific adds.
  const costPct = input.costPctOfBenchmark ?? (COST_LATAM_PCT_OF_NA.value as number);
  const costBase = normBenchmarkRelative(costPct, 100, "lower");
  // Small penalty for the real Brazil adds (import/insurance/translation), scaled to be modest.
  const costPenalty = Math.min(12, brazilCostAddsUsd() / 3000);
  const costScore = clampScore(costBase - costPenalty);
  const d4 = dim("cost", costScore, w.cost, [COST_LATAM_PCT_OF_NA]);

  // D5 infrastructure: research-ready site depth minus geographic concentration.
  const infraBase = normAbsolute(input.researchReadySites, INFRA_SITES_ANCHORS);
  const infraScore = infraBase * (1 - clamp01(input.geoConcentrationPenalty) * 0.5);
  const sitesMetric = modeled("country.infrastructure.research_ready_sites", input.researchReadySites, Confidence.MEDIUM, {
    unit: "sites",
    note: "CNES + RNPC/EBSERH/CEP-credentialed; SE/S concentration penalised.",
  });
  const d5 = dim("infrastructure", infraScore, w.infrastructure, [sitesMetric]);

  // D6 data quality: low FDA GCP OAI rate = data accepted.
  const oai = input.gcpOaiRate ?? (FDA_GCP_OAI_RATE.value as number);
  const dqScore = normAbsolute(oai, OAI_ANCHORS);
  const d6 = dim("data_quality", dqScore, w.data_quality, [FDA_GCP_OAI_RATE]);

  // D7 logistics: IMP import lead time minus regional inequality.
  const logiBase = normAbsolute(input.impLeadTimeWeeks, IMP_WEEKS_ANCHORS);
  const logiScore = logiBase * (1 - clamp01(input.regionalInequalityPenalty) * 0.5);
  const logiMetric = modeled("country.logistics.imp_lead_time_weeks", input.impLeadTimeWeeks, Confidence.MEDIUM, {
    unit: "weeks",
  });
  const d7 = dim("logistics", logiScore, w.logistics, [logiMetric]);

  const dimensions = [d1, d2, d3, d4, d5, d6, d7];
  const composite = clampScore(dimensions.reduce((s, d) => s + d.score0100 * d.weight, 0));
  const hardFlags = input.activeHardFlags ?? [];
  const recommendation = recommend(composite, dimensions, hardFlags, input);

  return {
    country: "BR",
    dimensions,
    composite: Math.round(composite * 10) / 10,
    compositeMetric: modeled("country.composite", Math.round(composite * 10) / 10, Confidence.MEDIUM, {
      unit: "score_0_100",
    }),
    recommendation,
    hardFlags,
    asOf,
  };
}

/**
 * Recommendation rule (scorecard §5.2): go if composite ≥ 70 AND no critical
 * dimension < 50 AND no active hard flag; conditional_go if 55–70 OR any hard flag
 * (or supply below sample); else no_go.
 */
export function recommend(
  composite: number,
  dimensions: DimensionScore[],
  hardFlags: HardFlag[],
  input: CountryInput,
): Recommendation {
  const hasBlock = hardFlags.some((f) => f.severity === "block");
  const anyFlag = hardFlags.length > 0;
  const criticalBelow50 = dimensions.some(
    (d) => CRITICAL_DIMENSIONS.includes(d.key) && d.score0100 < 50,
  );
  const supplyInsufficient = input.nationalEligiblePool < input.targetSampleSize;

  if (hasBlock) return "no_go";
  if (composite < 55 || supplyInsufficient) return "no_go";
  if (composite >= 70 && !criticalBelow50 && !anyFlag) return "go";
  return "conditional_go";
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/**
 * Assemble the defensible Brazil country input from cited constants + the funnel's
 * national eligible pool. This is the Tier-1 P0 path (real constants, one modeled
 * pool). Callers can override any field.
 */
export function brazilCountryInput(params: {
  nationalEligiblePool: number;
  targetSampleSize: number;
  asOf?: string | null;
  overrides?: Partial<CountryInput>;
}): CountryInput {
  const base: CountryInput = {
    asOf: params.asOf ?? null,
    statutoryReviewDays: 60, // parallel-review design target
    implementationMaturity: 0.75, // young INAEP / ANVISA backlog / ADI 7875 — "improving, not steady-state"
    nationalEligiblePool: params.nationalEligiblePool,
    targetSampleSize: params.targetSampleSize,
    treatmentNaiveAdvantage: true,
    trialsPerMillion: TRIALS_PER_MILLION_BR.value as number,
    benchmarkTrialsPerMillion: TRIALS_PER_MILLION_US.value as number,
    costPctOfBenchmark: COST_LATAM_PCT_OF_NA.value as number,
    researchReadySites: 70, // CNES + RNPC(19) + EBSERH(~40) + CEP-credentialed, demo estimate
    geoConcentrationPenalty: 0.6, // ~77% of centers in SE+S
    gcpOaiRate: FDA_GCP_OAI_RATE.value as number,
    impLeadTimeWeeks: 11,
    regionalInequalityPenalty: 0.5,
    activeHardFlags: [],
  };
  return { ...base, ...(params.overrides ?? {}) };
}
