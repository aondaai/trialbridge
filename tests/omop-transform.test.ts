import { describe, it, expect } from "vitest";
import type { Criterion } from "@/lib/matcher/types";
import { toOmopCriteria } from "@/lib/omop/transform";
import { HERO_CRITERIA } from "@/data/hero-protocol";
import { NSCLC_CRITERIA } from "@/data/nsclc-kras-protocol";

describe("toOmopCriteria", () => {
  it("maps every hero + nsclc criterion without throwing, one OmopCriterion per Criterion", () => {
    for (const criteria of [HERO_CRITERIA, NSCLC_CRITERIA]) {
      const omop = toOmopCriteria(criteria);
      expect(omop.length).toBe(criteria.length);
      omop.forEach((o, i) => {
        expect(o.criterionId).toBe(criteria[i].id);
        expect(o.sourceField).toBe(criteria[i].field);
        expect(o.concept.domain).toBeTruthy();
        expect(o.concept.table).toBeTruthy();
      });
    }
  });

  it("derives assertion from kind: inclusion -> PRESENT, exclusion -> ABSENT", () => {
    const criteria: Criterion[] = [
      { id: "i1", kind: "inclusion", field: "diagnosis", operator: "eq", value: "breast cancer", rawText: "x", confidence: 1 },
      { id: "e1", kind: "exclusion", field: "brain_metastases", operator: "eq", value: "present", rawText: "x", confidence: 1 },
    ];
    const [inc, exc] = toOmopCriteria(criteria);
    expect(inc.assertion).toBe("PRESENT");
    expect(exc.assertion).toBe("ABSENT");
  });

  it("verifies sex -> OMOP Gender concept_id by value, unverified for other fields", () => {
    const criteria: Criterion[] = [
      { id: "s1", kind: "inclusion", field: "sex", operator: "eq", value: "female", rawText: "x", confidence: 1 },
      { id: "s2", kind: "inclusion", field: "sex", operator: "eq", value: "male", rawText: "x", confidence: 1 },
      { id: "h1", kind: "inclusion", field: "her2_status", operator: "in", value: ["positive"], rawText: "x", confidence: 1 },
    ];
    const [female, male, her2] = toOmopCriteria(criteria);

    expect(female.concept).toMatchObject({ vocabularyId: "Gender", conceptId: 8532, verified: true, needsMapping: false });
    expect(male.concept).toMatchObject({ vocabularyId: "Gender", conceptId: 8507, verified: true, needsMapping: false });

    expect(her2.concept.vocabularyId).toBe("LOINC");
    expect(her2.concept.domain).toBe("Measurement");
    expect(her2.concept.verified).toBe(false);
    expect(her2.concept.needsMapping).toBe(true);
    expect(her2.concept.conceptId).toBe(0);
  });

  it("falls back to a safe unmapped concept for a field the vocabulary table has never seen", () => {
    const criteria: Criterion[] = [
      { id: "z1", kind: "inclusion", field: "totally_novel_field", operator: "exists", value: null, rawText: "x", confidence: 1 },
    ];
    const [z] = toOmopCriteria(criteria);
    expect(z.concept.conceptId).toBe(0);
    expect(z.concept.needsMapping).toBe(true);
    expect(z.concept.verified).toBe(false);
    expect(z.concept.domain).toBe("Observation");
  });
});
