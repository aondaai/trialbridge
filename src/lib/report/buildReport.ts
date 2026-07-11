/**
 * Resolver: existing app data → engine inputs → assembled Report.
 *
 * This is the bridge the eng spec calls `run_service` (§2.3): it adapts what the
 * current TypeScript app already computes (per-site cohort counts, feasibility,
 * softening bottlenecks) into the engine's typed inputs, runs scoreCountry /
 * scoreSite / assemble, and hands back a Report the UI renders through MetricChip.
 *
 * It is I/O-free — the page loads consultation + sites and passes them in — so it
 * stays testable. Signals the app does not yet wire (CNES infra, CT.gov competition,
 * KOL, site declaration) are filled with clearly-noted MODELED assumptions, and the
 * per-site confidence roll-up honestly lands on LOW for public-data-only sites.
 */

import { Confidence, modeled } from "@/lib/metric";
import { amendmentCost } from "@/lib/constants";
import { scoreCountry, brazilCountryInput } from "@/lib/scoring/country";
import { scoreSite, SiteInput } from "@/lib/scoring/site";
import { TrialProfile } from "@/lib/scoring/weights";
import { assemble } from "@/lib/report/assemble";
import type { Report, FunnelSummary, SofteningSummary } from "@/lib/report/types";
import type { EvaluatedSite } from "@/lib/service";
import { estimateFeasibility } from "@/lib/feasibility";
import { rankBottlenecks } from "@/lib/matcher/soften";
import type { Criterion } from "@/lib/matcher/types";

export interface BuildReportOptions {
  runId?: string;
  profile?: TrialProfile;
  phase?: "II" | "III";
  targetSampleSize?: number;
  months?: number;
  asOf?: string | null;
  fxRateBrlUsd?: number;
}

export interface ConsultationLike {
  id: string;
  title: string;
  sponsorName: string;
  nct?: string;
  criteria: Criterion[];
}

/** Build the full engine Report from a consultation + its evaluated sites. */
export function buildReport(
  consultation: ConsultationLike,
  sites: EvaluatedSite[],
  opts: BuildReportOptions = {},
): Report {
  const months = opts.months ?? 6;
  const profile = opts.profile ?? "onc_ph3";
  const phase = opts.phase ?? "III";
  const targetSampleSize = opts.targetSampleSize ?? 200;
  const asOf = opts.asOf ?? null;

  // Per-site feasibility (existing R1/R2 model).
  const perSite = sites.map((s) => ({
    site: s,
    feas: estimateFeasibility({
      definite: s.counts.definite,
      possible: s.counts.possible,
      monthlyIncidence: s.meta.monthlyIncidence,
      months,
    }),
  }));

  const nationalPool = sites.reduce((n, s) => n + s.counts.definite + s.counts.possible, 0);
  const nationalPpm = perSite.reduce((n, p) => n + p.feas.enrollableEstimate, 0) / months;
  const recordsReviewed = sites.reduce((n, s) => n + s.counts.total, 0);

  const funnel = buildFunnel(nationalPool, nationalPpm, recordsReviewed, consultation.criteria);
  const softening = buildSoftening(sites, consultation.criteria, phase);

  const country = scoreCountry(
    brazilCountryInput({
      nationalEligiblePool: nationalPool,
      targetSampleSize,
      asOf,
      // With no site online, keep the country card renderable from constants; the
      // supply dimension will simply reflect the (small/zero) pool honestly.
    }),
  );

  const siteScores = perSite.map(({ site, feas }) =>
    scoreSite(toSiteInput(site, feas.enrollableEstimate / months, profile)),
  );

  return assemble({
    context: {
      runId: opts.runId ?? "run_preview",
      protocolTitle: consultation.title,
      indication: consultation.nct ?? consultation.id,
      phase,
      sponsor: consultation.sponsorName,
      fxRateBrlUsd: opts.fxRateBrlUsd ?? 5.4,
      asOf,
    },
    funnel,
    softening,
    country,
    sites: siteScores,
    assumptions: [
      "Site capture rate over the eligible pool (conservative screen-to-enrol default).",
      "Competition, CNES infrastructure, KOL and startup signals are MODELED placeholders until the CT.gov / CNES / PubMed connectors are wired (R7–R9) — sites carry LOW confidence accordingly.",
      "SUS→total correction not yet applied (ANS connector = R9).",
    ],
  });
}

function buildFunnel(
  pool: number,
  ppm: number,
  base: number,
  criteria: Criterion[],
): FunnelSummary {
  const inclusion = criteria.filter((c) => c.kind === "inclusion").length;
  return {
    scope: "national",
    scopeRef: null,
    basePopulationMetric: modeled("funnel.base", base, Confidence.MEDIUM, {
      unit: "patients",
      note: "Records reviewed across responding sites.",
    }),
    stages: [
      {
        criterionId: "all_ie",
        label: `Full I/E funnel (${inclusion} inclusion + ${criteria.length - inclusion} exclusion)`,
        survivalMetric: modeled("funnel.survival", base > 0 ? Math.round((100 * pool) / base) : 0, Confidence.MEDIUM, {
          unit: "%",
        }),
        remainingPoolMetric: modeled("funnel.remaining", pool, Confidence.MEDIUM, { unit: "patients" }),
        burdenFlag: base > 0 && pool / base < 0.2,
      },
    ],
    eligiblePoolMetric: modeled("funnel.eligible", pool, Confidence.MEDIUM, { unit: "patients" }),
    projectedPatientsPerMonthMetric: modeled("funnel.ppm", round1(ppm), Confidence.MEDIUM, {
      unit: "patients/month",
      note: "Funnel-discounted, rate-aware (R1/R2).",
    }),
  };
}

function buildSoftening(
  sites: EvaluatedSite[],
  criteria: Criterion[],
  phase: "II" | "III",
): SofteningSummary {
  const pooled = sites.flatMap((s) => s.patients);
  if (pooled.length === 0 || criteria.length === 0) return { scenarios: [] };
  const top = rankBottlenecks(pooled, criteria)[0];
  if (!top) return { scenarios: [] };
  return {
    scenarios: [
      {
        label: `Relax ${top.label}`,
        criteriaRelaxed: [top.handle],
        deltaEligiblePoolMetric: modeled(
          "soften.delta_pool",
          top.newlyDefinite + top.newlyPossible,
          Confidence.MEDIUM,
          {
            unit: "patients",
            note: `${top.newlyDefiniteFromUnknown} of the gain is only because the field is currently unknown.`,
          },
        ),
        deltaPatientsPerMonthMetric: modeled("soften.delta_ppm", null, Confidence.LOW, {
          unit: "patients/month",
          note: "Per-month delta requires the rate model per scenario (R-followup).",
        }),
        amendmentCostAvoidedMetric: amendmentCost(phase),
        scientificRiskNote:
          "Loosening pre-startup avoids a substantial amendment; review the clinical rationale for the relaxed criterion.",
      },
    ],
  };
}

/** Map an existing EvaluatedSite → the engine's SiteInput (honest modeled placeholders). */
function toSiteInput(site: EvaluatedSite, ppm: number, profile: TrialProfile): SiteInput {
  const pool = site.counts.definite + site.counts.possible;
  return {
    cnes: site.meta.id,
    name: site.meta.name,
    city: site.meta.city,
    uf: site.meta.region,
    profile,

    eligiblePool: pool,
    declaredPool: null,
    poolVerifiablePublicly: true, // computed from the site's own records

    projectedPatientsPerMonth: ppm,
    declaredCommitmentPerMonth: null,

    priorTrials: 0,
    historicalEnrollmentRate: null,
    zeroEnroller: false,
    hasPIHistory: false, // CT.gov history not wired (R9)

    competingTrialsInCatchment: 3, // MODELED neutral placeholder (CT.gov = R7/R9)

    requiredEquipment: 4,
    presentEquipment: 4, // CNES infra not wired (R9) → assume met; minInfraFit low so no false flag

    kolScore0100: null, // KOL service = R8

    projectedFpiDays: 90, // Lei 14.874 parallel-review target

    inspectionOk: true, // national FDA GCP acceptance
    declaredQueryRate: null,

    crcCount: null,
    crcExperienceYears: null,
    emrEsource: false,

    hasDeclaration: false, // marketplace declaration not present for public-data sites
    hasDigitalSfq: false,

    minInfraFit: 40, // low bar until CNES infra is wired (avoids false hard-flags)
    cepAccreditedForRisk: true,
    impLeadTimeDays: 77,
    daysToFpiBudget: 180,

    screenFailRate: null,
    retentionRate: null,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
