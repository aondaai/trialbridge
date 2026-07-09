/**
 * ClinicalTrials.gov v2 API — types for the fields TrialBridge reads.
 *
 * Deliberately partial: CT.gov's real schema has dozens of optional modules
 * and we only read identification/status/sponsor/design/conditions/eligibility.
 * Everything is optional here and `normalize.ts` treats every field as
 * possibly absent — verified against a live NCT03529110 response, but the
 * public schema can add/rename fields without notice.
 */

export interface RawCtGovStudy {
  protocolSection?: {
    identificationModule?: {
      nctId?: string;
      briefTitle?: string;
      officialTitle?: string;
    };
    statusModule?: {
      overallStatus?: string;
    };
    sponsorCollaboratorsModule?: {
      leadSponsor?: { name?: string };
    };
    designModule?: {
      studyType?: string;
      phases?: string[];
    };
    conditionsModule?: {
      conditions?: string[];
    };
    eligibilityModule?: {
      eligibilityCriteria?: string;
      minimumAge?: string;
      maximumAge?: string;
      sex?: string;
      healthyVolunteers?: boolean;
    };
  };
}

/** The shape TrialBridge actually consumes downstream (parse UI, etc). */
export interface NormalizedProtocol {
  nctId: string;
  title: string;
  briefTitle: string;
  sponsor: string | null;
  phase: string[];
  status: string | null;
  conditions: string[];
  /** Raw eligibility text — "Inclusion Criteria:\n...\n\nExclusion Criteria:\n..." — feeds directly into parseCriteria(). */
  eligibilityCriteria: string;
  minimumAge: string | null;
  maximumAge: string | null;
  sex: string | null;
  sourceUrl: string;
}

export interface FetchProtocolResult {
  protocol: NormalizedProtocol;
  source: "live" | "cached";
  note: string;
}
