import { describe, expect, it } from "vitest";
import { assertProvenanced, Provenance } from "@/lib/metric";
import { buildSiteRegistryLandscape } from "@/lib/site-feasibility/buildLandscape";
import { classifyTrialRelevance } from "@/lib/site-feasibility/relevance";
import { parseRegistryTrials } from "@/lib/site-feasibility/registry";
import { inferBiomarkers } from "@/lib/site-feasibility/query";
import { buildSitePrequalificationShortlist } from "@/lib/site-feasibility/shortlist";
import type { FacilityTrialRow, RegistryTrialProfile, SiteFeasibilityQuery } from "@/lib/site-feasibility/types";

const query: SiteFeasibilityQuery = {
  condition: "non-small cell lung cancer",
  title: "Phase III NSCLC KRAS G12C",
  targetNctId: "NCT00000001",
  phases: ["PHASE3"],
  biomarkers: ["KRAS G12C"],
};

function trial(overrides: Partial<RegistryTrialProfile> = {}): RegistryTrialProfile {
  return {
    nctId: "NCT00000002",
    title: "KRAS G12C NSCLC study",
    conditions: ["Non-Small Cell Lung Cancer"],
    phases: ["PHASE3"],
    status: "RECRUITING",
    interventions: ["Drug A"],
    ...overrides,
  };
}

describe("protocol-specific trial relevance", () => {
  it("normalizes NSCLC aliases and identifies a same-biomarker active candidate", () => {
    expect(classifyTrialRelevance(query, trial())).toMatchObject({
      category: "same_biomarker",
      indicationMatch: true,
      biomarkerMatch: true,
      phaseMatch: true,
      activeCandidateCompetitor: true,
      score: 90,
    });
  });

  it("does not call the target protocol its own competitor", () => {
    const result = classifyTrialRelevance(query, trial({ nctId: "NCT00000001" }));
    expect(result.category).toBe("same_biomarker");
    expect(result.activeCandidateCompetitor).toBe(false);
  });

  it("keeps unrelated studies out of the facility longlist", () => {
    const result = classifyTrialRelevance(query, trial({
      title: "Hypertension study",
      conditions: ["Hypertension"],
      phases: ["PHASE2"],
    }));
    expect(result.category).toBe("not_relevant");
    expect(result.score).toBe(0);
  });

  it("infers only explicit protocol biomarkers", () => {
    expect(inferBiomarkers("Phase III HER2-positive breast cancer with PD-L1"))
      .toEqual(["HER2", "PD-L1"]);
  });
});

describe("registry parser", () => {
  it("deduplicates NCTs and retains the fields used for local adjudication", () => {
    const studies = parseRegistryTrials([
      { protocolSection: {
        identificationModule: { nctId: "NCT12345678", officialTitle: "Study A" },
        conditionsModule: { conditions: ["NSCLC"] },
        designModule: { phases: ["PHASE2"] },
        statusModule: { overallStatus: "RECRUITING" },
        armsInterventionsModule: { interventions: [{ name: "Drug A" }] },
      } },
      { protocolSection: { identificationModule: { nctId: "NCT12345678" } } },
    ]);
    expect(studies).toHaveLength(1);
    expect(studies[0]).toMatchObject({ nctId: "NCT12345678" });
  });
});

describe("facility-master landscape", () => {
  it("links relevant NCTs to canonical facilities and surfaces metric provenance", async () => {
    const landscape = await buildSiteRegistryLandscape(query, {
      asOf: "2026-07-13",
      facilityRows: facilityRows(),
      registryUniverse: {
        source: "live",
        total: 3,
        truncated: false,
        trials: [
          trial({ nctId: "NCT00000001", status: "RECRUITING" }),
          trial({ nctId: "NCT00000002", status: "RECRUITING" }),
          trial({ nctId: "NCT00000003", title: "Historical NSCLC", status: "COMPLETED" }),
        ],
      },
    });

    expect(landscape.source).toBe("live");
    expect(landscape.sites).toHaveLength(2);
    expect(landscape.linkedFacilityCountMetric).toMatchObject({
      value: 2,
      provenance: Provenance.REGISTRY_GOV,
    });
    expect(landscape.sites[0]).toMatchObject({
      facilityId: "facility-a",
      cnes: "1234567",
      hasConfirmedPi: true,
      relevantTrialIds: ["NCT00000001", "NCT00000002"],
      activeCandidateCompetitorIds: ["NCT00000002"],
    });
    expect(landscape.sites[0].relevantTrialCountMetric.value).toBe(2);
    expect(landscape.sites[0].evidenceGaps).toContain("Site-level patient pool not available");
    expect(() => assertProvenanced({ siteRegistryLandscape: landscape })).not.toThrow();
  });

  it("withholds counts instead of returning zero when CT.gov is unavailable", async () => {
    const landscape = await buildSiteRegistryLandscape(query, {
      registryUniverse: { source: "unavailable", trials: [], total: null, truncated: false, note: "offline" },
    });
    expect(landscape.source).toBe("unavailable");
    expect(landscape.candidateTrialCountMetric.value).toBeNull();
    expect(landscape.linkedFacilityCountMetric.value).toBeNull();
  });
});

describe("prequalification shortlist", () => {
  it("combines registry evidence with UF supply without claiming a site patient pool", async () => {
    const landscape = await buildSiteRegistryLandscape(query, {
      asOf: "2026-07-13",
      facilityRows: facilityRows(),
      registryUniverse: {
        source: "live", total: 3, truncated: false,
        trials: [
          trial({ nctId: "NCT00000001" }),
          trial({ nctId: "NCT00000002" }),
          trial({ nctId: "NCT00000003", title: "Historical NSCLC", status: "COMPLETED" }),
        ],
      },
    });
    const shortlist = buildSitePrequalificationShortlist(landscape, [
      { uf: "SP", eligible: 500, asOf: "2026-07-13", sourceLabel: "DataSUS fixture" },
      { uf: "RJ", eligible: 100, asOf: "2026-07-13", sourceLabel: "DataSUS fixture" },
    ]);

    expect(shortlist.entries).toHaveLength(2);
    expect(shortlist.entries[0]).toMatchObject({ facilityId: "facility-a", status: "ready_for_review" });
    expect(shortlist.entries[0].regionalEligiblePoolMetric).toMatchObject({ value: 500, provenance: Provenance.MODELED });
    expect(shortlist.entries[0].priorityScoreMetric.note).toMatch(/Prequalification priority only/);
    expect(shortlist.limitations.join(" ")).toMatch(/not a prediction of site enrollment/i);
    expect(() => assertProvenanced({ sitePrequalification: shortlist })).not.toThrow();
  });

  it("does not turn missing regional supply into zero", async () => {
    const landscape = await buildSiteRegistryLandscape(query, {
      facilityRows: facilityRows(),
      registryUniverse: { source: "live", total: 1, truncated: false, trials: [trial()] },
    });
    const shortlist = buildSitePrequalificationShortlist(landscape, []);
    expect(shortlist.entries[0].regionalEligiblePoolMetric.value).toBeNull();
    expect(shortlist.entries[0].opportunityScoreMetric.value).toBeNull();
    expect(Number(shortlist.entries[0].priorityScoreMetric.value)).toBeLessThanOrEqual(50);
  });
});

function facilityRows(): FacilityTrialRow[] {
  const alpha = {
    facilityId: "facility-a",
    cnes: "1234567",
    name: "Alpha Cancer Center",
    registrySiteName: "Alpha Oncology Research Unit",
    city: "São Paulo",
    uf: "SP",
    activityStatus: "active" as const,
    totalTrialCount: 12,
    activeTrialCount: 4,
    hasConfirmedPi: true,
  };
  return [
    { ...alpha, nctId: "NCT00000001" },
    { ...alpha, nctId: "NCT00000002" },
    {
      facilityId: "facility-b",
      cnes: null,
      name: "Beta Hospital",
      registrySiteName: "Beta Hospital Research Center",
      city: "Rio de Janeiro",
      uf: "RJ",
      activityStatus: "active",
      totalTrialCount: 7,
      activeTrialCount: 1,
      hasConfirmedPi: false,
      nctId: "NCT00000003",
    },
  ];
}
