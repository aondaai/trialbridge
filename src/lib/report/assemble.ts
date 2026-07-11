/**
 * Report assembler (engineering spec §8). Pure function: engine outputs in, a typed
 * 8-section Report out. It builds the decision snapshot (recommendation + top-3 +
 * four headline numbers), the risk register (all hard flags + a provenance index +
 * assumptions), and — critically — runs the PROVENANCE GATE over the finished report,
 * throwing if any surfaced value is not a Metric. That gate is the type-level
 * enforcement of the product's credibility discipline.
 */

import { Confidence, modeled, buildProvenanceIndex, assertProvenanced, Metric } from "@/lib/metric";
import { CountryScorecard, SiteScore, HardFlag } from "@/lib/scoring/types";
import { rankSites } from "@/lib/scoring/site";
import {
  Report,
  ReportContext,
  FunnelSummary,
  SofteningSummary,
  SupplyDemandSummary,
  KolMapSummary,
  DecisionSnapshot,
  RiskRegister,
  TopSiteRef,
} from "@/lib/report/types";

export interface AssembleInput {
  context: ReportContext;
  funnel: FunnelSummary;
  softening: SofteningSummary;
  country: CountryScorecard;
  sites: SiteScore[];
  supplyDemand?: SupplyDemandSummary;
  kolMap?: KolMapSummary;
  /** How many sites get a full deep-dive card. */
  deepDiveN?: number;
  /** Extra model assumptions to record in the risk register. */
  assumptions?: string[];
  /** Country-level live risks to re-check (ADI 7875, ANVISA steady-state, etc.). */
  liveRisksToRecheck?: string[];
}

const DEFAULT_LIVE_RISKS = [
  "INAEP decentralisation of CEP accreditation beyond SP",
  "ANVISA timeline steady-state vs. the emergency backlog package",
  "ADI 7875 outcome at the STF",
  "IMP import windows vs. the program timeline",
];

const DEFAULT_ASSUMPTIONS = [
  "Site capture rate over the eligible pool (conservative default).",
  "Molecular prevalence fractions from the cited library.",
  "SUS→total correction factor (ANS share; 1.0 when ANS data absent).",
  "US/EU cost-per-patient benchmark supplied by the sponsor.",
];

/** Build the report, then enforce the provenance gate over the whole tree. */
export function assemble(input: AssembleInput): Report {
  const ranked = rankSites(input.sites);
  const deepDiveN = input.deepDiveN ?? 3;

  const decisionSnapshot = buildDecisionSnapshot(input.country, ranked, input.funnel);
  const riskRegister = buildRiskRegister(input, ranked, decisionSnapshot);

  const report: Report = {
    context: input.context,
    decisionSnapshot,
    funnel: input.funnel,
    softening: input.softening,
    country: input.country,
    supplyDemand: input.supplyDemand,
    siteRankings: ranked,
    siteDeepDives: ranked.slice(0, deepDiveN),
    kolMap: input.kolMap,
    riskRegister,
  };

  // The gate: any bare number in a metric slot throws here (spec §8 validation gate).
  assertProvenanced(report);
  return report;
}

function buildDecisionSnapshot(
  country: CountryScorecard,
  ranked: SiteScore[],
  funnel: FunnelSummary,
): DecisionSnapshot {
  const topSites: TopSiteRef[] = ranked.slice(0, 3).map((s) => ({
    cnes: s.cnes,
    name: s.name,
    city: s.city,
    uf: s.uf,
    compositeMetric: s.compositeMetric,
  }));

  const top = ranked[0];
  // Four headline numbers (product spec §3.1). Fall back to national funnel where no site.
  const projectedPpm =
    top?.headlineMetrics.enrollmentRateMetric ?? funnel.projectedPatientsPerMonthMetric;
  const timeToFpi =
    firstMetric(top, "startup_fpi") ??
    modeled("report.time_to_fpi", null, Confidence.LOW, { unit: "days", note: "No site scored." });
  const costPerPatient = modeled("report.cost_per_patient", null, Confidence.LOW, {
    unit: "usd",
    note: "Cost model applied at report time; benchmark-relative to the program.",
  });
  const riskIndex = modeled("report.risk_index", computeRiskIndex(country, ranked), Confidence.MEDIUM, {
    unit: "index_0_100",
    note: "Higher = more execution risk; derived from hard flags + confidence mix.",
  });

  return {
    recommendation: country.recommendation,
    countryScoreMetric: country.compositeMetric,
    topSites,
    headlineMetrics: {
      projectedPatientsPerMonthMetric: projectedPpm,
      timeToFpiMetric: timeToFpi,
      costPerPatientMetric: costPerPatient,
      riskIndexMetric: riskIndex,
    },
  };
}

function buildRiskRegister(
  input: AssembleInput,
  ranked: SiteScore[],
  snapshot: DecisionSnapshot,
): RiskRegister {
  const hardFlags: HardFlag[] = [
    ...input.country.hardFlags,
    ...ranked.flatMap((s) => s.hardFlags),
  ];

  // Provenance index over everything the report will surface EXCEPT the register
  // itself (avoids self-reference; the index counts the substantive metrics).
  const indexTarget = {
    decisionSnapshot: snapshot,
    funnel: input.funnel,
    softening: input.softening,
    country: input.country,
    supplyDemand: input.supplyDemand,
    siteRankings: ranked,
  };
  const provenanceIndex = buildProvenanceIndex(indexTarget);

  return {
    hardFlags,
    assumptions: input.assumptions ?? DEFAULT_ASSUMPTIONS,
    provenanceIndex,
    liveRisksToRecheck: input.liveRisksToRecheck ?? DEFAULT_LIVE_RISKS,
  };
}

/** A 0..100 execution-risk index: hard flags and low-confidence sites push it up. */
function computeRiskIndex(country: CountryScorecard, ranked: SiteScore[]): number {
  let risk = Math.max(0, 100 - country.composite) * 0.4;
  const flagCount = country.hardFlags.length + ranked.reduce((n, s) => n + s.hardFlags.length, 0);
  risk += Math.min(40, flagCount * 12);
  const lowConf = ranked.filter((s) => s.confidence === Confidence.LOW).length;
  risk += Math.min(20, lowConf * 6);
  return Math.round(Math.max(0, Math.min(100, risk)));
}

function firstMetric(site: SiteScore | undefined, componentKey: string): Metric | null {
  if (!site) return null;
  const c = site.components.find((x) => x.key === componentKey);
  return c?.scoreMetric ?? null;
}
