import { describe, it, expect } from "vitest";
import {
  norm,
  stateToRegion,
  parseCompetition,
  unavailableCompetition,
  buildCompetitionQueries,
  competitionLandscapeSummary,
  competitionCondition,
  competitionQueryUrl,
  RawStudyLite,
} from "@/lib/ctgov/competition";

describe("state → macro-region mapping (accent-insensitive)", () => {
  it("maps accented and unaccented Brazilian state names", () => {
    expect(stateToRegion("São Paulo")).toBe("Sudeste");
    expect(stateToRegion("Sao Paulo")).toBe("Sudeste");
    expect(stateToRegion("Rio Grande do Sul")).toBe("Sul");
    expect(stateToRegion("Paraná")).toBe("Sul");
    expect(stateToRegion("Pernambuco")).toBe("Nordeste");
    expect(stateToRegion("Distrito Federal")).toBe("Centro-Oeste");
    expect(stateToRegion("Pará")).toBe("Norte");
  });
  it("returns null for a non-Brazilian / unknown state", () => {
    expect(stateToRegion("California")).toBeNull();
    expect(stateToRegion(null)).toBeNull();
    expect(stateToRegion("")).toBeNull();
  });
  it("norm strips diacritics", () => {
    expect(norm("São Paulo")).toBe("sao paulo");
  });
});

const studies: RawStudyLite[] = [
  {
    protocolSection: {
      identificationModule: { nctId: "NCT1" },
      contactsLocationsModule: {
        locations: [
          { country: "Brazil", state: "São Paulo" },
          { country: "Brazil", state: "Paraná" },
          { country: "United States", state: "California" }, // ignored (not BR)
        ],
        overallOfficials: [{ name: "Dr. Silva", role: "PRINCIPAL_INVESTIGATOR", affiliation: "ICESP" }],
      },
    },
  },
  {
    protocolSection: {
      identificationModule: { nctId: "NCT2" },
      contactsLocationsModule: {
        locations: [{ country: "Brazil", state: "São Paulo" }],
        overallOfficials: [
          { name: "Dr. Silva", role: "PRINCIPAL_INVESTIGATOR", affiliation: "ICESP" },
          { name: "Dr. Costa", role: "STUDY_CHAIR" },
          { name: "Clinical Trials", role: "STUDY_DIRECTOR" }, // generic sponsor contact → dropped
        ],
      },
    },
  },
];

describe("parseCompetition — per-region counts + investigator aggregation", () => {
  it("counts a study toward each BR macro-region it has a site in; ignores non-BR locations", () => {
    const c = parseCompetition(studies, 2);
    expect(c.source).toBe("live");
    expect(c.total).toBe(2);
    expect(c.byRegion.Sudeste).toBe(2); // both studies have SP
    expect(c.byRegion.Sul).toBe(1); // only NCT1 has Paraná
    expect(c.byRegion.Norte).toBeUndefined();
  });

  it("keeps only PI/chair investigators (drops generic STUDY_DIRECTOR), aggregates + sorts", () => {
    const c = parseCompetition(studies, 2);
    const silva = c.investigators.find((i) => i.name === "Dr. Silva")!;
    expect(silva.trialsCount).toBe(2);
    expect(silva.affiliation).toBe("ICESP");
    expect(c.investigators[0].name).toBe("Dr. Silva"); // most trials first
    expect(silva.regionCode).toBe("Sudeste");
    // the generic sponsor contact is filtered out
    expect(c.investigators.find((i) => i.name === "Clinical Trials")).toBeUndefined();
    expect(c.investigators.map((i) => i.name).sort()).toEqual(["Dr. Costa", "Dr. Silva"]);
  });

  it("empty studies → empty, source still 'live'", () => {
    const c = parseCompetition([], 0);
    expect(c.total).toBe(0);
    expect(Object.keys(c.byRegion)).toHaveLength(0);
    expect(c.investigators).toHaveLength(0);
  });
});

describe("graceful degradation", () => {
  it("unavailableCompetition carries source 'unavailable' + a note and zero counts", () => {
    const u = unavailableCompetition("timeout");
    expect(u.source).toBe("unavailable");
    expect(u.total).toBe(0);
    expect(u.note).toBe("timeout");
    expect(u.investigators).toHaveLength(0);
  });
});

describe("report-grade competition landscape", () => {
  it("uses the reviewed diagnosis instead of sending a long protocol title", () => {
    const title = "A Prospective Phase 3, Randomized, Double-blind Study Evaluating Rentosertib Over 52 Weeks in Patients With Idiopathic Pulmonary Fibrosis (IPF)";
    expect(competitionCondition(title, [
      { field: "diagnosis", value: "idiopathic pulmonary fibrosis" },
    ])).toBe("idiopathic pulmonary fibrosis");
    expect(competitionCondition(title)).toBe("idiopathic pulmonary fibrosis");
  });

  it("builds broad, indication-adjacent and intervention cuts for the T-DXd hero protocol", () => {
    const queries = buildCompetitionQueries(
      "breast cancer",
      "Phase III — T-DXd in HER2+ metastatic breast cancer (2nd line)",
    );
    expect(queries.map((query) => query.key)).toEqual(["broad", "indication", "intervention"]);
    expect(queries[1].condition).toBe("HER2-positive metastatic breast cancer");
    expect(queries[2].term).toBe('"trastuzumab deruxtecan"');
    expect(decodeURIComponent(competitionQueryUrl(queries[2]))).toContain("query.term=\"trastuzumab+deruxtecan\"");
  });

  it("states that narrower registry counts are not validated direct competitors", () => {
    const summary = competitionLandscapeSummary({
      schemaVersion: "competition-landscape.v1",
      source: "live",
      assessment: "pending_adjudication",
      directCompetitors: null,
      broad: parseCompetition([], 57),
      cuts: [
        { key: "broad", label: "Broad", total: 57, url: "https://example.test/broad" },
        { key: "indication", label: "Indication", total: 13, url: "https://example.test/indication" },
        { key: "intervention", label: "Intervention", total: 3, url: "https://example.test/intervention" },
      ],
      limitations: [],
    });
    expect(summary).toContain("Assessment pending adjudication");
    expect(summary).toContain("57 recruiting studies");
    expect(summary).toContain("13 indication-adjacent");
    expect(summary).toContain("3 mentioning T-DXd");
    expect(summary).toContain("direct competitors remain unvalidated");
  });
});
