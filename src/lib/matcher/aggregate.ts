/**
 * The aggregation / privacy layer.
 *
 * This is the ONLY path by which one actor (a sponsor) sees another's data (a
 * site's patients). It returns COUNTS and bottleneck references — never rows.
 * The privacy model is structural: a `Response` is written as a count, so a
 * sponsor querying responses physically cannot reach patient rows.
 *
 * On top of that structural boundary we add minimum-cell-size suppression: any
 * non-zero cell below `MIN_CELL` is reported as "<5" so a small subgroup can't be
 * re-identified from an aggregate.
 *
 * HONEST SCOPE (see README): this is counts-not-rows + small-cell suppression, not
 * differential privacy. Complementary release across a softening toggle can still
 * leak a suppressed cell; full DP is v2. We state that plainly rather than oversell.
 */

import { CohortCounts } from "./engine";
import { PatientEvaluation, Patient } from "./types";

export const MIN_CELL = 5;

/** A count safe to display: a number, or the sentinel "<5" for a small non-zero cell. */
export type SafeCount = number | "<5";

export function suppress(n: number, min = MIN_CELL): SafeCount {
  if (n > 0 && n < min) return "<5";
  return n;
}

export interface SiteAggregate {
  siteId: string;
  siteName: string;
  definite: SafeCount;
  possible: SafeCount;
  /** definite + possible before suppression, then suppressed. The headline "candidates". */
  candidates: SafeCount;
  /** raw (unsuppressed) totals kept server-side only — never sent to the sponsor UI. */
  _raw: CohortCounts;
}

export interface AggregatedView {
  perSite: SiteAggregate[];
  /** Cross-site totals (suppressed). */
  totalDefinite: SafeCount;
  totalPossible: SafeCount;
  totalCandidates: SafeCount;
}

interface SiteEvals {
  siteId: string;
  siteName: string;
  counts: CohortCounts;
}

/** Build the sponsor-facing aggregate from per-site cohort counts. Applies suppression. */
export function aggregate(sites: SiteEvals[]): AggregatedView {
  const perSite: SiteAggregate[] = sites.map((s) => {
    const candidates = s.counts.definite + s.counts.possible;
    return {
      siteId: s.siteId,
      siteName: s.siteName,
      definite: suppress(s.counts.definite),
      possible: suppress(s.counts.possible),
      candidates: suppress(candidates),
      _raw: s.counts,
    };
  });

  let totDef = 0;
  let totPos = 0;
  for (const s of sites) {
    totDef += s.counts.definite;
    totPos += s.counts.possible;
  }
  return {
    perSite,
    totalDefinite: suppress(totDef),
    totalPossible: suppress(totPos),
    totalCandidates: suppress(totDef + totPos),
  };
}

/**
 * Build a biomarker subgroup slice so the demo can SHOW suppression firing.
 * Returns per-site candidate counts restricted to patients whose `field === value`.
 * A site with 1..4 such candidates renders as "<5".
 */
export interface SliceRow {
  siteId: string;
  siteName: string;
  candidates: SafeCount;
  _rawCandidates: number;
}

export function biomarkerSlice(
  sites: { siteId: string; siteName: string; patients: Patient[]; evals: PatientEvaluation[] }[],
  field: string,
  value: string,
): SliceRow[] {
  const target = value.trim().toLowerCase();
  return sites.map((s) => {
    let n = 0;
    for (let i = 0; i < s.patients.length; i++) {
      const p = s.patients[i];
      const bm = p.biomarkers[field];
      if (bm != null && String(bm).trim().toLowerCase() === target) {
        if (s.evals[i].cohort !== "excluded") n += 1;
      }
    }
    return { siteId: s.siteId, siteName: s.siteName, candidates: suppress(n), _rawCandidates: n };
  });
}
