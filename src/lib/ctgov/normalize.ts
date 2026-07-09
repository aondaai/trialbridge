import type { RawCtGovStudy, NormalizedProtocol } from "./types";

/** Reshape a raw CT.gov v2 study payload into the fields TrialBridge uses. */
export function normalizeStudy(raw: RawCtGovStudy): NormalizedProtocol {
  const p = raw.protocolSection ?? {};
  const ident = p.identificationModule ?? {};
  const elig = p.eligibilityModule ?? {};
  const design = p.designModule ?? {};

  const nctId = ident.nctId ?? "";
  if (!nctId) {
    throw new Error("ClinicalTrials.gov response is missing identificationModule.nctId");
  }

  return {
    nctId,
    title: ident.officialTitle ?? ident.briefTitle ?? "",
    briefTitle: ident.briefTitle ?? ident.officialTitle ?? "",
    sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name ?? null,
    phase: design.phases ?? [],
    status: p.statusModule?.overallStatus ?? null,
    conditions: p.conditionsModule?.conditions ?? [],
    eligibilityCriteria: elig.eligibilityCriteria ?? "",
    minimumAge: elig.minimumAge ?? null,
    maximumAge: elig.maximumAge ?? null,
    sex: elig.sex ?? null,
    sourceUrl: `https://clinicaltrials.gov/study/${nctId}`,
  };
}
