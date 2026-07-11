/**
 * Real patient pools — the pure adapter from the Python estimator's national
 * estimate (DataSUS/OMOP, real base cohort) to the engine's pool inputs.
 *
 * This replaces the last big MODELED placeholder chain: the synthetic per-site
 * cohorts and the PI-count pool proxy. Three projections, all pure:
 *   - macro-region pools (UF estimates rolled up) for §4 supply vs. demand,
 *   - a national pool Metric (CI + DataSUS citation) for the §3 country card,
 *   - per-site pool allocation: each UF's real eligible count split across the
 *     directory's oncology sites by PI-count share. The UF TOTAL is real
 *     (registry-derived); the per-site SHARE is modeled — the metrics say so.
 *
 * No I/O and no clock: callers fetch the NationalEstimate (client.ts) and pass
 * it in, keeping scoring/report code reproducible from its inputs.
 */

import { Confidence, Metric, metric, Provenance } from "@/lib/metric";
import type { NationalEstimate } from "@/lib/estimator/client";
import type { DirectorySite, Macroregion } from "@/lib/sites/directory";
import { ufToRegion } from "@/lib/sites/directory";
import { DEFAULT_SCREEN_TO_ENROLL } from "@/lib/feasibility";

export interface MacroRegionPool {
  region: Macroregion;
  /** Real estimated eligible patients in the macro-region (sum of its UFs). */
  eligible: number;
  /** Real base cohort (row-level DataSUS records) behind the estimate. */
  baseCohort: number;
  /** Eligible patients arriving per month (incidence-based), when reported. */
  monthlyEligible: number | null;
}

/** One site's slice of its UF's real eligible pool. */
export interface SitePoolAllocation {
  /** Allocated eligible pool (UF real total × this site's modeled share). */
  pool: number;
  /** Projected enrollment/month: UF monthly eligible × share × screen-to-enroll. */
  ppm: number | null;
  uf: string;
  /** The UF's real eligible total the share was taken from. */
  ufEligible: number;
  /** This site's modeled share of the UF pool (0..1). */
  share: number;
}

/** DataSUS citation carried on every metric derived from the estimate. */
export function datasusSourceRef(est: NationalEstimate) {
  return {
    label: `${est.dataSource} — TrialBridge estimator (${est.protocolId})`,
    sourceVersion: est.asOf,
  };
}

/** Roll the estimator's per-UF estimates up to the 5 Brazilian macro-regions. */
export function macroRegionPools(est: NationalEstimate): MacroRegionPool[] {
  const byRegion = new Map<Macroregion, MacroRegionPool>();
  for (const r of est.byRegion) {
    const region = ufToRegion(r.region);
    if (!region) continue; // unknown UF code — skip rather than misfile
    const cur = byRegion.get(region) ?? {
      region,
      eligible: 0,
      baseCohort: 0,
      monthlyEligible: null,
    };
    cur.eligible += r.estimatedN;
    cur.baseCohort += r.baseCohort;
    if (r.monthlyEligible != null) {
      cur.monthlyEligible = (cur.monthlyEligible ?? 0) + r.monthlyEligible;
    }
    byRegion.set(region, cur);
  }
  return [...byRegion.values()].sort((a, b) => b.eligible - a.eligible);
}

/**
 * The national eligible-pool Metric for the country card: a transported estimate
 * (imputed → MODELED per the provenance mapping in metric.ts) over a real DataSUS
 * base, carrying the estimator's CI and the base's citation.
 */
export function nationalPoolMetric(est: NationalEstimate): Metric {
  return metric(
    "country.patient_supply.national_pool",
    Math.round(est.estimatedN),
    Provenance.MODELED,
    Confidence.MEDIUM,
    {
      unit: "patients",
      asOf: est.asOf,
      ci: [Math.round(est.ciLo), Math.round(est.ciHi)],
      sourceRefs: [datasusSourceRef(est)],
      note: `Transported estimate over a real base cohort of ${est.baseCohort.toLocaleString("en-US")} DataSUS patients; SUS-access caveat applies (ANS correction pending).`,
    },
  );
}

/**
 * Split each UF's real eligible pool across that UF's oncology directory sites,
 * weighted by PI count (a site with no PI figure gets weight 1, never 0 — it still
 * treats patients). Returns a CNES/id-keyed map; sites in UFs the estimator does
 * not cover are absent, and callers fall back to the old modeled proxy for them.
 */
export function allocateSitePools(
  sites: DirectorySite[],
  est: NationalEstimate,
): Map<string, SitePoolAllocation> {
  const byUf = new Map(est.byRegion.map((r) => [r.region, r]));

  // Group the allocatable sites by UF.
  const sitesByUf = new Map<string, DirectorySite[]>();
  for (const s of sites) {
    const uf = s.uf?.trim().toUpperCase();
    if (!uf || !byUf.has(uf)) continue;
    const list = sitesByUf.get(uf) ?? [];
    list.push(s);
    sitesByUf.set(uf, list);
  }

  const weight = (s: DirectorySite) => Math.max(1, s.piCount ?? 1);
  const out = new Map<string, SitePoolAllocation>();
  for (const [uf, ufSites] of sitesByUf) {
    const ufEst = byUf.get(uf)!;
    const total = ufSites.reduce((n, s) => n + weight(s), 0);
    for (const s of ufSites) {
      const share = weight(s) / total;
      out.set(s.cnes ?? s.id, {
        pool: Math.round(ufEst.estimatedN * share),
        ppm:
          ufEst.monthlyEligible != null
            ? ufEst.monthlyEligible * share * DEFAULT_SCREEN_TO_ENROLL
            : null,
        uf,
        ufEligible: ufEst.estimatedN,
        share,
      });
    }
  }
  return out;
}
