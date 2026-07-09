import { describe, it, expect } from "vitest";
import {
  wilsonInterval,
  standardizeRate,
  transportabilityBound,
  estimateEligible,
  zFor,
  type Stratum,
} from "@/lib/enrichmentEstimator";

describe("wilsonInterval — the joint fraction gets a real interval (critique #1)", () => {
  it("reproduces a known Wilson interval (k=18, n=400 ≈ the deck's joint rate)", () => {
    const ci = wilsonInterval(18, 400, 0.95);
    expect(ci.point).toBeCloseTo(0.045, 4);
    // Hand-computed Wilson limits for 18/400 at 95%.
    expect(ci.lower).toBeCloseTo(0.0287, 3);
    expect(ci.upper).toBeCloseTo(0.07, 3);
  });

  it("stays inside [0,1] even for a tiny count near zero, where Wald would go negative", () => {
    const ci = wilsonInterval(1, 40, 0.95);
    expect(ci.lower).toBeGreaterThanOrEqual(0);
    expect(ci.upper).toBeLessThanOrEqual(1);
    // Wald lower here (0.025 - 1.96*sqrt(0.025*0.975/40) = -0.023) is negative; Wilson is not.
    expect(ci.lower).toBeGreaterThan(0);
  });

  it("the JOINT interval is relatively wider than the MARGINAL HER2+ interval — the whole point", () => {
    // Marginal HER2+ from the deck: rate 0.18, n=412 → k≈74.
    const marginal = wilsonInterval(74, 412, 0.95);
    // Joint (all three depth features) from the deck: rate ~0.045, driven by ~18 co-positive cases.
    const joint = wilsonInterval(18, 400, 0.95);

    const relWidth = (ci: { point: number; lower: number; upper: number }) =>
      (ci.upper - ci.lower) / ci.point;

    // The number doing the real work (joint) carries proportionally MORE uncertainty
    // than the marginal rate the deck actually put a CI on.
    expect(relWidth(joint)).toBeGreaterThan(relWidth(marginal));
  });

  it("widens as n shrinks and narrows as n grows, at fixed rate", () => {
    const small = wilsonInterval(9, 200, 0.95);
    const large = wilsonInterval(90, 2000, 0.95);
    expect(small.point).toBeCloseTo(large.point, 6);
    expect(small.upper - small.lower).toBeGreaterThan(large.upper - large.lower);
  });

  it("rejects impossible inputs", () => {
    expect(() => wilsonInterval(5, 0)).toThrow();
    expect(() => wilsonInterval(-1, 10)).toThrow();
    expect(() => wilsonInterval(11, 10)).toThrow();
  });
});

describe("standardizeRate — direct standardization + sparse cells (critique #2)", () => {
  it("reproduces the deck's two-stratum worked example (0.6·0.20 + 0.4·0.15 = 0.18)", () => {
    // Big n so no thin-cell fallback fires; we're checking the point arithmetic.
    const strata: Stratum[] = [
      { label: "age 50-59", weight: 0.6, k: 200, n: 1000 }, // rate 0.20
      { label: "age 60-75", weight: 0.4, k: 150, n: 1000 }, // rate 0.15
    ];
    const out = standardizeRate(strata);
    expect(out.rate.point).toBeCloseTo(0.18, 6);
    expect(out.coveredWeight).toBeCloseTo(1, 6);
  });

  it("standardized rate differs from the naive pooled rate when composition differs", () => {
    // Proprietary sample skews toward the high-rate stratum; base does not.
    const strata: Stratum[] = [
      { label: "younger (high rate)", weight: 0.3, k: 400, n: 1000 }, // rate 0.40, but only 30% of base
      { label: "older (low rate)", weight: 0.7, k: 100, n: 1000 }, // rate 0.10, 70% of base
    ];
    const out = standardizeRate(strata);
    // Standardized = 0.3*0.40 + 0.7*0.10 = 0.19
    expect(out.rate.point).toBeCloseTo(0.19, 6);
    // Naive pooled rate would be (400+100)/2000 = 0.25 — importing the sample's age skew.
    expect(out.pooledRate).toBeCloseTo(0.25, 6);
    expect(out.rate.point).toBeLessThan(out.pooledRate);
  });

  it("handles arbitrarily many cross-classified strata (age × region)", () => {
    const strata: Stratum[] = [
      { label: "50-59 · Sudeste", weight: 0.30, k: 60, n: 300 },
      { label: "50-59 · Sul", weight: 0.20, k: 40, n: 200 },
      { label: "60-75 · Sudeste", weight: 0.30, k: 30, n: 300 },
      { label: "60-75 · Sul", weight: 0.20, k: 20, n: 200 },
    ];
    const out = standardizeRate(strata);
    expect(out.strata).toHaveLength(4);
    expect(out.rate.point).toBeGreaterThan(0);
    expect(out.rate.point).toBeLessThan(1);
    expect(out.coveredWeight).toBeCloseTo(1, 6);
  });

  it("flags a thin cell, redirects its weight to the pooled rate, and reports covered weight", () => {
    const strata: Stratum[] = [
      { label: "adequate", weight: 0.8, k: 160, n: 800 }, // rate 0.20, n big
      { label: "sparse", weight: 0.2, k: 1, n: 3 }, // n=3 < minStratumN → pooled fallback
    ];
    const out = standardizeRate(strata, { minStratumN: 30 });
    const sparse = out.strata.find((s) => s.label === "sparse")!;
    expect(sparse.thin).toBe(true);
    expect(sparse.empty).toBe(false);
    // Pooled rate is computed over ADEQUATE cells only → 160/800 = 0.20, not (161/803).
    expect(out.pooledRate).toBeCloseTo(0.2, 6);
    expect(sparse.appliedRate).toBeCloseTo(0.2, 6);
    // 80% of base weight is backed by an own-stratum estimate; 20% leaned on the fallback.
    expect(out.coveredWeight).toBeCloseTo(0.8, 6);
  });

  it("handles an EMPTY cell (n=0) without NaN — no weight silently dropped", () => {
    const strata: Stratum[] = [
      { label: "adequate", weight: 0.7, k: 140, n: 700 }, // 0.20
      { label: "empty", weight: 0.3, k: 0, n: 0 },
    ];
    const out = standardizeRate(strata);
    const empty = out.strata.find((s) => s.label === "empty")!;
    expect(empty.empty).toBe(true);
    expect(empty.ownRate).toBeNull();
    expect(empty.appliedRate).toBeCloseTo(0.2, 6); // pooled fallback
    expect(Number.isNaN(out.rate.point)).toBe(false);
    // Empty stratum's 30% weight is still represented (via the fallback), not dropped:
    // rate = 0.7*0.20 + 0.3*0.20 = 0.20.
    expect(out.rate.point).toBeCloseTo(0.2, 6);
    expect(out.coveredWeight).toBeCloseTo(0.7, 6);
  });

  it("leaning on the pooled fallback widens (never narrows) the interval vs. all-adequate cells", () => {
    const allAdequate: Stratum[] = [
      { label: "a", weight: 0.5, k: 100, n: 500 },
      { label: "b", weight: 0.5, k: 100, n: 500 },
    ];
    const oneThin: Stratum[] = [
      { label: "a", weight: 0.5, k: 100, n: 500 },
      { label: "b (thin)", weight: 0.5, k: 4, n: 20 }, // same 0.20 rate, but n=20 < 30
    ];
    const wide = standardizeRate(oneThin, { minStratumN: 30 });
    const tight = standardizeRate(allAdequate, { minStratumN: 30 });
    const width = (r: { lower: number; upper: number }) => r.upper - r.lower;
    // Both point estimates ~0.20, but the thin case must not report a tighter interval.
    expect(width(wide.rate)).toBeGreaterThanOrEqual(width(tight.rate));
  });

  it("rejects degenerate inputs", () => {
    expect(() => standardizeRate([])).toThrow();
    expect(() => standardizeRate([{ label: "x", weight: 0, k: 1, n: 10 }])).toThrow();
    expect(() => standardizeRate([{ label: "x", weight: 1, k: 11, n: 10 }])).toThrow();
  });
});

describe("transportabilityBound — the caveat becomes a number (critique #3)", () => {
  it("strictly contains the sampling interval", () => {
    const sampling = wilsonInterval(18, 400, 0.95);
    const b = transportabilityBound(sampling, 0.25);
    expect(b.widened.lower).toBeLessThan(sampling.lower);
    expect(b.widened.upper).toBeGreaterThan(sampling.upper);
    expect(b.tau).toBe(0.25);
    // The point estimate itself doesn't move — only the honesty band around it.
    expect(b.widened.point).toBeCloseTo(sampling.point, 12);
  });

  it("τ=0 is a no-op (no transportability penalty asserted)", () => {
    const sampling = wilsonInterval(50, 400, 0.95);
    const b = transportabilityBound(sampling, 0);
    expect(b.widened.lower).toBeCloseTo(sampling.lower, 12);
    expect(b.widened.upper).toBeCloseTo(sampling.upper, 12);
  });

  it("respects an explicit ceiling for a proportion interval and rejects negative τ", () => {
    const sampling = wilsonInterval(390, 400, 0.95); // upper near 1
    const b = transportabilityBound(sampling, 0.5, 1); // proportion → ceiling 1
    expect(b.widened.upper).toBeLessThanOrEqual(1);
    expect(b.widened.lower).toBeGreaterThanOrEqual(0);
    expect(() => transportabilityBound(sampling, -0.1)).toThrow();
  });
});

describe("estimateEligible — base × fraction ± CI, base exact (deck steps 4-6)", () => {
  it("São Paulo worked example: 3200 × 0.045 ≈ 144, with a count band, never a bare number", () => {
    const est = estimateEligible({ base: 3200, jointK: 18, jointN: 400 }, "São Paulo");
    expect(est.base).toBe(3200);
    expect(est.estimatedEligible.point).toBeCloseTo(144, 0);
    // Band is base × fraction band — and it's meaningfully wide (~92 to ~224), which is
    // exactly the uncertainty the deck's bare "≈144" hid.
    expect(est.estimatedEligible.lower).toBeLessThan(120);
    expect(est.estimatedEligible.upper).toBeGreaterThan(190);
    expect(est.transportability).toBeNull();
  });

  it("treats the base as exact — all count-band uncertainty comes from the fraction", () => {
    const est = estimateEligible({ base: 1000, jointK: 100, jointN: 400 });
    // point/lower/upper of the count band equal base × the fraction interval exactly.
    expect(est.estimatedEligible.point).toBeCloseTo(1000 * est.jointFraction.point, 9);
    expect(est.estimatedEligible.lower).toBeCloseTo(1000 * est.jointFraction.lower, 9);
    expect(est.estimatedEligible.upper).toBeCloseTo(1000 * est.jointFraction.upper, 9);
  });

  it("uses the standardized fraction when strata are supplied, and reports both", () => {
    const strata: Stratum[] = [
      { label: "50-59", weight: 0.6, k: 200, n: 1000 },
      { label: "60-75", weight: 0.4, k: 150, n: 1000 },
    ];
    const est = estimateEligible({ base: 3200, jointK: 350, jointN: 2000, strata });
    expect(est.standardized).not.toBeNull();
    // Count band is driven by the standardized 0.18, not the raw pooled fraction.
    expect(est.jointFraction.point).toBeCloseTo(0.18, 6);
    expect(est.estimatedEligible.point).toBeCloseTo(3200 * 0.18, 4);
  });

  it("attaches a transportability band when τ is supplied, wider than the sampling band", () => {
    const est = estimateEligible({ base: 3200, jointK: 18, jointN: 400, tau: 0.3 });
    expect(est.transportability).not.toBeNull();
    const t = est.transportability!;
    expect(t.widened.lower).toBeLessThan(est.estimatedEligible.lower);
    expect(t.widened.upper).toBeGreaterThan(est.estimatedEligible.upper);
  });

  it("is deterministic — same input yields byte-identical output", () => {
    const input = { base: 1850, jointK: 22, jointN: 500, tau: 0.2 };
    expect(estimateEligible(input, "Minas Gerais")).toEqual(estimateEligible(input, "Minas Gerais"));
  });
});

describe("zFor", () => {
  it("returns standard multipliers and rejects unsupported levels", () => {
    expect(zFor(0.95)).toBeCloseTo(1.96, 2);
    expect(zFor(0.9)).toBeCloseTo(1.645, 3);
    expect(zFor(0.99)).toBeCloseTo(2.576, 3);
    expect(() => zFor(0.975)).toThrow();
  });
});
