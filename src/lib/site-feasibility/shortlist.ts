import { Confidence, modeled, registry, unavailable, Provenance } from "@/lib/metric";
import type {
  RegionalSupplyInput,
  SitePrequalificationEntry,
  SitePrequalificationShortlist,
  SiteRegistryLandscape,
} from "@/lib/site-feasibility/types";

const MASTER_REF = { label: "TrialBridge facility master v1" };
const CTGOV_REF = { label: "ClinicalTrials.gov registry", url: "https://clinicaltrials.gov/" };

export function buildSitePrequalificationShortlist(
  landscape: SiteRegistryLandscape,
  regionalSupply: RegionalSupplyInput[],
  opts: { limit?: number; asOf?: string | null } = {},
): SitePrequalificationShortlist {
  const asOf = opts.asOf ?? landscape.asOf ?? null;
  const supplyByUf = new Map(regionalSupply.map((item) => [item.uf.toUpperCase(), item]));
  const activeTrialsByUf = new Map<string, Set<string>>();
  for (const site of landscape.sites) {
    if (!site.uf) continue;
    const uf = site.uf.toUpperCase();
    const ids = activeTrialsByUf.get(uf) ?? new Set<string>();
    site.activeCandidateCompetitorIds.forEach((id) => ids.add(id));
    activeTrialsByUf.set(uf, ids);
  }

  const entries = landscape.sites.map((site): SitePrequalificationEntry => {
    const uf = site.uf?.toUpperCase() ?? null;
    const supply = uf ? supplyByUf.get(uf) : undefined;
    const regionalCompetitors = uf ? activeTrialsByUf.get(uf)?.size ?? 0 : null;
    const relevant = Number(site.relevantTrialCountMetric.value);
    const biomarker = Number(site.sameBiomarkerTrialCountMetric.value);
    const experienceScore = Math.min(100, relevant * 3 + biomarker * 7);
    const identityScore = Math.max(0,
      (site.cnes ? 40 : 0) +
      (site.hasConfirmedPi ? 40 : 0) +
      (uf ? 20 : 0) -
      (site.registryAliases.length > 1 ? 15 : 0),
    );
    const opportunityRatio = supply && regionalCompetitors !== null
      ? supply.eligible / Math.max(1, regionalCompetitors)
      : null;
    const opportunityScore = opportunityRatio === null
      ? null
      : Math.round(Math.min(100, 100 * (1 - Math.exp(-opportunityRatio / 50))));

    // Screening priority, not operational feasibility. Missing regional supply does
    // not become zero: known weights are renormalized, but the result is capped at 50
    // so missing geography/supply cannot outrank a comparable site with observable data.
    const rawPriority = opportunityScore === null
      ? (experienceScore * 0.45 + identityScore * 0.20) / 0.65
      : experienceScore * 0.45 + opportunityScore * 0.35 + identityScore * 0.20;
    const priority = Math.round(Math.min(opportunityScore === null ? 50 : 100, rawPriority));
    const supplyRefs = supply ? [{
      label: supply.sourceLabel,
      sourceVersion: supply.sourceVersion ?? null,
    }] : [];
    const evidenceGaps = [
      ...site.evidenceGaps,
      opportunityScore === null ? "Regional eligible pool unavailable" : null,
      "Direct competitors pending adjudication",
      "Infrastructure and site capacity pending verification",
    ].filter((value): value is string => Boolean(value));
    const status = opportunityScore === null
      ? "regional_supply_missing"
      : !site.cnes || site.registryAliases.length > 1
        ? "identity_review"
        : "ready_for_review";

    return {
      facilityId: site.facilityId,
      cnes: site.cnes,
      name: site.name,
      city: site.city,
      uf,
      status,
      experienceScoreMetric: modeled("site_shortlist.experience", experienceScore, Confidence.MEDIUM, {
        unit: "score_0_100", asOf, sourceRefs: [CTGOV_REF, MASTER_REF],
        note: "Screening score from relevant and same-biomarker registry history.",
      }),
      regionalEligiblePoolMetric: supply
        ? modeled("site_shortlist.regional_eligible_pool", Math.round(supply.eligible), Confidence.MEDIUM, {
            unit: "patients", asOf: supply.asOf ?? asOf, sourceRefs: supplyRefs,
            note: "UF-level transported estimate; not a facility patient count.",
          })
        : unavailable("site_shortlist.regional_eligible_pool", Provenance.MODELED, "No estimator coverage for this UF.", { unit: "patients", asOf }),
      regionalCompetitionMetric: regionalCompetitors === null
        ? unavailable("site_shortlist.regional_competition", Provenance.REGISTRY_GOV, "UF unavailable.", { unit: "candidate trials", asOf })
        : registry("site_shortlist.regional_competition", regionalCompetitors, Confidence.LOW, {
            unit: "candidate trials", asOf, sourceRefs: [CTGOV_REF],
            note: "Distinct active registry candidates across linked facilities in the UF; direct competition pending adjudication.",
          }),
      opportunityScoreMetric: opportunityScore === null
        ? unavailable("site_shortlist.opportunity", Provenance.MODELED, "Regional supply unavailable.", { unit: "score_0_100", asOf })
        : modeled("site_shortlist.opportunity", opportunityScore, Confidence.LOW, {
            unit: "score_0_100", asOf, sourceRefs: [...supplyRefs, CTGOV_REF],
            note: "Directional ratio of UF eligible supply to active registry candidates.",
          }),
      identityScoreMetric: modeled("site_shortlist.identity", identityScore, Confidence.MEDIUM, {
        unit: "score_0_100", asOf, sourceRefs: [MASTER_REF],
        note: "CNES confirmation, UF availability and confirmed local investigator link.",
      }),
      priorityScoreMetric: modeled("site_shortlist.priority", priority, Confidence.LOW, {
        unit: "score_0_100", asOf, sourceRefs: [CTGOV_REF, MASTER_REF, ...supplyRefs],
        note: "Prequalification priority only; excludes verified infrastructure, enrollment rate, startup and staffing.",
      }),
      evidenceGaps: [...new Set(evidenceGaps)],
    };
  });

  entries.sort((a, b) =>
    Number(b.priorityScoreMetric.value) - Number(a.priorityScoreMetric.value) ||
    statusRank(b.status) - statusRank(a.status) ||
    Number(b.experienceScoreMetric.value) - Number(a.experienceScoreMetric.value) ||
    a.name.localeCompare(b.name),
  );

  return {
    schemaVersion: "site-prequalification-shortlist.v1",
    asOf,
    entries: entries.slice(0, Math.max(1, opts.limit ?? 20)),
    methodology: [
      "45% protocol-relevant registry experience.",
      "35% regional opportunity: UF eligible estimate relative to active registry candidates.",
      "20% identity readiness: confirmed CNES, UF and confirmed investigator link.",
      "Missing regional supply is not zeroed; known weights are renormalized and the priority score is capped at 50.",
    ],
    limitations: [
      "This is a prequalification priority, not a prediction of site enrollment.",
      "Infrastructure, historical enrollment rate, staffing, startup and current PI availability remain gating evidence.",
      "Registry candidates must be adjudicated before being described as direct competitors.",
    ],
  };
}

function statusRank(status: SitePrequalificationEntry["status"]): number {
  if (status === "ready_for_review") return 2;
  if (status === "identity_review") return 1;
  return 0;
}
