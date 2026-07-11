import { describe, it, expect } from "vitest";
import {
  normBenchmarkRelative,
  normAbsolute,
  normCategorical,
  normChecklist,
  clampScore,
} from "@/lib/scoring/normalize";
import {
  COUNTRY_WEIGHTS_DEFAULT,
  SITE_WEIGHTS_DEFAULT,
  TRIAL_PROFILES,
  resolveCountryWeights,
  resolveSiteWeights,
  sumsToOne,
  validateOverride,
} from "@/lib/scoring/weights";

describe("normBenchmarkRelative — 50 = parity", () => {
  it("parity scores 50 in both directions", () => {
    expect(normBenchmarkRelative(100, 100, "higher")).toBe(50);
    expect(normBenchmarkRelative(100, 100, "lower")).toBe(50);
  });
  it("higher=better: 2x benchmark caps at 100, zero floors at 0", () => {
    expect(normBenchmarkRelative(200, 100, "higher")).toBe(100);
    expect(normBenchmarkRelative(0, 100, "higher")).toBe(0);
    expect(normBenchmarkRelative(150, 100, "higher")).toBe(75);
  });
  it("lower=better: half the benchmark scores 75, 2x scores 0", () => {
    expect(normBenchmarkRelative(50, 100, "lower")).toBe(75);
    expect(normBenchmarkRelative(200, 100, "lower")).toBe(0);
  });
  it("undefined benchmark returns parity (asserts nothing)", () => {
    expect(normBenchmarkRelative(50, 0, "lower")).toBe(50);
    expect(normBenchmarkRelative(50, NaN, "lower")).toBe(50);
  });
});

describe("normAbsolute — piecewise-linear over anchors (descending ok)", () => {
  const fpi: [number, number][] = [
    [90, 100],
    [180, 70],
    [270, 40],
    [365, 0],
  ];
  it("hits the anchors exactly", () => {
    expect(normAbsolute(90, fpi)).toBe(100);
    expect(normAbsolute(180, fpi)).toBe(70);
    expect(normAbsolute(365, fpi)).toBe(0);
  });
  it("interpolates between anchors", () => {
    expect(normAbsolute(135, fpi)).toBeCloseTo(85, 5); // midpoint 90..180 → 100..70
  });
  it("clamps outside the anchor range", () => {
    expect(normAbsolute(30, fpi)).toBe(100); // below first
    expect(normAbsolute(500, fpi)).toBe(0); // above last
  });
  it("empty anchors → 0", () => {
    expect(normAbsolute(100, [])).toBe(0);
  });
});

describe("normCategorical + normChecklist", () => {
  it("looks up tiers and falls back for unknown keys", () => {
    const m = { cacon: 100, unacon: 70, none: 0 };
    expect(normCategorical("cacon", m)).toBe(100);
    expect(normCategorical("unacon", m)).toBe(70);
    expect(normCategorical("mystery", m, 10)).toBe(10);
  });
  it("coerces booleans to presence keys", () => {
    expect(normCategorical(true, { true: 100, false: 0 })).toBe(100);
    expect(normCategorical(false, { true: 100, false: 0 })).toBe(0);
  });
  it("checklist fit is a percentage of required present", () => {
    expect(normChecklist(3, 6)).toBe(50);
    expect(normChecklist(6, 6)).toBe(100);
    expect(normChecklist(0, 0)).toBe(100); // nothing required = full fit
  });
});

describe("clampScore", () => {
  it("bounds to [0,100] and maps NaN to 0", () => {
    expect(clampScore(-5)).toBe(0);
    expect(clampScore(150)).toBe(100);
    expect(clampScore(NaN)).toBe(0);
  });
});

describe("weights — defaults and every profile sum to 1.0 (the CI invariant)", () => {
  it("defaults sum to 1.0", () => {
    expect(sumsToOne(COUNTRY_WEIGHTS_DEFAULT)).toBe(true);
    expect(sumsToOne(SITE_WEIGHTS_DEFAULT)).toBe(true);
  });
  it("EVERY resolved profile vector (country + site) sums to 1.0", () => {
    for (const p of TRIAL_PROFILES) {
      expect(sumsToOne(resolveCountryWeights(p)), `country ${p}`).toBe(true);
      expect(sumsToOne(resolveSiteWeights(p)), `site ${p}`).toBe(true);
    }
  });
  it("rare_disease bumps eligible_pool and kol, cuts competition (vs default)", () => {
    const rd = resolveSiteWeights("rare_disease");
    const def = resolveSiteWeights("default");
    expect(rd.eligible_pool).toBeGreaterThan(def.eligible_pool);
    expect(rd.kol_strength).toBeGreaterThan(def.kol_strength);
    expect(rd.competition).toBeLessThan(def.competition);
  });
  it("default profile equals the documented defaults", () => {
    expect(resolveCountryWeights("default")).toEqual(COUNTRY_WEIGHTS_DEFAULT);
    expect(resolveSiteWeights("default")).toEqual(SITE_WEIGHTS_DEFAULT);
  });
});

describe("validateOverride — /runs rejects malformed weights (§12.2)", () => {
  it("accepts a vector that sums to 1.0", () => {
    expect(() => validateOverride({ a: 0.5, b: 0.5 })).not.toThrow();
  });
  it("rejects a vector that does not sum to 1.0", () => {
    expect(() => validateOverride({ a: 0.5, b: 0.3 })).toThrow(/sum to 1/);
  });
  it("rejects negative weights", () => {
    expect(() => validateOverride({ a: 1.2, b: -0.2 })).toThrow(/non-negative/);
  });
});
