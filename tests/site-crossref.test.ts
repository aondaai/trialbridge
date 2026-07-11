import { describe, it, expect } from "vitest";
import { matchAffiliation, DirectorySite } from "@/lib/sites/directory";
import { crossReferenceInvestigators } from "@/lib/sites/crossref";
import type { KolInvestigatorInput } from "@/lib/kol/score";

function site(name: string, cnes: string | null, region: DirectorySite["region"]): DirectorySite {
  return {
    id: cnes ? `cnes-${cnes}` : `n-${name}`, name, cnes, cnpj: null, city: null, uf: null, region,
    therapeuticAreas: [], oncology: true, cepName: null,
    inspections: { anvisa: false, fda: false, ema: false, any: false },
    edcExperience: false, rbmExperience: false, centralLabExams: false, centralLabImaging: false,
    piCount: null, contactName: null, contactEmail: null, contactPhone: null, sources: ["abracro"],
  };
}

const DIR: DirectorySite[] = [
  site("FUNDACAO PIO XII BARRETOS", "2090236", "Sudeste"),
  site("Associação Hospitalar Moinhos de Vento", "3006522", "Sul"),
  site("AC Camargo Cancer Center", "2077531", "Sudeste"),
  site("Universidade de São Paulo", null, "Sudeste"),
];

describe("matchAffiliation — precision-biased token overlap", () => {
  it("matches distinctive institution names (Barretos, Moinhos, Camargo)", () => {
    expect(matchAffiliation("Barretos Cancer Hospital", DIR)?.cnes).toBe("2090236");
    expect(matchAffiliation("Hospital Moinhos de Vento", DIR)?.cnes).toBe("3006522");
    expect(matchAffiliation("AC Camargo Cancer Center", DIR)?.cnes).toBe("2077531");
  });
  it("does NOT false-match on generic place tokens (ICESP ≠ USP)", () => {
    expect(matchAffiliation("Instituto do Cancer do Estado de Sao Paulo", DIR)).toBeNull();
  });
  it("rejects foreign / unknown affiliations", () => {
    expect(matchAffiliation("University Hospital, Basel, Switzerland", DIR)).toBeNull();
    expect(matchAffiliation(null, DIR)).toBeNull();
    expect(matchAffiliation("", DIR)).toBeNull();
  });
});

describe("crossReferenceInvestigators", () => {
  const inv = (name: string, affiliation: string | null, region = "SE"): KolInvestigatorInput => ({
    name, regionCode: region, affiliation,
    signals: { trialsCount: 3, pubsCountTa: 0, societyRoles: [], guidelineAuthor: false, hasCnesLink: false },
  });

  it("links matched investigators: sets CNES, accurate region, and hasCnesLink", () => {
    const { investigators, stats } = crossReferenceInvestigators(
      [inv("Dr A", "Barretos Cancer Hospital", "NE"), inv("Dr B", "Nowhere Clinic")],
      DIR,
    );
    expect(stats).toEqual({ total: 2, linked: 1 });
    expect(investigators[0].cnes).toBe("2090236");
    expect(investigators[0].regionCode).toBe("Sudeste"); // corrected from "NE"
    expect(investigators[0].signals.hasCnesLink).toBe(true);
    // unmatched investigator is unchanged
    expect(investigators[1].cnes).toBeUndefined();
    expect(investigators[1].signals.hasCnesLink).toBe(false);
  });

  it("a linked investigator scores higher than the same one unlinked (institution signal)", async () => {
    const { kolScore } = await import("@/lib/kol/score");
    const base = kolScore(inv("Dr A", "Barretos Cancer Hospital"));
    const linked = crossReferenceInvestigators([inv("Dr A", "Barretos Cancer Hospital")], DIR).investigators[0];
    expect(kolScore(linked).composite0100).toBeGreaterThan(base.composite0100);
  });
});
