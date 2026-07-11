import { describe, it, expect } from "vitest";
import {
  macroRegionPools,
  nationalPoolMetric,
  allocateSitePools,
  datasusSourceRef,
} from "@/lib/estimator/pools";
import type { NationalEstimate } from "@/lib/estimator/client";
import type { DirectorySite } from "@/lib/sites/directory";
import { ufToRegion } from "@/lib/sites/directory";
import { buildReport, ConsultationLike } from "@/lib/report/buildReport";
import type { EvaluatedSite } from "@/lib/service";
import { assertProvenanced, Provenance, Confidence } from "@/lib/metric";
import type { Criterion } from "@/lib/matcher/types";

// ── Fixtures ─────────────────────────────────────────────────────────────────────

/** Shaped like the live estimator response for HER2-MBC-REAL (scaled down). */
function estimate(overrides: Partial<NationalEstimate> = {}): NationalEstimate {
  return {
    protocolId: "HER2-MBC-REAL",
    estimatedN: 4587.7,
    ciLo: 4048.3,
    ciHi: 5127.2,
    baseCohort: 380_517,
    byRegion: [
      { region: "SP", estimatedN: 1107.7, ciLo: 712.5, ciHi: 1502.9, baseCohort: 92_557, monthlyEligible: 28.7 },
      { region: "MG", estimatedN: 721.1, ciLo: 463.9, ciHi: 978.3, baseCohort: 59_903, monthlyEligible: 17.4 },
      { region: "RJ", estimatedN: 347.4, ciLo: 222.2, ciHi: 472.5, baseCohort: 29_226, monthlyEligible: 9.8 },
      { region: "BA", estimatedN: 289.3, ciLo: 185.4, ciHi: 393.2, baseCohort: 23_764, monthlyEligible: null },
      { region: "RS", estimatedN: 322.8, ciLo: 207.4, ciHi: 438.3, baseCohort: 27_089, monthlyEligible: 8.1 },
    ],
    monthsToFill: 0.41,
    observedTotal: 29,
    sitesWithData: 3,
    dataSource: "DataSUS OMOP (omop_full)",
    asOf: "2026-07-09",
    bottlenecks: [
      { criterionId: "inc_met", text: "Metastatic (stage IV) disease", gain: 75_896.4 },
      { criterionId: "inc_ecog", text: "ECOG performance status 0-1", gain: 3163.2 },
      { criterionId: "exc_autoimmune", text: "No active autoimmune disease", gain: 0 },
    ],
    ...overrides,
  };
}

function directorySite(
  id: string,
  uf: string,
  piCount: number | null,
  extra: Partial<DirectorySite> = {},
): DirectorySite {
  return {
    id,
    name: `Site ${id}`,
    cnes: id,
    cnpj: null,
    city: "Cidade",
    uf,
    region: ufToRegion(uf),
    therapeuticAreas: ["Oncologia"],
    oncology: true,
    cepName: "CEP local",
    inspections: { anvisa: true, fda: false, ema: false, any: true },
    edcExperience: true,
    rbmExperience: false,
    centralLabExams: true,
    centralLabImaging: true,
    piCount,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    sources: ["abracro"],
    ...extra,
  };
}

const criteria: Criterion[] = [
  { id: "c1", kind: "inclusion", field: "age", operator: "gte", value: 18, rawText: "Age >= 18", confidence: 0.9 },
  { id: "c2", kind: "exclusion", field: "brain_mets", operator: "exists", value: null, rawText: "No brain mets", confidence: 0.8 },
];
const consultation: ConsultationLike = {
  id: "run_test",
  title: "Test HER2+ MBC protocol",
  sponsorName: "DemoBio",
  nct: "NCT00000000",
  criteria,
};

function evaluatedSite(id: string, definite: number, possible: number): EvaluatedSite {
  return {
    meta: { id, name: `Site ${id}`, country: "BR", city: "São Paulo", region: "Sudeste", persona: "x", monthlyIncidence: 8 },
    patients: [],
    evals: [],
    counts: { definite, possible, excluded: 10, total: definite + possible + 10 },
  };
}

// ── macroRegionPools ─────────────────────────────────────────────────────────────

describe("macroRegionPools — UF estimates roll up to the 5 macro-regions", () => {
  it("sums UF estimates and base cohorts into their macro-region", () => {
    const pools = macroRegionPools(estimate());
    const sudeste = pools.find((p) => p.region === "Sudeste")!;
    expect(sudeste.eligible).toBeCloseTo(1107.7 + 721.1 + 347.4, 5);
    expect(sudeste.baseCohort).toBe(92_557 + 59_903 + 29_226);
    const nordeste = pools.find((p) => p.region === "Nordeste")!;
    expect(nordeste.eligible).toBeCloseTo(289.3, 5);
    const sul = pools.find((p) => p.region === "Sul")!;
    expect(sul.eligible).toBeCloseTo(322.8, 5);
  });

  it("sums monthly eligible where reported, keeps null when a region has none", () => {
    const pools = macroRegionPools(estimate());
    expect(pools.find((p) => p.region === "Sudeste")!.monthlyEligible).toBeCloseTo(28.7 + 17.4 + 9.8, 5);
    // BA (the only Nordeste UF here) reported no fill speed.
    expect(pools.find((p) => p.region === "Nordeste")!.monthlyEligible).toBeNull();
  });

  it("skips unknown UF codes rather than misfiling them", () => {
    const pools = macroRegionPools(
      estimate({ byRegion: [{ region: "XX", estimatedN: 100, ciLo: 50, ciHi: 150, baseCohort: 1000, monthlyEligible: null }] }),
    );
    expect(pools).toHaveLength(0);
  });

  it("sorts regions by eligible pool descending", () => {
    const pools = macroRegionPools(estimate());
    const eligibles = pools.map((p) => p.eligible);
    expect(eligibles).toEqual([...eligibles].sort((a, b) => b - a));
  });
});

// ── nationalPoolMetric ───────────────────────────────────────────────────────────

describe("nationalPoolMetric — CI + DataSUS citation on the country supply metric", () => {
  it("is MODELED (transported estimate) with the CI and source carried", () => {
    const m = nationalPoolMetric(estimate());
    expect(m.provenance).toBe(Provenance.MODELED);
    expect(m.confidence).toBe(Confidence.MEDIUM);
    expect(m.value).toBe(4588);
    expect(m.ci).toEqual([4048, 5127]);
    expect(m.asOf).toBe("2026-07-09");
    expect(m.sourceRefs?.[0]?.label).toContain("DataSUS OMOP (omop_full)");
    expect(m.note).toContain("380,517");
  });
});

// ── allocateSitePools ────────────────────────────────────────────────────────────

describe("allocateSitePools — UF real totals split by PI share", () => {
  it("splits a UF's eligible pool proportionally to PI count", () => {
    const sites = [directorySite("a", "SP", 30), directorySite("b", "SP", 10)];
    const alloc = allocateSitePools(sites, estimate());
    expect(alloc.get("a")!.pool).toBe(Math.round(1107.7 * 0.75));
    expect(alloc.get("b")!.pool).toBe(Math.round(1107.7 * 0.25));
    expect(alloc.get("a")!.share).toBeCloseTo(0.75, 5);
    expect(alloc.get("a")!.ufEligible).toBeCloseTo(1107.7, 5);
  });

  it("a site with no PI figure gets weight 1, never 0", () => {
    const sites = [directorySite("a", "SP", null), directorySite("b", "SP", 3)];
    const alloc = allocateSitePools(sites, estimate());
    expect(alloc.get("a")!.pool).toBeGreaterThan(0);
    expect(alloc.get("a")!.share).toBeCloseTo(0.25, 5);
  });

  it("derives ppm from the UF monthly eligible × share × screen-to-enrol; null when unreported", () => {
    const sp = allocateSitePools([directorySite("a", "SP", 5)], estimate()).get("a")!;
    expect(sp.ppm).toBeCloseTo(28.7 * 1 * 0.3, 5);
    const ba = allocateSitePools([directorySite("c", "BA", 5)], estimate()).get("c")!;
    expect(ba.ppm).toBeNull();
  });

  it("sites in UFs the estimator does not cover are absent (callers fall back)", () => {
    const alloc = allocateSitePools([directorySite("z", "AC", 5)], estimate());
    expect(alloc.size).toBe(0);
  });

  it("keys by id when a site has no CNES", () => {
    const s = directorySite("slug-only", "SP", 2, { cnes: null });
    const alloc = allocateSitePools([s], estimate());
    expect(alloc.get("slug-only")).toBeDefined();
  });
});

// ── buildReport with the real estimate ───────────────────────────────────────────

describe("buildReport — real DataSUS pools replace the synthetic-cohort chain", () => {
  const synthetic = [evaluatedSite("a", 40, 20), evaluatedSite("b", 10, 5)];

  it("funnel: registry-sealed real base cohort narrowing to a CI-carrying estimate", () => {
    const report = buildReport(consultation, synthetic, { nationalEstimate: estimate() });
    expect(() => assertProvenanced(report)).not.toThrow();
    const base = report.funnel.basePopulationMetric;
    expect(base.provenance).toBe(Provenance.REGISTRY_GOV);
    expect(base.confidence).toBe(Confidence.HIGH);
    expect(base.value).toBe(380_517);
    const eligible = report.funnel.eligiblePoolMetric;
    expect(eligible.value).toBe(4588);
    expect(eligible.ci).toEqual([4048, 5127]);
    expect(eligible.sourceRefs?.[0]?.label).toContain("DataSUS");
  });

  it("country supply uses the real pool (recommendation no longer starved by synthetic counts)", () => {
    const report = buildReport(consultation, synthetic, {
      nationalEstimate: estimate(),
      targetSampleSize: 200,
    });
    const d2 = report.country.dimensions.find((d) => d.key === "patient_supply")!;
    const pool = d2.contributingMetrics.find((m) => m.key === "country.patient_supply.national_pool")!;
    expect(pool.value).toBe(4588);
    expect(pool.ci).toEqual([4048, 5127]);
    // 4,588 eligible vs. a 200-patient target: supply is not the blocker.
    expect(report.country.recommendation).not.toBe("no_go");
  });

  it("supply/demand regions come from the real macro-region rollup", () => {
    const report = buildReport(consultation, synthetic, { nationalEstimate: estimate() });
    const regions = report.supplyDemand!.regions;
    const sudeste = regions.find((r) => r.regionCode === "Sudeste")!;
    expect(sudeste.eligiblePoolMetric.value).toBe(Math.round(1107.7 + 721.1 + 347.4));
    expect(sudeste.eligiblePoolMetric.note).toContain("DataSUS");
  });

  it("softening scenarios come from the real bottleneck gains (zero-gain ones dropped)", () => {
    const report = buildReport(consultation, synthetic, { nationalEstimate: estimate() });
    const labels = report.softening.scenarios.map((s) => s.label);
    expect(labels[0]).toContain("Metastatic");
    expect(labels[1]).toContain("ECOG");
    expect(labels.join(" ")).not.toContain("autoimmune");
    expect(report.softening.scenarios[0].deltaEligiblePoolMetric.value).toBe(75_896);
  });

  it("directory sites in covered UFs get real pools and lift off LOW confidence", () => {
    const report = buildReport(consultation, synthetic, {
      nationalEstimate: estimate(),
      directorySites: [directorySite("sp1", "SP", 12), directorySite("ac1", "AC", 12)],
    });
    const sp1 = report.siteRankings.find((s) => s.cnes === "sp1")!;
    const ac1 = report.siteRankings.find((s) => s.cnes === "ac1")!;
    // Covered UF: publicly-verifiable pool + PI history → MEDIUM.
    expect(sp1.confidence).toBe("medium");
    // Uncovered UF: falls back to the proxy → still LOW, honestly.
    expect(ac1.confidence).toBe("low");
  });

  it("estimator offline (no estimate) keeps the old synthetic path byte-for-byte", () => {
    const withOpt = buildReport(consultation, synthetic, { nationalEstimate: null });
    const without = buildReport(consultation, synthetic, {});
    expect(withOpt).toEqual(without);
    expect(without.funnel.basePopulationMetric.provenance).toBe(Provenance.MODELED);
  });

  it("assumptions state the real base and its size", () => {
    const report = buildReport(consultation, synthetic, { nationalEstimate: estimate() });
    expect(report.riskRegister.assumptions[0]).toContain("REAL");
    expect(report.riskRegister.assumptions[0]).toContain("380,517");
  });

  it("is deterministic with the estimate", () => {
    const a = buildReport(consultation, synthetic, { nationalEstimate: estimate() });
    const b = buildReport(consultation, synthetic, { nationalEstimate: estimate() });
    expect(a).toEqual(b);
  });
});
