import { describe, it, expect, beforeEach } from "vitest";
import { buildConceptMap, resolveEntry, type AnchorFallback } from "@/lib/omop/conceptMap";
import { loadCid10Reference } from "@/lib/omop/cid10";
import { resolveConcept, __resetConceptResolverCacheForTests } from "@/lib/omop/conceptResolver";
import type { Criterion } from "@/lib/matcher/types";
import { HERO_META, HERO_CRITERIA } from "@/data/hero-protocol";
import { NSCLC_META, NSCLC_CRITERIA } from "@/data/nsclc-kras-protocol";

const REF = loadCid10Reference();

const realMap = buildConceptMap([
  { nct: HERO_META.nct, criteria: HERO_CRITERIA },
  { nct: NSCLC_META.nct, criteria: NSCLC_CRITERIA },
]);

describe("provenance is present and needsReview is never silent", () => {
  it("every entry carries a non-empty provenance and a valid anchoredBy", () => {
    for (const e of realMap.entries) {
      expect(e.provenance.length).toBeGreaterThan(0);
      expect(["lexical", "model", "verified"]).toContain(e.anchoredBy);
    }
  });

  it("the two shipped protocols resolve with ZERO needsReview entries", () => {
    expect(realMap.entries.filter((e) => e.needsReview).length).toBe(0);
  });

  it("any needsReview entry is surfaced — its provenance explains why", () => {
    for (const e of realMap.entries) {
      if (e.needsReview) expect(e.provenance.toLowerCase()).toContain("review");
    }
  });
});

describe("offline model fallback (build-time only)", () => {
  const unknownDx: Criterion = { id: "x_dx", kind: "inclusion", field: "diagnosis", operator: "eq", value: "glioblastoma", rawText: "Glioblastoma.", confidence: 1 };

  it("marks a model-proposed anchor as anchoredBy=model + needsReview=true", () => {
    const stub: AnchorFallback = (term) => (term.includes("glioblastoma") ? { codes: ["C71"], note: "brain" } : null);
    const e = resolveEntry(unknownDx, REF, stub);
    expect(e.anchoredBy).toBe("model");
    expect(e.needsReview).toBe(true);
    expect(e.icd10?.prefixes).toEqual(["C71"]);
    expect(e.provenance.toLowerCase()).toContain("human review");
  });

  it("without a fallback, an unresolved diagnosis stays lexical + needsReview (no model invented)", () => {
    const e = resolveEntry(unknownDx, REF);
    expect(e.anchoredBy).toBe("lexical");
    expect(e.needsReview).toBe(true);
    expect(e.icd10).toBeNull();
  });
});

describe("DETERMINISM at request time — the resolver never calls a model", () => {
  beforeEach(() => __resetConceptResolverCacheForTests());

  it("resolving an unknown diagnosis through the request-time resolver does not throw or invent a concept", () => {
    const unknown: Criterion = { id: "rt_dx", kind: "inclusion", field: "diagnosis", operator: "eq", value: "glioblastoma", rawText: "Glioblastoma.", confidence: 1 };
    // resolveConcept takes no fallback param and imports no LLM SDK — a model
    // COULD NOT be called here. It resolves to an unmapped concept, honestly.
    const concept = resolveConcept(unknown);
    expect(concept.conceptId).toBe(0);
    expect(concept.needsMapping).toBe(true);
  });
});
