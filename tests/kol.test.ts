import { describe, it, expect } from "vitest";
import {
  kolScore,
  rankKols,
  societyScore,
  regionKolDensity,
  sweetSpotRegions,
  buildKolMap,
  KolInvestigatorInput,
  KOL_SIGNAL_WEIGHTS,
} from "@/lib/kol/score";
import { assertProvenanced, isMetric, Confidence } from "@/lib/metric";

function inv(over: Partial<KolInvestigatorInput> = {}): KolInvestigatorInput {
  return {
    name: "Dr. A",
    regionCode: "SE",
    cnes: "2077469",
    therapeuticArea: "oncology",
    signals: { trialsCount: 6, pubsCountTa: 25, societyRoles: ["SBOC"], guidelineAuthor: true, hasCnesLink: true },
    ...over,
  };
}

describe("kolScore — weighted signals, provenance, confidence", () => {
  it("weights sum to 1.0", () => {
    const sum = Object.values(KOL_SIGNAL_WEIGHTS).reduce((s, v) => s + v, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it("a strong investigator (trials+pubs+society+CNES) scores high and is HIGH confidence", () => {
    const s = kolScore(inv());
    expect(s.composite0100).toBeGreaterThan(80);
    expect(s.confidence).toBe(Confidence.HIGH);
    for (const m of s.signalMetrics) expect(isMetric(m)).toBe(true);
  });

  it("a bare investigator (only a CNES link) is LOW confidence and low score", () => {
    const s = kolScore(inv({ signals: { trialsCount: 0, pubsCountTa: 0, societyRoles: [], guidelineAuthor: false, hasCnesLink: true } }));
    expect(s.confidence).toBe(Confidence.LOW); // only 1 source
    expect(s.composite0100).toBeLessThan(30);
  });

  it("society score adds curated points + a guideline-author bonus, capped at 100", () => {
    expect(societyScore(["SBOC"], false)).toBe(30);
    expect(societyScore(["SBOC"], true)).toBe(70);
    expect(societyScore(["SBOC", "SBCO", "SBRT"], true)).toBe(100); // 30+25+20+40 capped
    expect(societyScore(["unknown"], false)).toBe(0);
  });

  it("is deterministic and passes the provenance gate", () => {
    expect(kolScore(inv())).toEqual(kolScore(inv()));
    expect(() => assertProvenanced({ scoreMetric: kolScore(inv()).scoreMetric })).not.toThrow();
  });
});

describe("rankKols + density + sweet-spots", () => {
  it("ranks by score desc, tie-broken by confidence", () => {
    const strong = kolScore(inv({ name: "Strong" }));
    const weak = kolScore(inv({ name: "Weak", signals: { trialsCount: 1, pubsCountTa: 2, societyRoles: [], guidelineAuthor: false, hasCnesLink: false } }));
    expect(rankKols([weak, strong])[0].name).toBe("Strong");
  });

  it("region density aggregates count + mean score", () => {
    const d = regionKolDensity([kolScore(inv({ regionCode: "SE" })), kolScore(inv({ regionCode: "SE", name: "B" })), kolScore(inv({ regionCode: "NE" }))]);
    const se = d.find((x) => x.regionCode === "SE")!;
    expect(se.count).toBe(2);
    expect(isMetric(se.meanScoreMetric)).toBe(true);
  });

  it("tri-density surfaces a region that is BOTH KOL-strong and patient-rich", () => {
    const d = regionKolDensity([kolScore(inv({ regionCode: "NE" }))]); // strong → mean ~85
    const spots = sweetSpotRegions(d, { NE: 120, SE: 10 }, { minKolScore: 60, minRatio: 50 });
    expect(spots).toContain("NE");
    expect(spots).not.toContain("SE");
  });
});

describe("buildKolMap — report §7 shape", () => {
  it("produces ranked physicians with a provenanced score metric", () => {
    const map = buildKolMap([inv({ name: "Top" }), inv({ name: "Low", signals: { trialsCount: 0, pubsCountTa: 0, societyRoles: [], guidelineAuthor: false, hasCnesLink: true } })]);
    expect(map.physicians[0].name).toBe("Top");
    expect(() => assertProvenanced(map)).not.toThrow();
  });

  it("empty input → empty map", () => {
    expect(buildKolMap([]).physicians).toHaveLength(0);
  });
});
