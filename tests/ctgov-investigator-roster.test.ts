import { describe, expect, it } from "vitest";
import {
  buildCtgovInvestigatorRoster,
  extractCtgovOfficials,
  type RawCtgovRosterStudy,
} from "@/lib/ctgov/investigatorRosterModel";

const studies: RawCtgovRosterStudy[] = [
  {
    protocolSection: {
      identificationModule: { nctId: "NCT00000001", briefTitle: "Study A" },
      statusModule: { overallStatus: "RECRUITING" },
      conditionsModule: { conditions: ["Breast Cancer"] },
      contactsLocationsModule: { overallOfficials: [
        { name: "Dra. Ana Silva", affiliation: "Hospital A", role: "PRINCIPAL_INVESTIGATOR" },
        { name: "Sponsor Medical Director", affiliation: "Sponsor", role: "STUDY_DIRECTOR" },
      ] },
    },
  },
  {
    protocolSection: {
      identificationModule: { nctId: "NCT00000002", briefTitle: "Study B" },
      statusModule: { overallStatus: "COMPLETED" },
      conditionsModule: { conditions: ["Lung Cancer"] },
      contactsLocationsModule: { overallOfficials: [
        { name: "Dra. Ana Silva", affiliation: "Hospital A", role: "STUDY_CHAIR" },
        { name: "Dra. Ana Silva", affiliation: "Hospital B", role: "PRINCIPAL_INVESTIGATOR" },
      ] },
    },
  },
];

describe("CT.gov Brazil investigator roster", () => {
  it("preserves every named overall official and its trial provenance", () => {
    const officials = extractCtgovOfficials(studies);
    expect(officials).toHaveLength(4);
    expect(officials).toContainEqual(expect.objectContaining({
      nctId: "NCT00000001",
      name: "Sponsor Medical Director",
      role: "STUDY_DIRECTOR",
      sourceUrl: "https://clinicaltrials.gov/study/NCT00000001",
    }));
  });

  it("materializes only PI/chair profiles and keeps different affiliations separate", () => {
    const roster = buildCtgovInvestigatorRoster(extractCtgovOfficials(studies), {
      generatedAt: "2026-07-13T00:00:00Z",
      query: "AREA[LocationCountry]Brazil",
      complete: true,
      studiesScanned: 2,
      totalStudies: 2,
    });
    expect(roster.investigators).toHaveLength(2);
    expect(roster.investigators.find((profile) => profile.affiliation === "Hospital A")).toMatchObject({
      trialCount: 2,
      roles: ["PRINCIPAL_INVESTIGATOR", "STUDY_CHAIR"],
      nctIds: ["NCT00000001", "NCT00000002"],
    });
    expect(roster.summary).toMatchObject({ officialOccurrences: 4, investigatorOccurrences: 3, investigatorProfiles: 2 });
    expect(roster.summary.roleCounts.STUDY_DIRECTOR).toBe(1);
  });
});
