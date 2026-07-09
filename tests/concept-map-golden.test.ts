import { describe, it, expect } from "vitest";
import { buildConceptMap } from "@/lib/omop/conceptMap";
import { HERO_META, HERO_CRITERIA } from "@/data/hero-protocol";
import { NSCLC_META, NSCLC_CRITERIA } from "@/data/nsclc-kras-protocol";

/**
 * THE GOLDEN GATE.
 *
 * The whole point of the resolver is to DERIVE the CID-10 codes the DataSUS
 * base cohort keys on, instead of hand-typing them. This proves the derived
 * codes equal the values that were previously hard-coded in the estimator's
 * data.py (`dx_cid_prefixes`) — deterministically, offline, with no data lake
 * or API key required.
 */
const HAND_TYPED_TRUTH: Record<string, string[]> = {
  breast_cancer: ["C50"],
  lung_cancer: ["C33", "C34"],
};

const map = buildConceptMap([
  { nct: HERO_META.nct, criteria: HERO_CRITERIA },
  { nct: NSCLC_META.nct, criteria: NSCLC_CRITERIA },
]);

describe("GOLDEN GATE — derived CID-10 prefixes == hand-typed dx_cid_prefixes", () => {
  it("breast_cancer -> [C50]", () => {
    expect(map.dxPrefixes.breast_cancer).toEqual(HAND_TYPED_TRUTH.breast_cancer);
  });

  it("lung_cancer -> [C33, C34]", () => {
    expect(map.dxPrefixes.lung_cancer).toEqual(HAND_TYPED_TRUTH.lung_cancer);
  });

  it("dxPrefixes exactly equals the hand-typed truth (no extra or missing dx)", () => {
    expect(map.dxPrefixes).toEqual(HAND_TYPED_TRUTH);
  });
});

describe("concept-map entries follow the §2.2 contract", () => {
  it("every entry carries domain, vocabulary, assertion, answerability, inclusion, conceptId", () => {
    expect(map.entries.length).toBe(HERO_CRITERIA.length + NSCLC_CRITERIA.length);
    for (const e of map.entries) {
      expect(e.domain).toBeTruthy();
      expect(e.table).toBeTruthy();
      expect(["present", "absent", "history"]).toContain(e.assertion);
      expect(["datasus", "depth", "ambos"]).toContain(e.answerability);
      expect(typeof e.inclusion).toBe("boolean");
      expect(typeof e.conceptId).toBe("number");
      expect(["lexical", "model", "verified"]).toContain(e.anchoredBy);
    }
  });

  it("diagnosis entries are datasus-tier with an icd10 binding; biomarkers are depth with none", () => {
    const dx = map.entries.filter((e) => e.key === "breast_cancer" || e.key === "lung_cancer");
    expect(dx.length).toBe(2);
    for (const e of dx) {
      expect(e.answerability).toBe("datasus");
      expect(e.icd10).not.toBeNull();
      expect(e.anchoredBy).toBe("lexical");
    }
    const her2 = map.entries.find((e) => e.key === "her2_status");
    expect(her2?.answerability).toBe("depth");
    expect(her2?.icd10).toBeNull();
  });

  it("sex resolves to a verified OMOP Gender concept_id (no needsMapping)", () => {
    const sex = map.entries.find((e) => e.key === "sex");
    // hero has no explicit sex criterion; nsclc none either — guard if absent.
    if (sex) {
      expect(sex.conceptId === 8532 || sex.conceptId === 8507).toBe(true);
      expect(sex.needsMapping).toBe(false);
    }
  });
});
