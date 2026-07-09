/**
 * Service layer — the shared computation used by BOTH the demo script and the
 * Next server components. Keeping it here means the numbers on screen and the
 * numbers in `npm run demo` come from exactly the same code path.
 */

import type { Criterion, Patient, PatientEvaluation } from "@/lib/matcher/types";
import { evaluateCohort, countCohorts, CohortCounts } from "@/lib/matcher/engine";
import { aggregate, AggregatedView, aggregateByRegion, RegionAggregate, biomarkerSlice, SliceRow } from "@/lib/matcher/aggregate";
import { softenCriterion, rankBottlenecks, SofteningResult } from "@/lib/matcher/soften";
import { estimateFeasibility, FeasibilityEstimate } from "@/lib/feasibility";
import { loadAllSites, SiteDataset, SiteMeta } from "@/lib/data/sites";

export interface EvaluatedSite {
  meta: SiteMeta;
  patients: Patient[];
  evals: PatientEvaluation[];
  counts: CohortCounts;
}

export function evaluateDataset(ds: SiteDataset, criteria: Criterion[]): EvaluatedSite {
  const evals = evaluateCohort(ds.patients, criteria);
  return { meta: ds.site, patients: ds.patients, evals, counts: countCohorts(evals) };
}

/** Evaluate every listed site against a protocol. */
export async function evaluateAllSites(criteria: Criterion[]): Promise<EvaluatedSite[]> {
  const sites = await loadAllSites();
  return sites.map((ds) => evaluateDataset(ds, criteria));
}

/** Sponsor-facing aggregate (counts-only + suppression) across responding sites. */
export function aggregateView(sites: EvaluatedSite[]): AggregatedView {
  return aggregate(
    sites.map((s) => ({ siteId: s.meta.id, siteName: s.meta.name, counts: s.counts })),
  );
}

/** Combined softening across every responding site's pooled patients. */
export function combinedSoftening(
  sites: EvaluatedSite[],
  criteria: Criterion[],
  handle: string,
): SofteningResult {
  const allPatients = sites.flatMap((s) => s.patients);
  return softenCriterion(allPatients, criteria, handle);
}

/** Rank bottlenecks across the pooled cohort (finds the criterion to loosen). */
export function combinedBottlenecks(sites: EvaluatedSite[], criteria: Criterion[]): SofteningResult[] {
  return rankBottlenecks(sites.flatMap((s) => s.patients), criteria);
}

export interface RegionRow extends RegionAggregate {
  monthlyIncidence: number;
  feasibility: FeasibilityEstimate;
}

/**
 * Group evaluated sites by Brazilian macro-region and attach a per-region
 * feasibility estimate (summed monthly incidence, same R1/R2 model as a
 * single site). Sorted by deliverable estimate, biggest region first.
 */
export function regionBreakdown(sites: EvaluatedSite[], months = 6): RegionRow[] {
  const byRegion = aggregateByRegion(sites.map((s) => ({ region: s.meta.region, counts: s.counts })));
  const incidenceByRegion = new Map<string, number>();
  for (const s of sites) {
    incidenceByRegion.set(s.meta.region, (incidenceByRegion.get(s.meta.region) ?? 0) + s.meta.monthlyIncidence);
  }
  return byRegion
    .map((r) => {
      const monthlyIncidence = incidenceByRegion.get(r.region) ?? 0;
      const feasibility = estimateFeasibility({
        definite: r._raw.definite,
        possible: r._raw.possible,
        monthlyIncidence,
        months,
      });
      return { ...r, monthlyIncidence, feasibility };
    })
    .sort((a, b) => b.feasibility.enrollableEstimate - a.feasibility.enrollableEstimate);
}

/** Per-site feasibility estimate (R1 funnel + R2 rate). */
export function siteFeasibility(site: EvaluatedSite, months = 6): FeasibilityEstimate {
  return estimateFeasibility({
    definite: site.counts.definite,
    possible: site.counts.possible,
    monthlyIncidence: site.meta.monthlyIncidence,
    months,
  });
}

/** A rare-subgroup slice for demonstrating <5 suppression. */
export function suppressionSlice(
  sites: EvaluatedSite[],
  field: string,
  value: string,
): SliceRow[] {
  return biomarkerSlice(
    sites.map((s) => ({ siteId: s.meta.id, siteName: s.meta.name, patients: s.patients, evals: s.evals })),
    field,
    value,
  );
}

/**
 * Missingness of one biomarker/data field among a diagnosis-filtered
 * population — R3 realism evidence, and the "testing gap" stat for any
 * not-evaluable field (e.g. kras_g12c/pdl1_status among lung-cancer
 * patients). The denominator is the diagnosis subgroup, not the whole site.
 */
export function biomarkerMissingness(
  sites: EvaluatedSite[],
  diagnosis: string,
  field: string,
): { siteId: string; siteName: string; cohort: number; missing: number; pct: number }[] {
  return sites.map((s) => {
    const cohort = s.patients.filter((p) => p.diagnosis === diagnosis);
    const missing = cohort.filter((p) => p.biomarkers[field] == null).length;
    return {
      siteId: s.meta.id,
      siteName: s.meta.name,
      cohort: cohort.length,
      missing,
      pct: cohort.length ? Math.round((100 * missing) / cohort.length) : 0,
    };
  });
}

/** HER2 missingness among the protocol-relevant (breast-cancer) population — R3 evidence. */
export function biomarkerMissingnessAmongBreast(sites: EvaluatedSite[], field = "her2_status"): { siteId: string; siteName: string; breast: number; missing: number; pct: number }[] {
  return biomarkerMissingness(sites, "breast cancer", field).map((r) => ({
    siteId: r.siteId,
    siteName: r.siteName,
    breast: r.cohort,
    missing: r.missing,
    pct: r.pct,
  }));
}
