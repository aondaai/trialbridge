/**
 * The typed 8-section decision report (engineering spec §8, product spec §3).
 *
 * The assembler (assemble.ts) builds this from engine outputs. Every quantitative
 * field lives in a Metric slot (a key ending in `metric`/`Metrics`) so the provenance
 * gate can walk the whole tree and guarantee nothing bare reaches the sponsor.
 *
 * Sections whose upstream engines are not yet built in TS (supply/demand → R7,
 * KOL → R8) are optional; the report is valid without them and gains them later.
 */

import type { Metric, ProvenanceIndex, SourceRef } from "@/lib/metric";
import type { CountryScorecard, SiteScore, HardFlag } from "@/lib/scoring/types";

export interface ReportContext {
  runId: string;
  protocolTitle: string;
  indication: string;
  phase: "II" | "III" | string;
  sponsor: string;
  fxRateBrlUsd: number;
  asOf: string | null;
}

// ── §2 Eligibility funnel (summary the assembler consumes) ───────────────────────
export interface FunnelStageSummary {
  criterionId: string;
  label: string;
  survivalMetric: Metric; // % surviving this stage (marginal)
  remainingPoolMetric: Metric;
  burdenFlag: boolean;
}
export interface FunnelSummary {
  scope: "national" | "region" | "site";
  scopeRef: string | null;
  basePopulationMetric: Metric;
  stages: FunnelStageSummary[];
  eligiblePoolMetric: Metric;
  projectedPatientsPerMonthMetric: Metric;
}

// ── §2 Protocol softening ────────────────────────────────────────────────────────
export interface SofteningScenarioSummary {
  label: string;
  criteriaRelaxed: string[];
  deltaEligiblePoolMetric: Metric;
  deltaPatientsPerMonthMetric: Metric;
  amendmentCostAvoidedMetric: Metric;
  scientificRiskNote: string | null;
}
export interface SofteningSummary {
  scenarios: SofteningScenarioSummary[];
}

// ── §1 Decision snapshot ─────────────────────────────────────────────────────────
export interface TopSiteRef {
  cnes: string;
  name: string;
  city: string;
  uf: string;
  compositeMetric: Metric;
}
export interface DecisionSnapshot {
  recommendation: CountryScorecard["recommendation"];
  countryScoreMetric: Metric;
  topSites: TopSiteRef[];
  headlineMetrics: {
    projectedPatientsPerMonthMetric: Metric;
    timeToFpiMetric: Metric;
    costPerPatientMetric: Metric;
    riskIndexMetric: Metric;
  };
}

// ── §8 Risk register ─────────────────────────────────────────────────────────────
export interface RiskRegister {
  hardFlags: HardFlag[];
  assumptions: string[];
  provenanceIndex: ProvenanceIndex;
  liveRisksToRecheck: string[];
}

// ── §4 Supply/demand (optional — R7) ─────────────────────────────────────────────
export interface RegionSupplyDemandSummary {
  regionCode: string;
  eligiblePoolMetric: Metric;
  competingTrialsMetric: Metric;
  ratioMetric: Metric;
}
/** Real per-UF eligible pool (DataSUS estimate), for the §4 Brazil tile-map. */
export interface UfPool {
  uf: string;
  eligible: number;
}
export interface SupplyDemandSummary {
  regions: RegionSupplyDemandSummary[];
  /** Present when the real DataSUS estimate is wired: per-state eligible pools. */
  ufPools?: UfPool[];
}

// ── §7 KOL map (optional — R8) ───────────────────────────────────────────────────
export interface KolRefSummary {
  name: string;
  regionCode: string;
  /** Real institutional affiliation (CT.gov) — the precise fact; region is best-effort. */
  affiliation?: string | null;
  /** CNES code, when the affiliation matched a directory site (cross-reference). */
  cnes?: string | null;
  /** Deep-web-researched signals (Parallel), when enrichment ran. */
  pubsCountTa?: number;
  societyRoles?: string[];
  citations?: SourceRef[];
  scoreMetric: Metric;
}
/** KOL count per UF (investigators matched to a directory site), for the §7 tile-map. */
export interface UfKolCount {
  uf: string;
  count: number;
}
export interface KolMapSummary {
  physicians: KolRefSummary[];
  /** Per-state active-investigator counts, when affiliations resolved to a UF. */
  ufCounts?: UfKolCount[];
}

/** The whole report. */
export interface Report {
  context: ReportContext;
  decisionSnapshot: DecisionSnapshot; // §1
  funnel: FunnelSummary; // §2
  softening: SofteningSummary; // §2
  country: CountryScorecard; // §3
  supplyDemand?: SupplyDemandSummary; // §4 (optional)
  siteRankings: SiteScore[]; // §5
  siteDeepDives: SiteScore[]; // §6 (top-N subset)
  kolMap?: KolMapSummary; // §7 (optional)
  riskRegister: RiskRegister; // §8
}
