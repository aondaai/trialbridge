import { describe, expect, it } from "vitest";
import { Confidence } from "@/lib/metric";
import { buildInvestigatorDirectory, type InvestigatorRosterRow } from "@/lib/kol/directoryModel";
import type { InvestigatorEnrichment } from "@/lib/kol/enrich";
import { buildCtgovInvestigatorRoster, extractCtgovOfficials, type RawCtgovRosterStudy } from "@/lib/ctgov/investigatorRosterModel";

const rows: InvestigatorRosterRow[] = [
  {
    personId: "person-1",
    displayName: "Dra. Ana Silva",
    facilityId: "facility-1",
    facilityName: "Hospital A",
    city: "São Paulo",
    uf: "SP",
    confirmedCnes: "1234567",
    unverifiedCnes: null,
  },
  {
    personId: "person-1",
    displayName: "Dra. Ana Silva",
    facilityId: "facility-2",
    facilityName: "Hospital B",
    city: "Campinas",
    uf: "SP",
    confirmedCnes: null,
    unverifiedCnes: "7654321",
  },
];

function enrichment(name: string, pubs: number): InvestigatorEnrichment {
  return {
    name,
    source: "parallel",
    pubsCountTa: pubs,
    societyRoles: pubs ? ["SBOC"] : [],
    guidelineAuthor: false,
    confidence: Confidence.MEDIUM,
    citations: [{ label: "PubMed", url: "https://pubmed.ncbi.nlm.nih.gov/" }],
  };
}

describe("investigator directory", () => {
  it("keeps a confirmed roster PI and exact-name Parallel evidence on one profile", () => {
    const directory = buildInvestigatorDirectory(rows, { "dra. ana silva": enrichment("Dra. Ana Silva", 12) }, "2026-07-13T00:00:00Z");
    expect(directory.entries).toHaveLength(1);
    expect(directory.entries[0]).toMatchObject({
      name: "Dra. Ana Silva",
      kind: "confirmed_pi",
      evidenceStatus: "public_evidence",
      pubsCountTa: 12,
      sources: ["ABRACRO", "Parallel"],
    });
    expect(directory.entries[0].facilities.map((facility) => facility.cnesStatus)).toEqual(["confirmed", "unverified"]);
    expect(directory.summary).toMatchObject({ confirmedPis: 1, piFacilityLinks: 2, researchFacilities: 2, matchedParallelProfiles: 1 });
  });

  it("does not invent a facility link for a Parallel-only candidate", () => {
    const directory = buildInvestigatorDirectory(rows, { "dr. bruno costa": enrichment("Dr. Bruno Costa", 0) }, null);
    const candidate = directory.entries.find((entry) => entry.name === "Dr. Bruno Costa");
    expect(candidate).toMatchObject({ kind: "parallel_candidate", evidenceStatus: "researched_no_positive_signal", facilities: [] });
    expect(directory.summary).toMatchObject({ standaloneParallelCandidates: 1, matchedParallelProfiles: 0 });
  });

  it("deduplicates case and accent variants only when they share a facility", () => {
    const duplicateRows = [
      rows[0],
      { ...rows[0], personId: "person-2", displayName: "DRA. ANA SILVA" },
      { ...rows[0], personId: "person-3", displayName: "Dra Ana Silva", facilityId: "facility-3", facilityName: "Hospital C" },
    ];
    const directory = buildInvestigatorDirectory(duplicateRows, {}, null);
    expect(directory.summary.confirmedPis).toBe(2);
    expect(directory.entries.find((entry) => entry.personId !== "person-3")?.name).toBe("Dra. Ana Silva");
  });

  it("merges CT.gov only when name and affiliation support the ABRACRO facility link", () => {
    const ctgovStudies: RawCtgovRosterStudy[] = [{
      protocolSection: {
        identificationModule: { nctId: "NCT00000001", briefTitle: "Study A" },
        statusModule: { overallStatus: "RECRUITING" },
        contactsLocationsModule: { overallOfficials: [
          { name: "Dra. Ana Silva, MD", affiliation: "Hospital A", role: "PRINCIPAL_INVESTIGATOR" },
          { name: "Dr. Bruno Costa", affiliation: "Hospital C", role: "STUDY_CHAIR" },
        ] },
      },
    }];
    const ctgovRoster = buildCtgovInvestigatorRoster(extractCtgovOfficials(ctgovStudies), {
      generatedAt: "2026-07-13T00:00:00Z",
      query: "AREA[LocationCountry]Brazil",
      complete: true,
      studiesScanned: 1,
      totalStudies: 1,
    });
    const directory = buildInvestigatorDirectory(rows, {}, null, true, ctgovRoster);
    const ana = directory.entries.find((entry) => entry.kind === "confirmed_pi");
    const bruno = directory.entries.find((entry) => entry.name === "Dr. Bruno Costa");
    expect(ana).toMatchObject({ ctgovTrialCount: 1, sources: ["ABRACRO", "ClinicalTrials.gov"] });
    expect(bruno).toMatchObject({ kind: "ctgov_investigator", facilities: [], ctgovTrialCount: 1 });
    expect(directory.summary).toMatchObject({ ctgovInvestigatorProfiles: 2, ctgovMatchedToConfirmedPis: 1 });
  });
});
