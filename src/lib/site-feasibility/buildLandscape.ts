import { Confidence, modeled, registry, unavailable, Provenance } from "@/lib/metric";
import { classifyTrialRelevance } from "@/lib/site-feasibility/relevance";
import { fetchRegistryTrialUniverse, type RegistryTrialUniverse } from "@/lib/site-feasibility/registry";
import type {
  FacilityTrialRow,
  SiteFeasibilityQuery,
  SiteRegistryLandscape,
  SiteRegistryLonglistEntry,
} from "@/lib/site-feasibility/types";

const CTGOV_REF = { label: "ClinicalTrials.gov registry", url: "https://clinicaltrials.gov/" };
const MASTER_REF = { label: "TrialBridge facility master v1" };

export interface BuildSiteLandscapeOptions {
  asOf?: string | null;
  dbPath?: string;
  registryUniverse?: RegistryTrialUniverse;
  /** Test/offline injection; production reads the restricted SQLite server-side. */
  facilityRows?: FacilityTrialRow[];
}

export async function buildSiteRegistryLandscape(
  query: SiteFeasibilityQuery,
  opts: BuildSiteLandscapeOptions = {},
): Promise<SiteRegistryLandscape> {
  const asOf = opts.asOf ?? null;
  const universe = opts.registryUniverse ?? await fetchRegistryTrialUniverse(query);
  if (universe.source !== "live") {
    return unavailableLandscape(query, asOf, universe.note ?? "ClinicalTrials.gov unavailable.");
  }

  const relevance = new Map(
    universe.trials.map((trial) => [trial.nctId, classifyTrialRelevance(query, trial)]),
  );
  const relevantIds = universe.trials
    .filter((trial) => relevance.get(trial.nctId)?.category !== "not_relevant")
    .map((trial) => trial.nctId);
  const rows = opts.facilityRows ??
    (await import("@/lib/site-feasibility/masterRepository"))
      .readFacilityTrialsForNcts(relevantIds, opts.dbPath);
  const sites = aggregateSites(rows, relevance, asOf);
  const note = universe.truncated
    ? universe.note
    : rows.length === 0 && relevantIds.length > 0
      ? "Relevant registry studies were found, but none linked to the local facility-master snapshot."
      : undefined;

  return {
    schemaVersion: "site-registry-landscape.v1",
    query,
    source: "live",
    asOf,
    candidateTrialCountMetric: registry("site_landscape.candidate_trials", relevantIds.length, Confidence.MEDIUM, {
      unit: "trials",
      asOf,
      sourceRefs: [CTGOV_REF],
      note: "Broad registry candidates classified deterministically; direct competition still requires adjudication.",
    }),
    linkedFacilityCountMetric: registry("site_landscape.linked_facilities", sites.length, Confidence.MEDIUM, {
      unit: "facilities",
      asOf,
      sourceRefs: [CTGOV_REF, MASTER_REF],
    }),
    sites,
    limitations: [
      "Registry relevance is a screening signal, not proof of direct protocol comparability.",
      "Active candidate competitors require review of subtype, line of therapy, eligibility overlap and local recruitment status.",
      "Patient availability is not inferred at facility level; DataSUS/OMOP supply remains regional until a defensible site-level source exists.",
      "Operational capacity, enrollment rate, startup, staffing and current PI availability require verified enrichment or a site questionnaire.",
    ],
    note,
  };
}

function aggregateSites(
  rows: FacilityTrialRow[],
  relevance: Map<string, ReturnType<typeof classifyTrialRelevance>>,
  asOf: string | null,
): SiteRegistryLonglistEntry[] {
  const byFacility = new Map<string, { base: FacilityTrialRow; ids: Set<string>; registryNames: Map<string, number> }>();
  for (const row of rows) {
    const existing = byFacility.get(row.facilityId) ?? {
      base: row,
      ids: new Set<string>(),
      registryNames: new Map<string, number>(),
    };
    existing.ids.add(row.nctId);
    existing.registryNames.set(row.registrySiteName, (existing.registryNames.get(row.registrySiteName) ?? 0) + 1);
    byFacility.set(row.facilityId, existing);
  }

  const sites = [...byFacility.values()].map(({ base, ids, registryNames }) => {
    const relevantTrialIds = [...ids].sort();
    const sameBiomarkerTrialIds = relevantTrialIds.filter(
      (id) => relevance.get(id)?.category === "same_biomarker",
    );
    const activeCandidateCompetitorIds = relevantTrialIds.filter(
      (id) => relevance.get(id)?.activeCandidateCompetitor,
    );
    const sourceRefs = [CTGOV_REF, MASTER_REF];
    const evidenceCoverage = Math.min(100,
      Math.min(base.totalTrialCount, 20) * 2 +
      Math.min(relevantTrialIds.length, 5) * 8 +
      Math.min(sameBiomarkerTrialIds.length, 3) * 5 +
      (base.hasConfirmedPi ? 5 : 0),
    );
    const evidenceGaps = [
      !base.cnes ? "CNES not confirmed" : null,
      !base.uf ? "UF unavailable" : null,
      !base.hasConfirmedPi ? "No confirmed investigator link in the local roster" : null,
      registryNames.size > 1 ? "Multiple registry site aliases resolve to this facility" : null,
      "Site-level patient pool not available",
      "Operational capacity not verified",
    ].filter((value): value is string => Boolean(value));

    return {
      facilityId: base.facilityId,
      cnes: base.cnes,
      name: [...registryNames.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? base.name,
      officialName: base.name,
      registryAliases: [...registryNames.keys()].sort(),
      city: base.city,
      uf: base.uf,
      activityStatus: base.activityStatus,
      hasConfirmedPi: base.hasConfirmedPi,
      relevantTrialIds,
      sameBiomarkerTrialIds,
      activeCandidateCompetitorIds,
      totalTrialCountMetric: registry("site_landscape.site.total_trials", base.totalTrialCount, Confidence.MEDIUM, {
        unit: "trials", asOf, sourceRefs,
      }),
      relevantTrialCountMetric: registry("site_landscape.site.relevant_trials", relevantTrialIds.length, Confidence.MEDIUM, {
        unit: "trials", asOf, sourceRefs,
      }),
      sameBiomarkerTrialCountMetric: registry("site_landscape.site.same_biomarker_trials", sameBiomarkerTrialIds.length, Confidence.MEDIUM, {
        unit: "trials", asOf, sourceRefs,
      }),
      activeCandidateCompetitorCountMetric: registry("site_landscape.site.active_candidate_competitors", activeCandidateCompetitorIds.length, Confidence.LOW, {
        unit: "candidate trials", asOf, sourceRefs,
        note: "Registry-screened candidates; direct competition pending human adjudication.",
      }),
      evidenceCoverageMetric: modeled("site_landscape.site.evidence_coverage", evidenceCoverage, Confidence.LOW, {
        unit: "score_0_100", asOf, sourceRefs,
        note: "Directional evidence-coverage score; not the final operational feasibility score.",
      }),
      evidenceGaps,
    } satisfies SiteRegistryLonglistEntry;
  });

  return sites.sort((a, b) =>
    Number(b.sameBiomarkerTrialCountMetric.value) - Number(a.sameBiomarkerTrialCountMetric.value) ||
    Number(b.relevantTrialCountMetric.value) - Number(a.relevantTrialCountMetric.value) ||
    Number(b.totalTrialCountMetric.value) - Number(a.totalTrialCountMetric.value) ||
    a.name.localeCompare(b.name),
  );
}

function unavailableLandscape(
  query: SiteFeasibilityQuery,
  asOf: string | null,
  note: string,
): SiteRegistryLandscape {
  return {
    schemaVersion: "site-registry-landscape.v1",
    query,
    source: "unavailable",
    asOf,
    candidateTrialCountMetric: unavailable("site_landscape.candidate_trials", Provenance.REGISTRY_GOV, note, { unit: "trials", asOf }),
    linkedFacilityCountMetric: unavailable("site_landscape.linked_facilities", Provenance.REGISTRY_GOV, note, { unit: "facilities", asOf }),
    sites: [],
    limitations: ["The registry longlist was withheld because the source was unavailable; missing data was not converted to zero."],
    note,
  };
}
