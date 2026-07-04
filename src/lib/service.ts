/**
 * Service layer — the shared computation used by BOTH the demo script and the
 * Next server components. Keeping it here means the numbers on screen and the
 * numbers in `npm run demo` come from exactly the same code path.
 */

import type { Criterion, Patient, PatientEvaluation } from "@/lib/matcher/types";
import { evaluateCohort, countCohorts, CohortCounts } from "@/lib/matcher/engine";
import { aggregate, AggregatedView, biomarkerSlice, SliceRow } from "@/lib/matcher/aggregate";
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

/** Evaluate every seeded site against a protocol. */
export function evaluateAllSites(criteria: Criterion[]): EvaluatedSite[] {
  return loadAllSites().map((ds) => evaluateDataset(ds, criteria));
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

/** HER2 missingness among the protocol-relevant (breast-cancer) population — R3 evidence. */
export function biomarkerMissingnessAmongBreast(sites: EvaluatedSite[], field = "her2_status"): { siteId: string; siteName: string; breast: number; missing: number; pct: number }[] {
  return sites.map((s) => {
    const breast = s.patients.filter((p) => p.diagnosis === "breast cancer");
    const missing = breast.filter((p) => p.biomarkers[field] == null).length;
    return {
      siteId: s.meta.id,
      siteName: s.meta.name,
      breast: breast.length,
      missing,
      pct: breast.length ? Math.round((100 * missing) / breast.length) : 0,
    };
  });
}
