import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveConcept,
  resolveConceptEntry,
  __resetConceptResolverCacheForTests,
} from "@/lib/omop/conceptResolver";
import { toOmopCriteria } from "@/lib/omop/transform";
import type { Criterion } from "@/lib/matcher/types";
import { HERO_CRITERIA } from "@/data/hero-protocol";

beforeEach(() => __resetConceptResolverCacheForTests());

describe("conceptResolver — reads the shared concept-map.json", () => {
  it("resolves the hero diagnosis to a datasus-tier entry with CID-10 [C50]", () => {
    const dx = HERO_CRITERIA.find((c) => c.field === "diagnosis")!;
    const e = resolveConceptEntry(dx);
    expect(e.answerability).toBe("datasus");
    expect(e.icd10?.prefixes).toEqual(["C50"]);
    expect(e.anchoredBy).toBe("lexical");
  });

  it("resolves a biomarker to a depth-tier entry with no icd10 binding", () => {
    const her2 = HERO_CRITERIA.find((c) => c.field === "her2_status")!;
    const e = resolveConceptEntry(her2);
    expect(e.answerability).toBe("depth");
    expect(e.icd10).toBeNull();
  });

  it("live fallback: a criterion NOT in the frozen map still resolves deterministically (gender)", () => {
    const sex: Criterion = { id: "sx_not_in_map", kind: "inclusion", field: "sex", operator: "eq", value: "female", rawText: "Female", confidence: 1 };
    const concept = resolveConcept(sex);
    expect(concept.vocabularyId).toBe("Gender");
    expect(concept.conceptId).toBe(8532);
    expect(concept.verified).toBe(true);
    expect(concept.needsMapping).toBe(false);
  });

  it("unknown field falls back to the safe unmapped Observation concept", () => {
    const z: Criterion = { id: "z_novel", kind: "inclusion", field: "totally_novel_field", operator: "exists", value: null, rawText: "x", confidence: 1 };
    const concept = resolveConcept(z);
    expect(concept.conceptId).toBe(0);
    expect(concept.needsMapping).toBe(true);
    expect(concept.domain).toBe("Observation");
  });
});

describe("toOmopCriteria — now sourced from the shared map", () => {
  it("attaches answerability + icd10Prefixes per criterion", () => {
    const omop = toOmopCriteria(HERO_CRITERIA);
    const dx = omop.find((o) => o.sourceField === "diagnosis")!;
    expect(dx.answerability).toBe("datasus");
    expect(dx.icd10Prefixes).toEqual(["C50"]);
    expect(dx.concept.domain).toBe("Condition");

    const her2 = omop.find((o) => o.sourceField === "her2_status")!;
    expect(her2.answerability).toBe("depth");
    expect(her2.icd10Prefixes).toBeNull();
  });
});
