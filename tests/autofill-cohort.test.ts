import { describe, it, expect } from "vitest";
import { resolveCohort, toCohortPreview } from "@/lib/feasibility-autofill/resolvers/cohort";
import type { Criterion, Patient } from "@/lib/matcher/types";
import { isMetric, Provenance, Confidence } from "@/lib/metric";

function patient(id: string, age: number | null, her2: string | null): Patient {
  return {
    id,
    siteId: "s1",
    diagnosis: "breast",
    stage: null,
    biomarkers: { her2_status: her2 },
    priorLines: null,
    ecog: null,
    labs: {},
    sex: null,
    age,
  };
}

const CRITERIA: Criterion[] = [
  { id: "c_age", kind: "inclusion", field: "age", operator: "gte", value: 18, rawText: "Idade ≥ 18", confidence: 1 },
  { id: "c_her2", kind: "inclusion", field: "her2_status", operator: "eq", value: "positive", rawText: "HER2 positivo", confidence: 1 },
];

// definite=3 (p1,p2,p3), possible=2 (p4 her2 unknown, p5 age unknown), excluded=1 (p6 her2 fail)
const COHORT: Patient[] = [
  patient("p1", 50, "positive"),
  patient("p2", 60, "positive"),
  patient("p3", 45, "positive"),
  patient("p4", 40, null),
  patient("p5", null, "positive"),
  patient("p6", 30, "negative"),
];

describe("F3-1 · cohort resolver (archetype C) reuses the matcher", () => {
  it("returns candidate N as a provenanced MODELED Metric", () => {
    const r = resolveCohort(COHORT, CRITERIA, "2026-07-11T00:00:00Z");
    expect(isMetric(r.count)).toBe(true);
    expect(r.count.provenance).toBe(Provenance.MODELED);
    expect(r.count.value).toBe(5); // definite 3 + possible 2, not suppressed (≥5)
    expect(r.suppressed).toBe(false);
    expect(r._raw).toEqual({ definite: 3, possible: 2, excluded: 1, total: 6 });
  });

  it("computes per-criterion softening deltas ranked by pool growth", () => {
    const r = resolveCohort(COHORT, CRITERIA);
    expect(r.perCriterionDeltas).toHaveLength(2);
    const top = r.perCriterionDeltas[0];
    // relaxing HER2 recovers p6 (fail) and p4 (unknown) → 2 newly-definite, which suppresses to "<5"
    expect(top.handle).toBe("c_her2");
    expect(top.newlyDefinite).toBe("<5");
  });

  it("suppresses a small candidate count (<5) and drops confidence to LOW", () => {
    const small = [patient("q1", 50, "positive"), patient("q2", 55, "positive"), patient("q3", 60, "positive")];
    const r = resolveCohort(small, CRITERIA);
    expect(r.count.value).toBe("<5");
    expect(r.suppressed).toBe(true);
    expect(r.count.confidence).toBe(Confidence.LOW);
    expect(r._raw.definite).toBe(3); // raw kept server-side
  });

  it("toCohortPreview yields the {n, suppressed, perCriterionDelta[]} API shape", () => {
    const preview = toCohortPreview(resolveCohort(COHORT, CRITERIA));
    expect(preview.n).toBe(5);
    expect(preview.suppressed).toBe(false);
    expect(preview.perCriterionDelta[0]).toHaveProperty("handle");
    expect(preview.perCriterionDelta[0]).toHaveProperty("newlyDefinite");
  });

  it("no patient rows appear anywhere in the emitted result (aggregate-only)", () => {
    const r = resolveCohort(COHORT, CRITERIA);
    const serialized = JSON.stringify({ count: r.count, deltas: r.perCriterionDeltas, suppressed: r.suppressed });
    for (const p of COHORT) expect(serialized).not.toContain(p.id);
  });
});
