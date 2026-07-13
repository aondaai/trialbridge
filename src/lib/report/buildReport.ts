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

import { Confidence, modeled, registry } from "@/lib/metric";
import { amendmentCost } from "@/lib/constants";
import { DEFAULT_SCREEN_TO_ENROLL } from "@/lib/feasibility";
import type { NationalEstimate } from "@/lib/estimator/client";
import {
  allocateSitePools,
  datasusSourceRef,
  macroRegionPools,
  nationalPoolMetric,
} from "@/lib/estimator/pools";
import { scoreCountry, brazilCountryInput } from "@/lib/scoring/country";
import { scoreSite, SiteInput } from "@/lib/scoring/site";
import { TrialProfile } from "@/lib/scoring/weights";
import { assemble } from "@/lib/report/assemble";
import type { Report, FunnelSummary, SofteningSummary } from "@/lib/report/types";
import type { EvaluatedSite } from "@/lib/service";
import { estimateFeasibility } from "@/lib/feasibility";
import { rankBottlenecks } from "@/lib/matcher/soften";
import type { Criterion } from "@/lib/matcher/types";
import {
  computeSupplyDemand,
  toSupplyDemandSummary,
  BR_MACROREGION_POPULATION,
  RegionSDInput,
} from "@/lib/supplydemand/ratios";
import { buildKolMap, KolInvestigatorInput } from "@/lib/kol/score";
import { rankSites } from "@/lib/scoring/site";
import type { CompetitionData } from "@/lib/ctgov/competition";
import type { DirectorySite } from "@/lib/sites/directory";
import { directorySiteToSiteInput, kolScoreByCnes } from "@/lib/sites/toSiteInput";
import type { SiteRegistryLandscape } from "@/lib/site-feasibility/types";
import { buildSitePrequalificationShortlist } from "@/lib/site-feasibility/shortlist";

export interface BuildReportOptions {
  runId?: string;
  profile?: TrialProfile;
  phase?: "II" | "III";
  /** Protocol phase shown in the report; scoring still uses the II/III cost profile. */
  displayPhase?: string;
  targetSampleSize?: number;
  months?: number;
  asOf?: string | null;
  fxRateBrlUsd?: number;
  /** Real CT.gov competition data (R9). When source==="live", replaces the modeled
   *  competing-trials placeholders and populates the KOL map from real investigators. */
  competition?: CompetitionData;
  /** Deep-web-enriched KOL investigators (Parallel pipe). When provided, drives the
   *  §7 KOL map instead of the CT.gov trial-experience-only derivation. */
  kolInvestigators?: KolInvestigatorInput[];
  /** Real site directory (ABRACRO/ACESSE). When provided, the §5/§6 rankings score
   *  these real sites instead of the synthetic evaluated ones. */
  directorySites?: DirectorySite[];
  /** How many ranked sites to keep in §5 (default 20). */
  maxRankedSites?: number;
  /** Real deep-web-researched infrastructure per CNES (Part B). */
  siteInfraByCnes?: Map<string, import("@/lib/sites/infraEnrich").SiteInfra>;
  /** Real national estimate from the Python estimator (DataSUS/OMOP over the real
   *  base). When present it replaces the synthetic-cohort pools everywhere: funnel,
   *  country supply, §4 regional pools, softening levers, and per-site allocations. */
  nationalEstimate?: NationalEstimate | null;
  /** Protocol-specific CT.gov → facility-master longlist. Kept separate from the
   * operational score until patient and capacity evidence are available. */
  siteRegistryLandscape?: SiteRegistryLandscape;
}

/** Map CT.gov investigators → trial-experience-only KOL inputs (pre-enrichment). */
export function ctgovToKolInputs(competition: CompetitionData): KolInvestigatorInput[] {
  return competition.investigators.slice(0, 25).map((inv) => ({
    name: inv.name,
    regionCode: inv.regionCode,
    affiliation: inv.affiliation,
    signals: {
      trialsCount: inv.trialsCount,
      pubsCountTa: 0,
      societyRoles: [],
      guidelineAuthor: false,
      hasCnesLink: false,
    },
  }));
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
  const months = Math.max(1, Math.floor(opts.months ?? 6)); // guard: never divide ppm by 0
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

  // Real national estimate (DataSUS) replaces the synthetic-cohort pool chain end-to-end.
  const est = opts.nationalEstimate ?? undefined;

  const syntheticPool = sites.reduce((n, s) => n + s.counts.definite + s.counts.possible, 0);
  const nationalPool = est ? est.estimatedN : syntheticPool;
  const nationalPpm = perSite.reduce((n, p) => n + p.feas.enrollableEstimate, 0) / months;
  const recordsReviewed = sites.reduce((n, s) => n + s.counts.total, 0);

  const funnel = est
    ? buildRealFunnel(est, consultation.criteria)
    : buildFunnel(syntheticPool, nationalPpm, recordsReviewed, consultation.criteria);
  // Once a real estimator result exists, never fall back to synthetic-patient
  // softening. An empty real bottleneck list is an honest empty state.
  const softening = est ? buildRealSoftening(est, phase) : buildSoftening(sites, consultation.criteria, phase);

  const country = scoreCountry(
    brazilCountryInput({
      nationalEligiblePool: nationalPool,
      targetSampleSize,
      asOf,
      // Real pool → carry the estimator's CI + DataSUS citation on the supply metric.
      overrides: est ? { nationalPoolMetric: nationalPoolMetric(est) } : undefined,
    }),
  );

  // §4 Supply vs. demand, by macro-region. Pools come from the real DataSUS estimate
  // when available (UF estimates rolled up), else from the synthetic site cohorts.
  // Competing trials come from CT.gov when live (registry), else a MODELED placeholder.
  const competitionLive = opts.competition?.source === "live" ? opts.competition : undefined;
  const sdInputs = est
    ? buildRealRegionSDInputs(est, competitionLive)
    : buildRegionSDInputs(sites, competitionLive);
  const supplyDemand = sdInputs.length > 0
    ? {
        ...toSupplyDemandSummary(computeSupplyDemand(sdInputs, { asOf })),
        // Real per-state eligible pools (DataSUS) drive the §4 Brazil tile-map.
        ufPools: est
          ? est.byRegion.map((r) => ({ uf: r.region, eligible: Math.round(r.estimatedN) }))
          : undefined,
      }
    : undefined;

  // §7 KOL map. Prefer deep-web-enriched investigators (Parallel pipe) when supplied;
  // otherwise derive from CT.gov with trial experience only (pubs/society need the
  // enrichment). Empty until competition is live.
  const kolInputs =
    opts.kolInvestigators && opts.kolInvestigators.length > 0
      ? opts.kolInvestigators
      : competitionLive
        ? ctgovToKolInputs(competitionLive)
        : [];
  const kolMap = kolInputs.length > 0 ? buildKolMap(kolInputs) : undefined;
  // Per-state KOL counts for the §7 Brazil tile-map: match each investigator's CNES to
  // its directory UF and tally. Only investigators with a resolved UF are counted
  // (honest — an unmatched affiliation isn't placed on the map).
  if (kolMap && opts.directorySites) {
    const cnesToUf = new Map(
      opts.directorySites.filter((s) => s.cnes && s.uf).map((s) => [s.cnes as string, s.uf as string]),
    );
    const byUf = new Map<string, number>();
    for (const inv of kolInputs) {
      // Prefer the UF the cross-reference resolved from the matched site (covers CNES-less
      // ACESSE matches); fall back to the CNES→UF directory lookup.
      const uf = inv.uf ?? (inv.cnes ? cnesToUf.get(inv.cnes) : undefined);
      if (!uf) continue;
      byUf.set(uf, (byUf.get(uf) ?? 0) + 1);
    }
    if (byUf.size > 0) {
      kolMap.ufCounts = Array.from(byUf.entries())
        .map(([uf, count]) => ({ uf, count }))
        .sort((a, b) => b.count - a.count);
    }
  }

  // §5/§6 site rankings. Prefer the REAL directory (oncology sites, scored from directory
  // signals + CT.gov competition per region + KOL links); fall back to the synthetic sites.
  let siteScores;
  if (opts.directorySites && opts.directorySites.length > 0) {
    const kolByCnes = kolScoreByCnes(kolInputs);
    const competingByRegion = competitionLive?.byRegion ?? {};
    const oncologySites = opts.directorySites.filter((s) => s.oncology);
    // Real DataSUS pools: each UF's real eligible total, split across that UF's
    // ranked oncology sites by PI share (replaces the PI-count pool proxy).
    const poolByCnes = est ? allocateSitePools(oncologySites, est) : undefined;
    const ranked = rankSites(
      oncologySites.map((s) =>
        scoreSite(directorySiteToSiteInput(s, { profile, competingByRegion, kolByCnes, infraByCnes: opts.siteInfraByCnes, poolByCnes })),
      ),
    );
    siteScores = ranked.slice(0, opts.maxRankedSites ?? 20);
  } else {
    siteScores = perSite.map(({ site, feas }) =>
      scoreSite(toSiteInput(site, feas.enrollableEstimate / months, profile)),
    );
  }

  const sitePrequalification = opts.siteRegistryLandscape
    ? buildSitePrequalificationShortlist(
        opts.siteRegistryLandscape,
        (est?.byRegion ?? []).map((region) => ({
          uf: region.region,
          eligible: region.estimatedN,
          asOf: est?.asOf ?? asOf,
          sourceLabel: est ? `${est.dataSource} — TrialBridge estimator (${est.protocolId})` : "Regional estimator",
          sourceVersion: est?.asOf ?? null,
        })),
        { limit: opts.maxRankedSites ?? 20, asOf: est?.asOf ?? asOf },
      )
    : undefined;

  return assemble({
    context: {
      runId: opts.runId ?? "run_preview",
      protocolTitle: consultation.title,
      indication: consultation.nct ?? consultation.id,
      phase: opts.displayPhase ?? phase,
      sponsor: consultation.sponsorName,
      fxRateBrlUsd: opts.fxRateBrlUsd ?? 5.4,
      asOf,
    },
    funnel,
    softening,
    country,
    sites: siteScores,
    supplyDemand,
    siteRegistryLandscape: opts.siteRegistryLandscape,
    sitePrequalification,
    kolMap,
    assumptions: [
      est
        ? `Patient pools are REAL: ${est.dataSource} — ${est.baseCohort.toLocaleString("en-US")} row-level base-cohort patients, ${Math.round(est.estimatedN).toLocaleString("en-US")} estimated eligible (95% CI ${Math.round(est.ciLo).toLocaleString("en-US")}–${Math.round(est.ciHi).toLocaleString("en-US")}). Per-site pools split each UF's real total by PI share (the share is modeled).`
        : "Patient pools are synthetic-cohort placeholders (estimator offline — DataSUS pools return when it reconnects).",
      "Site capture rate over the eligible pool (conservative screen-to-enrol default).",
      competitionLive
        ? `Competition + KOL investigators are LIVE from ClinicalTrials.gov (${competitionLive.total} recruiting BR studies). PubMed/ORCID KOL signals remain modeled until those connectors are wired.`
        : "Competition, KOL and startup signals are MODELED placeholders until the CT.gov / PubMed connectors are wired (R9).",
      "SUS→total correction not yet applied (ANS connector pending); trials not on CT.gov (ReBEC) not yet counted.",
    ],
  });
}

/**
 * §2 funnel from the REAL national estimate: a registry-sealed DataSUS base cohort
 * narrowing to a CI-carrying eligible estimate. The estimate itself is a transported
 * model over real rows, so it stays MODELED (imputed → modeled per metric.ts), but
 * the base is registry_gov/HIGH and every metric cites the DataSUS source + date.
 */
function buildRealFunnel(est: NationalEstimate, criteria: Criterion[]): FunnelSummary {
  const src = [datasusSourceRef(est)];
  const inclusion = criteria.filter((c) => c.kind === "inclusion").length;
  const eligible = Math.round(est.estimatedN);
  const ci: [number, number] = [Math.round(est.ciLo), Math.round(est.ciHi)];
  const survivalPct = est.baseCohort > 0 ? round1((100 * est.estimatedN) / est.baseCohort) : 0;
  // National eligible arrivals/month (incidence-based, summed over reporting UFs),
  // discounted by the conservative screen-to-enrol default.
  const monthlyEligible = est.byRegion.reduce((s, r) => s + (r.monthlyEligible ?? 0), 0);
  const ppm = monthlyEligible > 0 ? monthlyEligible * DEFAULT_SCREEN_TO_ENROLL : null;

  return {
    scope: "national",
    scopeRef: null,
    basePopulationMetric: registry("funnel.base", est.baseCohort, Confidence.HIGH, {
      unit: "patients",
      asOf: est.asOf,
      sourceRefs: src,
      note: "Real indication-wide base cohort — row-level DataSUS/OMOP records.",
    }),
    stages: [
      {
        criterionId: "all_ie",
        label: `Full I/E funnel (${inclusion} inclusion + ${criteria.length - inclusion} exclusion)`,
        survivalMetric: modeled("funnel.survival", survivalPct, Confidence.MEDIUM, {
          unit: "%",
          asOf: est.asOf,
          sourceRefs: src,
        }),
        remainingPoolMetric: modeled("funnel.remaining", eligible, Confidence.MEDIUM, {
          unit: "patients",
          asOf: est.asOf,
          ci,
          sourceRefs: src,
        }),
        burdenFlag: est.baseCohort > 0 && est.estimatedN / est.baseCohort < 0.2,
      },
    ],
    eligiblePoolMetric: modeled("funnel.eligible", eligible, Confidence.MEDIUM, {
      unit: "patients",
      asOf: est.asOf,
      ci,
      sourceRefs: src,
      note: "Transported estimate over the real DataSUS base; 95% CI shown.",
    }),
    projectedPatientsPerMonthMetric: modeled("funnel.ppm", ppm != null ? round1(ppm) : null, ppm != null ? Confidence.MEDIUM : Confidence.LOW, {
      unit: "patients/month",
      asOf: est.asOf,
      sourceRefs: src,
      note:
        ppm != null
          ? "Eligible arrivals/month (DataSUS incidence) × conservative screen-to-enrol default."
          : "Estimator did not report per-region fill speed.",
    }),
  };
}

/**
 * §2 softening from the REAL bottleneck gains: how many actual base-cohort patients
 * each criterion excludes. Indication-defining criteria (e.g. metastatic disease)
 * surface here too — the metric notes make clear that relaxing those is a population
 * change, not a protocol softening.
 */
function buildRealSoftening(est: NationalEstimate, phase: "II" | "III"): SofteningSummary {
  const src = [datasusSourceRef(est)];
  const top = est.bottlenecks
    .filter((b) => b.gain > 0)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 3);
  return {
    scenarios: top.map((b) => ({
      label: `Relax: ${b.text}`,
      criteriaRelaxed: [b.criterionId],
      deltaEligiblePoolMetric: modeled("soften.delta_pool", Math.round(b.gain), Confidence.MEDIUM, {
        unit: "patients",
        asOf: est.asOf,
        sourceRefs: src,
        note: "Real base-cohort patients currently excluded by this criterion (DataSUS).",
      }),
      deltaPatientsPerMonthMetric: modeled("soften.delta_ppm", null, Confidence.LOW, {
        unit: "patients/month",
        note: "Per-month delta requires the rate model per scenario (R-followup).",
      }),
      amendmentCostAvoidedMetric: amendmentCost(phase),
      scientificRiskNote:
        "Gain measured over the indication-wide base cohort. If this criterion defines the study population (e.g. disease stage or biomarker), relaxing it changes the indication — review clinical rationale before treating it as a softening lever.",
    })),
  };
}

/**
 * §4 supply/demand inputs from the REAL estimate: UF-level estimates rolled up to
 * the 5 macro-regions, competing trials from CT.gov when live.
 */
function buildRealRegionSDInputs(
  est: NationalEstimate,
  competition?: CompetitionData,
): RegionSDInput[] {
  const src = [datasusSourceRef(est)];
  return macroRegionPools(est).map((p) => {
    const liveCount = competition?.byRegion?.[p.region];
    return {
      regionCode: p.region,
      regionName: p.region,
      eligiblePool: p.eligible,
      eligiblePoolSourceRefs: src,
      eligiblePoolNote: `Aggregate estimate statistically transported to the observed DataSUS population (UF-level estimates summed; base cohort ${p.baseCohort.toLocaleString("en-US")}).`,
      competingTrials: liveCount ?? 4,
      competingTrialsProvenance: liveCount != null ? ("registry" as const) : ("modeled" as const),
      population: BR_MACROREGION_POPULATION[p.region] ?? 20_000_000,
    };
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

/**
 * Aggregate evaluated sites into per-macro-region supply/demand inputs. Eligible
 * pool is real (summed from the funnel); population is IBGE; competing trials is a
 * MODELED placeholder (flat per region) until the CT.gov/ReBEC connector lands (R9).
 */
function buildRegionSDInputs(sites: EvaluatedSite[], competition?: CompetitionData): RegionSDInput[] {
  const byRegion = new Map<string, number>();
  for (const s of sites) {
    const pool = s.counts.definite + s.counts.possible;
    byRegion.set(s.meta.region, (byRegion.get(s.meta.region) ?? 0) + pool);
  }
  return Array.from(byRegion.entries()).map(([region, pool]) => {
    const liveCount = competition?.byRegion?.[region as keyof typeof competition.byRegion];
    return {
      regionCode: region,
      regionName: region,
      eligiblePool: pool,
      // Real CT.gov count when available (registry), else the modeled placeholder.
      competingTrials: liveCount ?? 4,
      competingTrialsProvenance: liveCount != null ? ("registry" as const) : ("modeled" as const),
      population: BR_MACROREGION_POPULATION[region] ?? 20_000_000,
    };
  });
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
