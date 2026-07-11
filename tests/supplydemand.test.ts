import { describe, it, expect } from "vitest";
import {
  computeSupplyDemand,
  toSupplyDemandSummary,
  RegionSDInput,
} from "@/lib/supplydemand/ratios";
import { assertProvenanced, isMetric, Provenance } from "@/lib/metric";

const regions: RegionSDInput[] = [
  { regionCode: "SE", regionName: "Sudeste", eligiblePool: 3000, competingTrials: 30, population: 89_000_000 },
  { regionCode: "NE", regionName: "Nordeste", eligiblePool: 1200, competingTrials: 4, population: 57_000_000 },
  { regionCode: "N", regionName: "Norte", eligiblePool: 300, competingTrials: 0, population: 18_000_000 },
];

describe("computeSupplyDemand — ratios + under-penetration", () => {
  it("ratio = eligible pool per competing trial; zero trials floors the denominator at 1", () => {
    const r = computeSupplyDemand(regions);
    const se = r.regions.find((x) => x.regionCode === "SE")!;
    const n = r.regions.find((x) => x.regionCode === "N")!;
    expect(se.ratioMetric.value).toBe(100); // 3000/30
    expect(n.ratioMetric.value).toBe(300); // 300 / max(1,0)
    expect(Number.isFinite(n.ratioMetric.value as number)).toBe(true);
  });

  it("flags a patient-rich, under-penetrated region as an opportunity", () => {
    const r = computeSupplyDemand(regions);
    const ne = r.regions.find((x) => x.regionCode === "NE")!;
    expect(ne.isOpportunity).toBe(true); // 300 ratio, tiny trials/million
    expect(r.opportunities[0].ratioMetric.value).toBeGreaterThanOrEqual(
      r.opportunities[r.opportunities.length - 1].ratioMetric.value as number,
    );
  });

  it("under-penetration is the gap below the benchmark and never negative", () => {
    const r = computeSupplyDemand(regions, { benchmarkTrialsPerMillion: 100 });
    for (const reg of r.regions) {
      expect(reg.underPenetrationMetric.value as number).toBeGreaterThanOrEqual(0);
    }
  });

  it("every metric carries provenance; the result passes the gate", () => {
    const r = computeSupplyDemand(regions);
    for (const reg of r.regions) {
      expect(isMetric(reg.ratioMetric)).toBe(true);
      expect(isMetric(reg.eligiblePoolMetric)).toBe(true);
    }
    expect(() => assertProvenanced({ supplyDemandMetrics: r.regions.map((x) => x.ratioMetric) })).not.toThrow();
  });

  it("competing-trials provenance is honest: modeled placeholder by default, registry when declared", () => {
    const dflt = computeSupplyDemand([regions[0]]);
    expect(dflt.regions[0].competingTrialsMetric.provenance).toBe(Provenance.MODELED);
    const wired = computeSupplyDemand([{ ...regions[0], competingTrialsProvenance: "registry" }]);
    expect(wired.regions[0].competingTrialsMetric.provenance).toBe(Provenance.REGISTRY_GOV);
  });

  it("national trials-per-million is finite even with zero population", () => {
    const r = computeSupplyDemand([{ regionCode: "X", eligiblePool: 0, competingTrials: 0, population: 0 }]);
    expect(Number.isFinite(r.nationalTrialsPerMillionMetric.value as number)).toBe(true);
  });

  it("toSupplyDemandSummary projects to the report §4 shape", () => {
    const r = computeSupplyDemand(regions);
    const s = toSupplyDemandSummary(r);
    expect(s.regions).toHaveLength(3);
    expect(s.regions[0]).toHaveProperty("ratioMetric");
    expect(() => assertProvenanced(s)).not.toThrow();
  });

  it("empty input → no regions, no crash", () => {
    const r = computeSupplyDemand([]);
    expect(r.regions).toHaveLength(0);
    expect(r.opportunities).toHaveLength(0);
  });
});
