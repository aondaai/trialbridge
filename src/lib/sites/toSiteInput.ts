/**
 * Map a real directory site (ABRACRO/ACESSE) → the engine's SiteInput, so the §5/§6
 * site rankings operate over REAL Brazilian centres instead of 3 synthetic ones.
 *
 * Uses real directory signals where we have them — ANVISA/FDA/EMA inspection experience
 * → data quality, lab/EDC capability → infra fit, a named ethics committee → CEP gate,
 * CT.gov competition per region, and REAL DataSUS pool allocations (estimator UF totals
 * split by PI share) when the estimator covers the site's UF. What still lacks a source
 * stays an honest MODELED placeholder. A real (publicly-verifiable) pool is one of the
 * three confidence signals, so covered sites with PI history roll up to MEDIUM.
 */

import type { DirectorySite } from "@/lib/sites/directory";
import type { SiteInput } from "@/lib/scoring/site";
import type { TrialProfile } from "@/lib/scoring/weights";
import type { KolInvestigatorInput } from "@/lib/kol/score";
import { kolScore } from "@/lib/kol/score";
import type { SiteInfra } from "@/lib/sites/infraEnrich";
import type { SitePoolAllocation } from "@/lib/estimator/pools";

export interface SiteInputContext {
  profile: TrialProfile;
  /** Competing trials in the site's macro-region (CT.gov, real). */
  competingByRegion: Partial<Record<string, number>>;
  /** Best KOL score per CNES, from the cross-referenced investigators. */
  kolByCnes?: Map<string, number>;
  /** Real deep-web-researched infrastructure per CNES (Part B), when available. */
  infraByCnes?: Map<string, SiteInfra>;
  /** Real DataSUS pool allocation per CNES/id (estimator UF totals × site share).
   *  When a site has one, it replaces the PI-count pool proxy. */
  poolByCnes?: Map<string, SitePoolAllocation>;
  daysToFpiBudget?: number;
}

/** Build a CNES → best-KOL-score map from cross-referenced investigators. */
export function kolScoreByCnes(investigators: KolInvestigatorInput[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const inv of investigators) {
    if (!inv.cnes) continue;
    const score = kolScore(inv).composite0100;
    map.set(inv.cnes, Math.max(map.get(inv.cnes) ?? 0, score));
  }
  return map;
}

export function directorySiteToSiteInput(site: DirectorySite, ctx: SiteInputContext): SiteInput {
  const piCount = site.piCount ?? 0;
  const insp = site.inspections;
  const realPool = ctx.poolByCnes?.get(site.cnes ?? site.id);

  // Infra-fit: REAL deep-web-researched equipment (Part B) when we have it — the five
  // oncology-core items (CACON/UNACON, radiotherapy, on-site imaging, ICU, GCP pharmacy);
  // otherwise a coarser proxy from the directory's capability flags.
  const realInfra = site.cnes ? ctx.infraByCnes?.get(site.cnes) : undefined;
  let requiredEquipment: number;
  let present: number;
  if (realInfra) {
    requiredEquipment = 5;
    present = [
      realInfra.caconOrUnacon,
      realInfra.linearAccelerator,
      realInfra.petCt || realInfra.mri,
      realInfra.icuBeds > 0,
      realInfra.gcpPharmacy,
    ].filter(Boolean).length;
  } else {
    // Equipment UNVERIFIED — give only PARTIAL credit from the self-reported capability
    // flags (max 4 of 6), so a real deep-web-researched, well-equipped site (up to 100%)
    // ranks ABOVE an un-researched one, not below it. Full verification is `enrich-sites`.
    requiredEquipment = 6;
    present = [site.centralLabExams, site.centralLabImaging, site.oncology, site.edcExperience].filter(Boolean).length;
  }

  return {
    cnes: site.cnes ?? site.id,
    name: site.name,
    city: site.city ?? "",
    uf: site.uf ?? "",
    profile: ctx.profile,

    // Eligible pool: REAL DataSUS allocation when the estimator covers this site's UF —
    // the UF total is a real-base estimate (publicly verifiable), the per-site share is
    // modeled from PI count. Otherwise fall back to the old PI-count capacity proxy.
    eligiblePool: realPool ? realPool.pool : Math.max(20, piCount * 15),
    declaredPool: null,
    poolVerifiablePublicly: !!realPool,

    projectedPatientsPerMonth: realPool?.ppm ?? Math.max(0.5, piCount * 0.4),
    declaredCommitmentPerMonth: null,

    priorTrials: piCount, // proxy (association centres run trials)
    historicalEnrollmentRate: null,
    zeroEnroller: false,
    hasPIHistory: piCount > 0,

    competingTrialsInCatchment: (site.region && ctx.competingByRegion[site.region]) || 3,

    requiredEquipment,
    presentEquipment: present,

    kolScore0100: site.cnes ? ctx.kolByCnes?.get(site.cnes) ?? null : null,

    projectedFpiDays: 90,

    // Data quality: REAL — regulatory inspection experience.
    inspectionOk: insp.anvisa || insp.fda || insp.ema || insp.any,
    declaredQueryRate: null,

    crcCount: piCount || null,
    crcExperienceYears: null,
    emrEsource: site.edcExperience,

    hasDeclaration: false,
    hasDigitalSfq: false,

    minInfraFit: 25, // low bar until real equipment (Part B) — avoids false hard-flags
    cepAccreditedForRisk: !!site.cepName, // named ethics committee on file
    impLeadTimeDays: 77,
    daysToFpiBudget: ctx.daysToFpiBudget ?? 180,

    screenFailRate: null,
    retentionRate: null,
  };
}
