import type { Metric } from "@/lib/metric";

export interface SiteFeasibilityQuery {
  condition: string;
  title?: string;
  targetNctId?: string | null;
  phases?: string[];
  biomarkers?: string[];
  interventionTerms?: string[];
}

export interface RegistryTrialProfile {
  nctId: string;
  title: string;
  conditions: string[];
  phases: string[];
  status: string | null;
  interventions: string[];
}

export type TrialRelevanceCategory =
  | "same_biomarker"
  | "same_indication"
  | "adjacent"
  | "not_relevant";

export interface TrialRelevance {
  nctId: string;
  category: TrialRelevanceCategory;
  indicationMatch: boolean;
  biomarkerMatch: boolean;
  phaseMatch: boolean;
  interventionMatch: boolean;
  activeCandidateCompetitor: boolean;
  score: number;
}

export interface FacilityTrialRow {
  facilityId: string;
  cnes: string | null;
  /** Canonical/master display name. */
  name: string;
  /** Exact site label carried by this trial-location source record. */
  registrySiteName: string;
  city: string | null;
  uf: string | null;
  activityStatus: "active" | "dormant" | "unverified";
  totalTrialCount: number;
  activeTrialCount: number;
  hasConfirmedPi: boolean;
  nctId: string;
}

export interface SiteRegistryLonglistEntry {
  facilityId: string;
  cnes: string | null;
  /** Most frequently observed site label among the relevant registry links. */
  name: string;
  officialName: string;
  registryAliases: string[];
  city: string | null;
  uf: string | null;
  activityStatus: "active" | "dormant" | "unverified";
  hasConfirmedPi: boolean;
  relevantTrialIds: string[];
  sameBiomarkerTrialIds: string[];
  activeCandidateCompetitorIds: string[];
  totalTrialCountMetric: Metric<number>;
  relevantTrialCountMetric: Metric<number>;
  sameBiomarkerTrialCountMetric: Metric<number>;
  activeCandidateCompetitorCountMetric: Metric<number>;
  evidenceCoverageMetric: Metric<number>;
  evidenceGaps: string[];
}

export interface SiteRegistryLandscape {
  schemaVersion: "site-registry-landscape.v1";
  query: SiteFeasibilityQuery;
  source: "live" | "unavailable";
  asOf: string | null;
  candidateTrialCountMetric: Metric<number | null>;
  linkedFacilityCountMetric: Metric<number | null>;
  sites: SiteRegistryLonglistEntry[];
  limitations: string[];
  note?: string;
}

export interface RegionalSupplyInput {
  uf: string;
  eligible: number;
  asOf?: string | null;
  sourceLabel: string;
  sourceVersion?: string | null;
}

export interface SitePrequalificationEntry {
  facilityId: string;
  cnes: string | null;
  name: string;
  city: string | null;
  uf: string | null;
  status: "ready_for_review" | "identity_review" | "regional_supply_missing";
  experienceScoreMetric: Metric<number>;
  regionalEligiblePoolMetric: Metric<number | null>;
  regionalCompetitionMetric: Metric<number | null>;
  opportunityScoreMetric: Metric<number | null>;
  identityScoreMetric: Metric<number>;
  priorityScoreMetric: Metric<number>;
  evidenceGaps: string[];
}

export interface SitePrequalificationShortlist {
  schemaVersion: "site-prequalification-shortlist.v1";
  asOf: string | null;
  entries: SitePrequalificationEntry[];
  methodology: string[];
  limitations: string[];
}
