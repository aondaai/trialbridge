import { describe, it, expect } from "vitest";
import { buildReport, ConsultationLike } from "@/lib/report/buildReport";
import type { EvaluatedSite } from "@/lib/service";
import { assertProvenanced } from "@/lib/metric";
import type { Criterion } from "@/lib/matcher/types";

const criteria: Criterion[] = [
  { id: "c1", kind: "inclusion", field: "age", operator: "gte", value: 18, rawText: "Age >= 18", confidence: 0.9 },
  { id: "c2", kind: "exclusion", field: "brain_mets", operator: "exists", value: null, rawText: "No brain mets", confidence: 0.8 },
];

const consultation: ConsultationLike = {
  id: "run_test",
  title: "Test NSCLC protocol",
  sponsorName: "DemoBio",
  nct: "NCT00000000",
  criteria,
};

function site(id: string, definite: number, possible: number, region = "Sudeste"): EvaluatedSite {
  return {
    meta: { id, name: `Site ${id}`, country: "BR", city: "São Paulo", region, persona: "x", monthlyIncidence: 8 },
    patients: [],
    evals: [],
    counts: { definite, possible, excluded: 10, total: definite + possible + 10 },
  };
}

describe("buildReport — resolver bridges existing data to the engine", () => {
  it("assembles a gate-passing report from evaluated sites", () => {
    const report = buildReport(consultation, [site("a", 40, 20), site("b", 10, 5)]);
    expect(() => assertProvenanced(report)).not.toThrow();
    expect(report.country.dimensions).toHaveLength(7);
    expect(report.siteRankings).toHaveLength(2);
    // The bigger-pool site ranks first.
    expect(report.siteRankings[0].cnes).toBe("a");
    expect(report.context.protocolTitle).toBe("Test NSCLC protocol");
  });

  it("handles zero sites without throwing (country still renders from constants)", () => {
    const report = buildReport(consultation, []);
    expect(() => assertProvenanced(report)).not.toThrow();
    expect(report.siteRankings).toHaveLength(0);
    expect(report.decisionSnapshot.topSites).toHaveLength(0);
    // With no pool the recommendation is honest (no_go on insufficient supply).
    expect(report.country.recommendation).toBe("no_go");
  });

  it("public-data-only sites roll up to LOW confidence (honest)", () => {
    const report = buildReport(consultation, [site("a", 40, 20)]);
    expect(report.siteRankings[0].confidence).toBe("low");
  });

  it("is deterministic", () => {
    const a = buildReport(consultation, [site("a", 40, 20)]);
    const b = buildReport(consultation, [site("a", 40, 20)]);
    expect(a).toEqual(b);
  });

  it("months=0 is clamped so ppm never becomes Infinity (review #5)", () => {
    const report = buildReport(consultation, [site("a", 40, 20)], { months: 0 });
    const ppm = report.funnel.projectedPatientsPerMonthMetric.value as number;
    expect(Number.isFinite(ppm)).toBe(true);
  });
});
