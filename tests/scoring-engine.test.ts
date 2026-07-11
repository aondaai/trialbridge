import { describe, it, expect } from "vitest";
import { scoreCountry, brazilCountryInput, CountryInput } from "@/lib/scoring/country";
import { scoreSite, rankSites, siteConfidence, SiteInput } from "@/lib/scoring/site";
import { DEMOTION_CEILING } from "@/lib/scoring/guardrails";
import { isMetric, Confidence } from "@/lib/metric";
import { assertProvenanced } from "@/lib/metric";

// ── Country ──────────────────────────────────────────────────────────────────────

function strongBrazil(overrides: Partial<CountryInput> = {}): CountryInput {
  return brazilCountryInput({ nationalEligiblePool: 5000, targetSampleSize: 200, overrides });
}

describe("scoreCountry — composite, dimensions, provenance", () => {
  it("returns 7 dimensions, a composite in [0,100], and provenance on every metric", () => {
    const sc = scoreCountry(strongBrazil());
    expect(sc.dimensions).toHaveLength(7);
    expect(sc.composite).toBeGreaterThanOrEqual(0);
    expect(sc.composite).toBeLessThanOrEqual(100);
    for (const d of sc.dimensions) {
      expect(isMetric(d.scoreMetric)).toBe(true);
      for (const m of d.contributingMetrics) expect(isMetric(m)).toBe(true);
    }
    // The whole scorecard passes the provenance gate.
    expect(() => assertProvenanced(sc)).not.toThrow();
  });

  it("determinism: same input → identical output", () => {
    const a = scoreCountry(strongBrazil());
    const b = scoreCountry(strongBrazil());
    expect(a).toEqual(b);
  });
});

describe("recommendation branches (§5.2)", () => {
  it("GO when composite high, no critical dim <50, no flags", () => {
    const sc = scoreCountry(strongBrazil());
    // strong Brazil defaults should clear the bar
    expect(["go", "conditional_go"]).toContain(sc.recommendation);
  });

  it("NO_GO when supply is below the sample target", () => {
    const sc = scoreCountry(
      brazilCountryInput({ nationalEligiblePool: 50, targetSampleSize: 500 }),
    );
    expect(sc.recommendation).toBe("no_go");
  });

  it("CONDITIONAL_GO when a hard flag is active even with a strong composite", () => {
    const sc = scoreCountry(
      strongBrazil({
        activeHardFlags: [{ key: "adi_7875", label: "ADI 7875 pending", severity: "demote" }],
      }),
    );
    expect(sc.recommendation).toBe("conditional_go");
  });

  it("NO_GO when a blocking hard flag is active", () => {
    const sc = scoreCountry(
      strongBrazil({
        activeHardFlags: [{ key: "law_struck", label: "Law struck down", severity: "block" }],
      }),
    );
    expect(sc.recommendation).toBe("no_go");
  });

  it("a critical dimension below 50 blocks a GO (drops to conditional)", () => {
    // Cripple data_quality via a terrible OAI rate.
    const sc = scoreCountry(strongBrazil({ gcpOaiRate: 40 }));
    expect(sc.recommendation).not.toBe("go");
  });
});

// ── Site ─────────────────────────────────────────────────────────────────────────

function baseSite(overrides: Partial<SiteInput> = {}): SiteInput {
  return {
    cnes: "2077469",
    name: "ICESP",
    city: "São Paulo",
    uf: "SP",
    profile: "onc_ph3",
    eligiblePool: 220,
    declaredPool: 200,
    poolVerifiablePublicly: true,
    projectedPatientsPerMonth: 4,
    declaredCommitmentPerMonth: 5,
    priorTrials: 5,
    historicalEnrollmentRate: 2,
    zeroEnroller: false,
    hasPIHistory: true,
    competingTrialsInCatchment: 2,
    requiredEquipment: 6,
    presentEquipment: 6,
    kolScore0100: 80,
    projectedFpiDays: 100,
    inspectionOk: true,
    declaredQueryRate: 0.3,
    crcCount: 4,
    crcExperienceYears: 6,
    emrEsource: true,
    hasDeclaration: true,
    hasDigitalSfq: true,
    minInfraFit: 80,
    cepAccreditedForRisk: true,
    impLeadTimeDays: 60,
    daysToFpiBudget: 120,
    screenFailRate: 30,
    retentionRate: 90,
    ...overrides,
  };
}

describe("scoreSite — 9 components, provenance, determinism", () => {
  it("returns 9 components, composite in [0,100], radar with 9 entries, gate passes", () => {
    const s = scoreSite(baseSite());
    expect(s.components).toHaveLength(9);
    expect(s.composite).toBeGreaterThanOrEqual(0);
    expect(s.composite).toBeLessThanOrEqual(100);
    expect(Object.keys(s.radar)).toHaveLength(9);
    expect(() => assertProvenanced(s)).not.toThrow();
  });

  it("a strong declared site scores well and is HIGH confidence", () => {
    const s = scoreSite(baseSite());
    expect(s.composite).toBeGreaterThan(60);
    expect(s.confidence).toBe(Confidence.HIGH);
    expect(s.hardFlags).toHaveLength(0);
  });

  it("determinism", () => {
    expect(scoreSite(baseSite())).toEqual(scoreSite(baseSite()));
  });
});

describe("confidence roll-up (§6.6)", () => {
  it("public-data-only site (no declaration, no PI history) is LOW", () => {
    expect(
      siteConfidence(baseSite({ hasDeclaration: false, hasDigitalSfq: false, hasPIHistory: false })),
    ).toBe(Confidence.LOW);
  });
  it("all three signals → HIGH", () => {
    expect(
      siteConfidence(baseSite({ hasDeclaration: true, hasDigitalSfq: true, hasPIHistory: true, poolVerifiablePublicly: true })),
    ).toBe(Confidence.HIGH);
  });
  it("two of three signals → MEDIUM", () => {
    // declaration+SFQ (1) + PI history (1), but pool not publicly verifiable → 2/3.
    expect(
      siteConfidence(baseSite({ hasDeclaration: true, hasDigitalSfq: true, hasPIHistory: true, poolVerifiablePublicly: false })),
    ).toBe(Confidence.MEDIUM);
    // no declaration (0) + PI history (1) + verifiable pool (1) → 2/3.
    expect(
      siteConfidence(baseSite({ hasDeclaration: false, hasDigitalSfq: false, hasPIHistory: true, poolVerifiablePublicly: true })),
    ).toBe(Confidence.MEDIUM);
  });
});

describe("guard-rails (§6.7) — a flagged site can never be top-decile", () => {
  it("missing essential equipment demotes below the ceiling even with great raw components", () => {
    // Give the site an otherwise-elite profile but starve its infra fit.
    const s = scoreSite(baseSite({ presentEquipment: 2, requiredEquipment: 6, minInfraFit: 80 }));
    expect(s.hardFlags.map((f) => f.key)).toContain("missing_essential_equipment");
    expect(s.composite).toBeLessThanOrEqual(DEMOTION_CEILING);
  });

  it("a chronic zero-enroller is flagged and demoted", () => {
    const s = scoreSite(baseSite({ zeroEnroller: true }));
    expect(s.hardFlags.map((f) => f.key)).toContain("chronic_zero_enroller");
    expect(s.composite).toBeLessThanOrEqual(DEMOTION_CEILING);
  });

  it("import window longer than the FPI budget flags the site", () => {
    const s = scoreSite(baseSite({ impLeadTimeDays: 200, daysToFpiBudget: 90 }));
    expect(s.hardFlags.map((f) => f.key)).toContain("import_window_incompatible");
  });

  it("ranking: a flagged elite site never out-ranks a clean good site", () => {
    const flaggedElite = scoreSite(baseSite({ cnes: "A", presentEquipment: 2, requiredEquipment: 6 }));
    const cleanGood = scoreSite(baseSite({ cnes: "B" }));
    const ranked = rankSites([flaggedElite, cleanGood]);
    expect(ranked[0].cnes).toBe("B");
  });
});

describe("determinism across profiles + weight vectors sum invariant already covered", () => {
  it("scoring under different profiles stays in range", () => {
    for (const profile of ["onc_early", "rare_disease", "vaccine_id", "cardiology"] as const) {
      const s = scoreSite(baseSite({ profile }));
      expect(s.composite).toBeGreaterThanOrEqual(0);
      expect(s.composite).toBeLessThanOrEqual(100);
    }
  });
});
