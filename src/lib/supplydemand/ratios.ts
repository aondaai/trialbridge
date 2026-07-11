/**
 * Supply vs. Demand — the "trials vs. patients" analysis (engineering spec §11,
 * product spec §9). For each region: eligible patients ÷ competing trials = a ratio
 * where HIGH means idle patients + low cannibalization = opportunity. Adds the
 * under-penetration gap (how far below US/EU saturation the region sits) so the
 * report can surface "many patients, few trials" sweet spots. Pure.
 */

import { Confidence, Metric, modeled, registry } from "@/lib/metric";
import { TRIALS_PER_MILLION_BR, TRIALS_PER_MILLION_US } from "@/lib/constants";
import type { SupplyDemandSummary } from "@/lib/report/types";

/**
 * Brazilian macro-region populations (IBGE 2022 Census, rounded). Registry/gov data,
 * used as the trials-per-million denominator when only macro-region granularity exists.
 */
export const BR_MACROREGION_POPULATION: Record<string, number> = {
  Norte: 17_349_000,
  Nordeste: 54_644_000,
  "Centro-Oeste": 16_288_000,
  Sudeste: 84_847_000,
  Sul: 29_934_000,
};

export interface RegionSDInput {
  regionCode: string;
  regionName?: string;
  /** Modeled eligible pool for the indication in this region (from the funnel). */
  eligiblePool: number;
  /** Competing active trials in the same condition (CT.gov + ReBEC). */
  competingTrials: number;
  /** Region population (IBGE), for trials-per-million. */
  population: number;
  /** Provenance of the competing-trials count — registry once CT.gov is wired, else modeled placeholder. */
  competingTrialsProvenance?: "registry" | "modeled";
}

export interface RegionSupplyDemand {
  regionCode: string;
  regionName: string;
  eligiblePoolMetric: Metric;
  competingTrialsMetric: Metric;
  /** eligiblePool ÷ competingTrials — higher = more opportunity. */
  ratioMetric: Metric;
  /** How far below the US/EU trials-per-million benchmark this region sits (higher = more under-penetrated). */
  underPenetrationMetric: Metric;
  trialsPerMillionMetric: Metric;
  /** High ratio AND low local saturation → flagged opportunity. */
  isOpportunity: boolean;
}

export interface SupplyDemandResult {
  regions: RegionSupplyDemand[];
  nationalTrialsPerMillionMetric: Metric;
  opportunities: RegionSupplyDemand[]; // subset, ratio-sorted
}

export interface SupplyDemandOptions {
  /** US/EU trials-per-million benchmark (defaults to the cited US anchor). */
  benchmarkTrialsPerMillion?: number;
  /** Ratio at/above which a region counts as "patient-rich" (default 50 eligible per competing trial). */
  opportunityRatioThreshold?: number;
  asOf?: string | null;
}

/** Compute per-region supply/demand ratios + the national trials-per-million. */
export function computeSupplyDemand(
  inputs: RegionSDInput[],
  opts: SupplyDemandOptions = {},
): SupplyDemandResult {
  const benchmark = opts.benchmarkTrialsPerMillion ?? (TRIALS_PER_MILLION_US.value as number);
  const threshold = opts.opportunityRatioThreshold ?? 50;

  const regions = inputs.map((r) => oneRegion(r, benchmark, threshold, opts.asOf ?? null));

  const totalTrials = inputs.reduce((s, r) => s + r.competingTrials, 0);
  const totalPop = inputs.reduce((s, r) => s + r.population, 0);
  const nationalTpm = totalPop > 0 ? (totalTrials / totalPop) * 1_000_000 : 0;

  const opportunities = regions
    .filter((r) => r.isOpportunity)
    .sort((a, b) => (b.ratioMetric.value as number) - (a.ratioMetric.value as number));

  return {
    regions,
    nationalTrialsPerMillionMetric: modeled(
      "supplydemand.national_trials_per_million",
      round1(nationalTpm),
      Confidence.MEDIUM,
      {
        unit: "trials/million",
        asOf: opts.asOf ?? null,
        note: `Cited national anchor ≈ ${TRIALS_PER_MILLION_BR.value} trials/million.`,
      },
    ),
    opportunities,
  };
}

function oneRegion(
  r: RegionSDInput,
  benchmark: number,
  threshold: number,
  asOf: string | null,
): RegionSupplyDemand {
  // Ratio: eligible patients per competing trial. No competing trials → the whole
  // pool is uncontested; we floor the denominator at 1 so the ratio is finite and
  // still monotonic (more pool = higher).
  const denom = Math.max(1, r.competingTrials);
  const ratio = r.eligiblePool / denom;
  const trialsPerMillion = r.population > 0 ? (r.competingTrials / r.population) * 1_000_000 : 0;
  const underPenetration = Math.max(0, benchmark - trialsPerMillion);
  const isOpportunity = ratio >= threshold && trialsPerMillion < benchmark;

  const trialsProv = r.competingTrialsProvenance ?? "modeled";
  const competingTrialsMetric =
    trialsProv === "registry"
      ? registry("supplydemand.competing_trials", r.competingTrials, Confidence.MEDIUM, {
          unit: "trials",
          asOf,
          sourceRefs: [{ label: "ClinicalTrials.gov + ReBEC" }],
        })
      : modeled("supplydemand.competing_trials", r.competingTrials, Confidence.LOW, {
          unit: "trials",
          note: "Modeled placeholder until the CT.gov/ReBEC connector is wired (R9).",
        });

  return {
    regionCode: r.regionCode,
    regionName: r.regionName ?? r.regionCode,
    eligiblePoolMetric: modeled("supplydemand.eligible_pool", Math.round(r.eligiblePool), Confidence.MEDIUM, {
      unit: "patients",
    }),
    competingTrialsMetric,
    ratioMetric: modeled("supplydemand.ratio", round1(ratio), Confidence.MEDIUM, {
      unit: "ratio",
      note: "Eligible patients per competing trial; higher = more opportunity.",
    }),
    underPenetrationMetric: modeled("supplydemand.under_penetration", round1(underPenetration), Confidence.MEDIUM, {
      unit: "trials/million",
      note: "Gap below the US/EU saturation benchmark.",
    }),
    trialsPerMillionMetric: modeled("supplydemand.trials_per_million", round1(trialsPerMillion), Confidence.MEDIUM, {
      unit: "trials/million",
    }),
    isOpportunity,
  };
}

/** Project the result down to the report's §4 summary shape. */
export function toSupplyDemandSummary(result: SupplyDemandResult): SupplyDemandSummary {
  return {
    regions: result.regions.map((r) => ({
      regionCode: r.regionCode,
      eligiblePoolMetric: r.eligiblePoolMetric,
      competingTrialsMetric: r.competingTrialsMetric,
      ratioMetric: r.ratioMetric,
    })),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
