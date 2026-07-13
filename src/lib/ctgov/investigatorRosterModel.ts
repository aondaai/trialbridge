import { stableHash } from "@/lib/facilities/master";

export const CTGOV_INVESTIGATOR_ROLES = new Set(["PRINCIPAL_INVESTIGATOR", "STUDY_CHAIR"]);

export interface RawCtgovRosterStudy {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string };
    statusModule?: { overallStatus?: string };
    conditionsModule?: { conditions?: string[] };
    contactsLocationsModule?: {
      overallOfficials?: Array<{ name?: string; affiliation?: string; role?: string }>;
    };
  };
}

export interface CtgovOfficialOccurrence {
  nctId: string;
  briefTitle: string | null;
  overallStatus: string | null;
  conditions: string[];
  name: string;
  normalizedName: string;
  affiliation: string | null;
  normalizedAffiliation: string;
  role: string;
  sourceUrl: string;
}

export interface CtgovInvestigatorProfile {
  profileId: string;
  name: string;
  normalizedName: string;
  affiliation: string | null;
  normalizedAffiliation: string;
  roles: string[];
  nctIds: string[];
  trialCount: number;
  overallStatuses: string[];
  conditions: string[];
  sourceUrls: string[];
}

export interface CtgovInvestigatorRoster {
  schemaVersion: "ctgov-investigator-roster.v1";
  generatedAt: string;
  apiVersion: string | null;
  dataTimestamp: string | null;
  query: string;
  complete: boolean;
  studiesScanned: number;
  totalStudies: number;
  summary: {
    studiesWithNamedOfficials: number;
    officialOccurrences: number;
    uniqueOfficialNames: number;
    investigatorOccurrences: number;
    investigatorProfiles: number;
    roleCounts: Record<string, number>;
  };
  officials: CtgovOfficialOccurrence[];
  investigators: CtgovInvestigatorProfile[];
}

export function normalizeCtgovText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function extractCtgovOfficials(studies: RawCtgovRosterStudy[]): CtgovOfficialOccurrence[] {
  const occurrences = new Map<string, CtgovOfficialOccurrence>();
  for (const study of studies) {
    const protocol = study.protocolSection;
    const nctId = protocol?.identificationModule?.nctId?.trim().toUpperCase();
    if (!nctId) continue;
    for (const official of protocol?.contactsLocationsModule?.overallOfficials ?? []) {
      const name = official.name?.trim();
      if (!name) continue;
      const affiliation = official.affiliation?.trim() || null;
      const role = official.role?.trim() || "UNSPECIFIED";
      const normalizedName = normalizeCtgovText(name);
      const normalizedAffiliation = normalizeCtgovText(affiliation ?? "");
      const key = `${nctId}|${normalizedName}|${normalizedAffiliation}|${role}`;
      occurrences.set(key, {
        nctId,
        briefTitle: protocol?.identificationModule?.briefTitle?.trim() || null,
        overallStatus: protocol?.statusModule?.overallStatus?.trim() || null,
        conditions: [...new Set((protocol?.conditionsModule?.conditions ?? []).map((value) => value.trim()).filter(Boolean))],
        name,
        normalizedName,
        affiliation,
        normalizedAffiliation,
        role,
        sourceUrl: `https://clinicaltrials.gov/study/${nctId}`,
      });
    }
  }
  return [...occurrences.values()];
}

export function buildCtgovInvestigatorProfiles(officials: CtgovOfficialOccurrence[]): CtgovInvestigatorProfile[] {
  const profiles = new Map<string, {
    name: string;
    normalizedName: string;
    affiliation: string | null;
    normalizedAffiliation: string;
    roles: Set<string>;
    nctIds: Set<string>;
    statuses: Set<string>;
    conditions: Set<string>;
    sourceUrls: Set<string>;
  }>();
  for (const official of officials) {
    if (!CTGOV_INVESTIGATOR_ROLES.has(official.role)) continue;
    const key = `${official.normalizedName}|${official.normalizedAffiliation}`;
    const profile = profiles.get(key) ?? {
      name: official.name,
      normalizedName: official.normalizedName,
      affiliation: official.affiliation,
      normalizedAffiliation: official.normalizedAffiliation,
      roles: new Set<string>(),
      nctIds: new Set<string>(),
      statuses: new Set<string>(),
      conditions: new Set<string>(),
      sourceUrls: new Set<string>(),
    };
    profile.roles.add(official.role);
    profile.nctIds.add(official.nctId);
    if (official.overallStatus) profile.statuses.add(official.overallStatus);
    for (const condition of official.conditions) profile.conditions.add(condition);
    profile.sourceUrls.add(official.sourceUrl);
    profiles.set(key, profile);
  }
  return [...profiles.entries()].map(([key, profile]) => ({
    profileId: `ctgov-${stableHash(key)}`,
    name: profile.name,
    normalizedName: profile.normalizedName,
    affiliation: profile.affiliation,
    normalizedAffiliation: profile.normalizedAffiliation,
    roles: [...profile.roles].sort(),
    nctIds: [...profile.nctIds].sort(),
    trialCount: profile.nctIds.size,
    overallStatuses: [...profile.statuses].sort(),
    conditions: [...profile.conditions].sort(),
    sourceUrls: [...profile.sourceUrls].sort(),
  })).sort((a, b) => b.trialCount - a.trialCount || a.name.localeCompare(b.name));
}

export function buildCtgovInvestigatorRoster(
  officials: CtgovOfficialOccurrence[],
  metadata: {
    generatedAt: string;
    apiVersion?: string | null;
    dataTimestamp?: string | null;
    query: string;
    complete: boolean;
    studiesScanned: number;
    totalStudies: number;
  },
): CtgovInvestigatorRoster {
  const roleCounts: Record<string, number> = {};
  for (const official of officials) roleCounts[official.role] = (roleCounts[official.role] ?? 0) + 1;
  const investigators = buildCtgovInvestigatorProfiles(officials);
  return {
    schemaVersion: "ctgov-investigator-roster.v1",
    generatedAt: metadata.generatedAt,
    apiVersion: metadata.apiVersion ?? null,
    dataTimestamp: metadata.dataTimestamp ?? null,
    query: metadata.query,
    complete: metadata.complete,
    studiesScanned: metadata.studiesScanned,
    totalStudies: metadata.totalStudies,
    summary: {
      studiesWithNamedOfficials: new Set(officials.map((official) => official.nctId)).size,
      officialOccurrences: officials.length,
      uniqueOfficialNames: new Set(officials.map((official) => official.normalizedName)).size,
      investigatorOccurrences: officials.filter((official) => CTGOV_INVESTIGATOR_ROLES.has(official.role)).length,
      investigatorProfiles: investigators.length,
      roleCounts,
    },
    officials: [...officials].sort((a, b) => a.nctId.localeCompare(b.nctId) || a.name.localeCompare(b.name)),
    investigators,
  };
}
