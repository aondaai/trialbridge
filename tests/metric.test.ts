import { describe, it, expect } from "vitest";
import {
  Provenance,
  Confidence,
  metric,
  modeled,
  registry,
  peerReviewed,
  siteDeclared,
  vendor,
  unavailable,
  isMetric,
  rollUpConfidence,
  assertProvenanced,
  ProvenanceGateError,
  buildProvenanceIndex,
  SEAL_UI,
  SEAL_RANK,
} from "@/lib/metric";

describe("metric() constructor — mandatory fields always present", () => {
  it("fills provenance + confidence and defaults the optionals", () => {
    const m = metric("site.ppm", 4.2, Provenance.MODELED, Confidence.MEDIUM, {
      unit: "patients/month",
    });
    expect(m.value).toBe(4.2);
    expect(m.provenance).toBe(Provenance.MODELED);
    expect(m.confidence).toBe(Confidence.MEDIUM);
    expect(m.unit).toBe("patients/month");
    expect(m.sourceRefs).toEqual([]);
    expect(m.ci).toBeNull();
  });

  it("seal-specific helpers set the right provenance and sensible default confidence", () => {
    expect(peerReviewed("k", 1).provenance).toBe(Provenance.PEER_REVIEWED);
    expect(peerReviewed("k", 1).confidence).toBe(Confidence.HIGH);
    expect(registry("k", 1).provenance).toBe(Provenance.REGISTRY_GOV);
    expect(registry("k", 1).confidence).toBe(Confidence.HIGH);
    expect(modeled("k", 1).provenance).toBe(Provenance.MODELED);
    expect(modeled("k", 1).confidence).toBe(Confidence.MEDIUM);
    expect(siteDeclared("k", 1).provenance).toBe(Provenance.SITE_DECLARED);
    expect(vendor("k", 1).provenance).toBe(Provenance.VENDOR);
    expect(vendor("k", 1).confidence).toBe(Confidence.LOW);
  });

  it("carries a CI band (for estimator output)", () => {
    const m = modeled("est", 120, Confidence.MEDIUM, { ci: [92, 224] });
    expect(m.ci).toEqual([92, 224]);
  });
});

describe("unavailable() — a hard-down source degrades honestly (§7.11)", () => {
  it("is null-valued, LOW confidence, keeps the note, and NEVER zero", () => {
    const m = unavailable("ans.factor", Provenance.REGISTRY_GOV, "ANS unavailable; factor defaulted");
    expect(m.value).toBeNull();
    expect(m.value).not.toBe(0);
    expect(m.confidence).toBe(Confidence.LOW);
    expect(m.note).toMatch(/ANS unavailable/);
  });
});

describe("isMetric — structural guard", () => {
  it("accepts a well-formed metric", () => {
    expect(isMetric(modeled("k", 1))).toBe(true);
  });
  it("rejects a bare number, a plain object, and a provenance-less shape", () => {
    expect(isMetric(42)).toBe(false);
    expect(isMetric({ key: "k", value: 1 })).toBe(false);
    expect(isMetric({ key: "k", value: 1, provenance: "made_up", confidence: "high" })).toBe(false);
    expect(isMetric(null)).toBe(false);
  });
});

describe("rollUpConfidence — only as firm as the weakest link", () => {
  it("returns the weakest present", () => {
    expect(rollUpConfidence([Confidence.HIGH, Confidence.HIGH])).toBe(Confidence.HIGH);
    expect(rollUpConfidence([Confidence.HIGH, Confidence.LOW])).toBe(Confidence.LOW);
    expect(rollUpConfidence([Confidence.HIGH, Confidence.MEDIUM])).toBe(Confidence.MEDIUM);
  });
  it("empty roll-up is LOW (we assume nothing)", () => {
    expect(rollUpConfidence([])).toBe(Confidence.LOW);
  });
});

describe("assertProvenanced — the report provenance gate (§8, §14.4)", () => {
  it("passes a report where every metric slot holds a real Metric, and counts them", () => {
    const report = {
      title: "Brazil feasibility", // bare structural field: fine
      compositeMetric: modeled("country.composite", 72),
      dimensions: [
        { key: "regulatory", scoreMetric: modeled("d.regulatory", 68) },
        { key: "cost", scoreMetric: peerReviewed("d.cost", 59, Confidence.HIGH, { unit: "%" }) },
      ],
      headlineMetrics: [modeled("ppm", 3.1), registry("trials", 343)],
    };
    const n = assertProvenanced(report);
    expect(n).toBe(5); // compositeMetric + 2 scoreMetric + 2 headlineMetrics
  });

  it("throws when a metric slot holds a bare number", () => {
    const bad = { compositeMetric: 72 };
    expect(() => assertProvenanced(bad)).toThrow(ProvenanceGateError);
  });

  it("throws when a *Metrics array element is not a Metric, and reports the path", () => {
    const bad = { headlineMetrics: [modeled("ok", 1), 99] };
    try {
      assertProvenanced(bad);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ProvenanceGateError);
      expect((e as ProvenanceGateError).path).toBe("$.headlineMetrics[1]");
    }
  });

  it("ignores bare numbers that are NOT in a metric slot", () => {
    const ok = { siteCount: 3, city: "São Paulo", scoreMetric: modeled("s", 1) };
    expect(assertProvenanced(ok)).toBe(1);
  });
});

describe("buildProvenanceIndex — the Risk Register roll-up (§8)", () => {
  it("counts metrics by seal and by confidence wherever they appear", () => {
    const report = {
      a: peerReviewed("p1", 1),
      b: peerReviewed("p2", 2),
      c: { d: registry("r1", 3), e: modeled("m1", 4, Confidence.LOW) },
      f: [siteDeclared("s1", 5), vendor("v1", 6)],
    };
    const idx = buildProvenanceIndex(report);
    expect(idx.total).toBe(6);
    expect(idx.bySeal[Provenance.PEER_REVIEWED]).toBe(2);
    expect(idx.bySeal[Provenance.REGISTRY_GOV]).toBe(1);
    expect(idx.bySeal[Provenance.MODELED]).toBe(1);
    expect(idx.bySeal[Provenance.SITE_DECLARED]).toBe(1);
    expect(idx.bySeal[Provenance.VENDOR]).toBe(1);
    expect(idx.byConfidence[Confidence.LOW]).toBe(2); // modeled m1 + vendor v1 default
  });
});

describe("Appendix B — every seal has a UI colour + label and a strength rank", () => {
  it("SEAL_UI and SEAL_RANK cover all five seals", () => {
    for (const seal of Object.values(Provenance)) {
      expect(SEAL_UI[seal]?.color).toMatch(/^#/);
      expect(SEAL_UI[seal]?.label.length).toBeGreaterThan(0);
      expect(typeof SEAL_RANK[seal]).toBe("number");
    }
  });
  it("peer-reviewed outranks vendor", () => {
    expect(SEAL_RANK[Provenance.PEER_REVIEWED]).toBeLessThan(SEAL_RANK[Provenance.VENDOR]);
  });
});
