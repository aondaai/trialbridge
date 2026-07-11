import { describe, it, expect } from "vitest";
import { directorySiteToSiteInput, kolScoreByCnes } from "@/lib/sites/toSiteInput";
import { scoreSite } from "@/lib/scoring/site";
import { buildReport } from "@/lib/report/buildReport";
import { assertProvenanced } from "@/lib/metric";
import type { DirectorySite } from "@/lib/sites/directory";
import type { KolInvestigatorInput } from "@/lib/kol/score";
import type { Criterion } from "@/lib/matcher/types";

function dsite(over: Partial<DirectorySite> = {}): DirectorySite {
  return {
    id: "cnes-1", name: "Site", cnes: "1", cnpj: null, city: "X", uf: "SP", region: "Sudeste",
    therapeuticAreas: ["Oncologia"], oncology: true, cepName: "CEP-X",
    inspections: { anvisa: false, fda: false, ema: false, any: false },
    edcExperience: false, rbmExperience: false, centralLabExams: false, centralLabImaging: false,
    piCount: 2, contactName: null, contactEmail: null, contactPhone: null, sources: ["abracro"],
    ...over,
  };
}

const ctx = { profile: "onc_ph3" as const, competingByRegion: { Sudeste: 5 } };

describe("directorySiteToSiteInput", () => {
  it("uses real inspection experience for data quality and lab flags for infra", () => {
    const si = directorySiteToSiteInput(
      dsite({ inspections: { anvisa: true, fda: true, ema: false, any: true }, centralLabExams: true, centralLabImaging: true }),
      ctx,
    );
    expect(si.inspectionOk).toBe(true);
    expect(si.presentEquipment).toBe(3); // 2 labs + oncology (edcExperience is false here)
    expect(si.competingTrialsInCatchment).toBe(5); // from competingByRegion
    expect(si.hasPIHistory).toBe(true);
    expect(si.cepAccreditedForRisk).toBe(true);
  });

  it("attaches a KOL score by CNES when available", () => {
    const withKol = directorySiteToSiteInput(dsite({ cnes: "77" }), { ...ctx, kolByCnes: new Map([["77", 88]]) });
    expect(withKol.kolScore0100).toBe(88);
  });

  it("a well-inspected, lab-equipped site scores higher than a bare one", () => {
    const strong = scoreSite(directorySiteToSiteInput(
      dsite({ cnes: "a", inspections: { anvisa: true, fda: true, ema: true, any: true }, centralLabExams: true, centralLabImaging: true, edcExperience: true, piCount: 8 }),
      ctx,
    ));
    const bare = scoreSite(directorySiteToSiteInput(dsite({ cnes: "b", piCount: 1 }), ctx));
    expect(strong.composite).toBeGreaterThan(bare.composite);
  });
});

describe("kolScoreByCnes", () => {
  it("maps CNES → best KOL score", () => {
    const invs: KolInvestigatorInput[] = [
      { name: "A", regionCode: "SE", cnes: "1", signals: { trialsCount: 5, pubsCountTa: 20, societyRoles: ["SBOC"], guidelineAuthor: true, hasCnesLink: true } },
      { name: "B", regionCode: "SE", cnes: "1", signals: { trialsCount: 1, pubsCountTa: 0, societyRoles: [], guidelineAuthor: false, hasCnesLink: true } },
    ];
    const m = kolScoreByCnes(invs);
    expect(m.get("1")).toBeGreaterThan(50); // best of the two
  });
});

describe("buildReport with directorySites — real site rankings", () => {
  const consultation = { id: "r", title: "NSCLC", sponsorName: "Bio", nct: "NCT1", criteria: [] as Criterion[] };
  const dir: DirectorySite[] = [
    dsite({ id: "cnes-100", cnes: "100", name: "Strong Onc Center", inspections: { anvisa: true, fda: true, ema: true, any: true }, centralLabExams: true, centralLabImaging: true, edcExperience: true, piCount: 10 }),
    dsite({ id: "cnes-200", cnes: "200", name: "Bare Onc Center", piCount: 1 }),
    dsite({ id: "n-1", cnes: null, name: "Not Oncology", oncology: false }),
  ];

  it("ranks the oncology directory sites (skipping non-oncology), gate passes", () => {
    const report = buildReport(consultation, [], { directorySites: dir });
    expect(report.siteRankings.length).toBe(2); // only oncology sites
    expect(report.siteRankings[0].cnes).toBe("100"); // stronger site first
    expect(() => assertProvenanced(report)).not.toThrow();
  });

  it("respects maxRankedSites", () => {
    const report = buildReport(consultation, [], { directorySites: dir, maxRankedSites: 1 });
    expect(report.siteRankings.length).toBe(1);
  });
});
