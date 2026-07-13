import type { InvestigatorEnrichment } from "@/lib/kol/enrich";
import { stableHash } from "@/lib/facilities/master";
import type { CtgovInvestigatorRoster, CtgovInvestigatorProfile } from "@/lib/ctgov/investigatorRosterModel";

export type InvestigatorKind = "confirmed_pi" | "ctgov_investigator" | "parallel_candidate";
export type CnesStatus = "confirmed" | "unverified" | "absent";
export type EvidenceStatus = "public_evidence" | "researched_no_positive_signal" | "not_researched";

export interface InvestigatorFacilityLink {
  facilityId: string;
  name: string;
  city: string | null;
  uf: string | null;
  cnes: string | null;
  cnesStatus: CnesStatus;
}

export interface InvestigatorDirectoryEntry {
  personId: string;
  name: string;
  kind: InvestigatorKind;
  facilities: InvestigatorFacilityLink[];
  evidenceStatus: EvidenceStatus;
  pubsCountTa: number | null;
  societyRoles: string[];
  guidelineAuthor: boolean | null;
  confidence: string | null;
  citations: Array<{ label: string; url?: string | null }>;
  sources: Array<"ABRACRO" | "ClinicalTrials.gov" | "Parallel">;
  ctgovTrialCount: number;
  ctgovRoles: string[];
  ctgovAffiliations: string[];
  ctgovNctIds: string[];
}

export interface InvestigatorDirectory {
  generatedAt: string | null;
  rosterAvailable: boolean;
  ctgovGeneratedAt: string | null;
  ctgovComplete: boolean;
  entries: InvestigatorDirectoryEntry[];
  summary: {
    confirmedPis: number;
    piFacilityLinks: number;
    researchFacilities: number;
    parallelProfiles: number;
    matchedParallelProfiles: number;
    standaloneParallelCandidates: number;
    profilesWithPublicEvidence: number;
    ctgovInvestigatorProfiles: number;
    ctgovTrialLinks: number;
    ctgovMatchedToConfirmedPis: number;
  };
}

export interface InvestigatorRosterRow {
  personId: string;
  displayName: string;
  facilityId: string;
  facilityName: string;
  city: string | null;
  uf: string | null;
  confirmedCnes: string | null;
  unverifiedCnes: string | null;
}

const dedupePersonKey = (name: string) => name
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
const displayNameQuality = (name: string) => name === name.toUpperCase() || name === name.toLowerCase() ? 0 : 1;
const PERSON_CREDENTIALS = new Set(["dr", "dra", "md", "phd", "msc", "ms", "facc", "prof", "professor"]);
const personMatchKey = (name: string) => dedupePersonKey(name).split(" ").filter((token) => !PERSON_CREDENTIALS.has(token)).join(" ");
const AFFILIATION_STOPWORDS = new Set(["hospital", "center", "centre", "centro", "clinica", "clinical", "research", "pesquisa", "instituto", "institute", "universidade", "university", "faculdade", "fundacao", "foundation", "ltda", "sa", "de", "da", "do", "das", "dos", "e", "of", "the"]);
const affiliationTokens = (value: string) => dedupePersonKey(value).split(" ").filter((token) => token.length >= 4 && !AFFILIATION_STOPWORDS.has(token));
const affiliationMatchesFacility = (affiliation: string, facilities: InvestigatorFacilityLink[]) => {
  const affiliationNormalized = dedupePersonKey(affiliation);
  const sourceTokens = affiliationTokens(affiliation);
  if (!affiliationNormalized) return false;
  return facilities.some((facility) => {
    const facilityNormalized = dedupePersonKey(facility.name);
    if (facilityNormalized === affiliationNormalized) return true;
    if (sourceTokens.length === 0) return false;
    const facilityTokens = new Set(affiliationTokens(facility.name));
    const shared = sourceTokens.filter((token) => facilityTokens.has(token));
    return shared.length >= 2 || shared.some((token) => token.length >= 7);
  });
};

function evidenceStatus(enrichment: InvestigatorEnrichment | undefined): EvidenceStatus {
  if (!enrichment || enrichment.source !== "parallel") return "not_researched";
  return enrichment.pubsCountTa > 0 || enrichment.societyRoles.length > 0 || enrichment.guidelineAuthor
    ? "public_evidence"
    : "researched_no_positive_signal";
}

function enrichmentFields(enrichment: InvestigatorEnrichment | undefined) {
  const parallel = enrichment?.source === "parallel" ? enrichment : undefined;
  return {
    evidenceStatus: evidenceStatus(parallel),
    pubsCountTa: parallel?.pubsCountTa ?? null,
    societyRoles: parallel?.societyRoles ?? [],
    guidelineAuthor: parallel?.guidelineAuthor ?? null,
    confidence: parallel?.confidence ?? null,
    citations: parallel?.citations ?? [],
  };
}

export function buildInvestigatorDirectory(
  rows: InvestigatorRosterRow[],
  enrichments: Record<string, InvestigatorEnrichment>,
  generatedAt: string | null,
  rosterAvailable = true,
  ctgovRoster: CtgovInvestigatorRoster | null = null,
): InvestigatorDirectory {
  const parent = new Map<string, string>();
  const find = (personId: string): string => {
    const current = parent.get(personId) ?? personId;
    if (!parent.has(personId)) parent.set(personId, personId);
    if (current === personId) return personId;
    const root = find(current);
    parent.set(personId, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a), rootB = find(b);
    if (rootA === rootB) return;
    if (rootA < rootB) parent.set(rootB, rootA);
    else parent.set(rootA, rootB);
  };
  const byNameFacility = new Map<string, string>();
  for (const row of rows) {
    find(row.personId);
    const key = `${dedupePersonKey(row.displayName)}|${row.facilityId}`;
    const prior = byNameFacility.get(key);
    if (prior) union(prior, row.personId);
    else byNameFacility.set(key, row.personId);
  }

  const byPerson = new Map<string, InvestigatorDirectoryEntry & { facilityIds: Set<string> }>();
  const uniqueLinks = new Set<string>();
  const researchFacilities = new Set<string>();

  for (const row of rows) {
    const personId = find(row.personId);
    let entry = byPerson.get(personId);
    if (!entry) {
      entry = {
        personId,
        name: row.displayName,
        kind: "confirmed_pi",
        facilities: [],
        facilityIds: new Set<string>(),
        ...enrichmentFields(undefined),
        sources: ["ABRACRO"],
        ctgovTrialCount: 0,
        ctgovRoles: [],
        ctgovAffiliations: [],
        ctgovNctIds: [],
      };
      byPerson.set(personId, entry);
    } else {
      if (displayNameQuality(row.displayName) > displayNameQuality(entry.name)) entry.name = row.displayName;
    }
    if (!entry.facilityIds.has(row.facilityId)) {
      entry.facilityIds.add(row.facilityId);
      entry.facilities.push({
        facilityId: row.facilityId,
        name: row.facilityName,
        city: row.city,
        uf: row.uf,
        cnes: row.confirmedCnes ?? row.unverifiedCnes,
        cnesStatus: row.confirmedCnes ? "confirmed" : row.unverifiedCnes ? "unverified" : "absent",
      });
    }
    uniqueLinks.add(`${personId}|${row.facilityId}`);
    researchFacilities.add(row.facilityId);
  }

  const confirmedEntries = [...byPerson.values()];
  const confirmedByName = new Map<string, typeof confirmedEntries>();
  for (const entry of confirmedEntries) {
    const key = personMatchKey(entry.name);
    const candidates = confirmedByName.get(key) ?? [];
    candidates.push(entry);
    confirmedByName.set(key, candidates);
  }
  const mergeCtgov = (entry: InvestigatorDirectoryEntry, profile: CtgovInvestigatorProfile) => {
    entry.sources = [...new Set([...entry.sources, "ClinicalTrials.gov" as const])];
    entry.ctgovRoles = [...new Set([...entry.ctgovRoles, ...profile.roles])].sort();
    entry.ctgovAffiliations = [...new Set([...entry.ctgovAffiliations, ...(profile.affiliation ? [profile.affiliation] : [])])].sort();
    entry.ctgovNctIds = [...new Set([...entry.ctgovNctIds, ...profile.nctIds])].sort();
    entry.ctgovTrialCount = entry.ctgovNctIds.length;
  };
  const standaloneCtgov: InvestigatorDirectoryEntry[] = [];
  const matchedCtgovPersonIds = new Set<string>();
  for (const profile of ctgovRoster?.investigators ?? []) {
    const candidates = confirmedByName.get(personMatchKey(profile.name)) ?? [];
    const matched = profile.affiliation ? candidates.filter((entry) => affiliationMatchesFacility(profile.affiliation!, entry.facilities)) : [];
    if (matched.length === 1) {
      mergeCtgov(matched[0], profile);
      matchedCtgovPersonIds.add(matched[0].personId);
      continue;
    }
    standaloneCtgov.push({
      personId: profile.profileId,
      name: profile.name,
      kind: "ctgov_investigator",
      facilities: [],
      ...enrichmentFields(undefined),
      sources: ["ClinicalTrials.gov"],
      ctgovTrialCount: profile.trialCount,
      ctgovRoles: profile.roles,
      ctgovAffiliations: profile.affiliation ? [profile.affiliation] : [],
      ctgovNctIds: profile.nctIds,
    });
  }

  const entries: InvestigatorDirectoryEntry[] = [
    ...confirmedEntries.map(({ facilityIds: _facilityIds, ...entry }) => entry),
    ...standaloneCtgov,
  ];
  const entriesByName = new Map<string, InvestigatorDirectoryEntry[]>();
  for (const entry of entries) {
    const key = personMatchKey(entry.name);
    const candidates = entriesByName.get(key) ?? [];
    candidates.push(entry);
    entriesByName.set(key, candidates);
  }
  const matchedEnrichmentKeys = new Set<string>();
  for (const [key, enrichment] of Object.entries(enrichments)) {
    if (enrichment.source !== "parallel") continue;
    const candidates = entriesByName.get(personMatchKey(enrichment.name)) ?? [];
    if (candidates.length === 1) {
      Object.assign(candidates[0], enrichmentFields(enrichment));
      candidates[0].sources = [...new Set([...candidates[0].sources, "Parallel" as const])];
      matchedEnrichmentKeys.add(key);
      continue;
    }
    entries.push({
      personId: `pers-parallel-${stableHash(key)}`,
      name: enrichment.name,
      kind: "parallel_candidate",
      facilities: [],
      ...enrichmentFields(enrichment),
      sources: ["Parallel"],
      ctgovTrialCount: 0,
      ctgovRoles: [],
      ctgovAffiliations: [],
      ctgovNctIds: [],
    });
  }

  entries.sort((a, b) => {
    const evidenceRank = (entry: InvestigatorDirectoryEntry) => entry.evidenceStatus === "public_evidence" ? 2 : entry.evidenceStatus === "researched_no_positive_signal" ? 1 : 0;
    const kindRank: Record<InvestigatorKind, number> = { confirmed_pi: 3, ctgov_investigator: 2, parallel_candidate: 1 };
    return evidenceRank(b) - evidenceRank(a) || kindRank[b.kind] - kindRank[a.kind] || b.ctgovTrialCount - a.ctgovTrialCount || a.name.localeCompare(b.name);
  });
  const parallelProfiles = Object.values(enrichments).filter((item) => item.source === "parallel").length;
  return {
    generatedAt,
    rosterAvailable,
    ctgovGeneratedAt: ctgovRoster?.generatedAt ?? null,
    ctgovComplete: ctgovRoster?.complete ?? false,
    entries,
    summary: {
      confirmedPis: byPerson.size,
      piFacilityLinks: uniqueLinks.size,
      researchFacilities: researchFacilities.size,
      parallelProfiles,
      matchedParallelProfiles: matchedEnrichmentKeys.size,
      standaloneParallelCandidates: parallelProfiles - matchedEnrichmentKeys.size,
      profilesWithPublicEvidence: entries.filter((entry) => entry.evidenceStatus === "public_evidence").length,
      ctgovInvestigatorProfiles: ctgovRoster?.summary.investigatorProfiles ?? 0,
      ctgovTrialLinks: (ctgovRoster?.investigators ?? []).reduce((total, profile) => total + profile.trialCount, 0),
      ctgovMatchedToConfirmedPis: matchedCtgovPersonIds.size,
    },
  };
}
