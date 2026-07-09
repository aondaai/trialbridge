import { describe, it, expect } from "vitest";
import {
  anchorLexical,
  classifyAnswerability,
  expandPrefixes,
  expandMembers,
  normalizeTerm,
  loadCid10Reference,
  stripMeta,
  type Cid10Reference,
} from "@/lib/omop/cid10";

const REF = loadCid10Reference();

describe("cid10 reference", () => {
  it("loads without the _meta key and covers the golden categories", () => {
    expect(REF._meta).toBeUndefined();
    expect(REF.C50).toBeTruthy();
    expect(REF.C34).toBeTruthy();
    expect(REF.C33).toBeTruthy();
  });

  it("stripMeta removes only _meta", () => {
    const r = stripMeta({ _meta: { x: 1 }, C50: { title: "t", synonyms: [] } });
    expect(r._meta).toBeUndefined();
    expect(r.C50).toBeTruthy();
  });
});

describe("normalizeTerm", () => {
  it("lowercases, strips punctuation and diacritics", () => {
    expect(normalizeTerm("HER2-positive")).toBe("her2 positive");
    expect(normalizeTerm("Câncer de Pulmão")).toBe("cancer de pulmao");
  });
});

describe("anchorLexical (the fuzzy step, made conservative)", () => {
  it("resolves 'breast cancer' to exactly [C50]", () => {
    const r = anchorLexical("breast cancer", REF);
    expect(r.codes).toEqual(["C50"]);
    expect(r.matchedOn).toBe("exact");
  });

  it("resolves 'lung cancer' to [C33, C34] (trachea+bronchus grouping)", () => {
    const r = anchorLexical("lung cancer", REF);
    expect(r.codes).toEqual(["C33", "C34"]);
  });

  it("resolves a longer NSCLC phrase via the shared 'lung' token", () => {
    const r = anchorLexical("nonsquamous non-small cell lung cancer", REF);
    expect(r.codes).toContain("C34");
  });

  it("resolves the pt-BR label 'câncer de mama' to [C50]", () => {
    expect(anchorLexical("câncer de mama", REF).codes).toEqual(["C50"]);
  });

  it("does NOT anchor a bare generic term", () => {
    const r = anchorLexical("cancer", REF);
    expect(r.codes).toEqual([]);
    expect(r.matchedOn).toBeNull();
  });

  it("returns empty for an unknown diagnosis (→ needsReview downstream)", () => {
    expect(anchorLexical("glioblastoma multiforme", REF).codes).toEqual([]);
  });
});

describe("expandPrefixes / expandMembers", () => {
  it("prefixes are the distinct sorted 3-char categories (the LIKE join key)", () => {
    expect(expandPrefixes(["C34", "C33", "C34"])).toEqual(["C33", "C34"]);
    expect(expandPrefixes(["c509"])).toEqual(["C50"]);
  });

  it("members include every reference code under the prefixes", () => {
    const smallRef: Cid10Reference = {
      C50: { title: "breast", synonyms: [] },
      C509: { title: "breast nos", synonyms: [] },
      C34: { title: "lung", synonyms: [] },
    };
    expect(expandMembers(["C50"], smallRef)).toEqual(["C50", "C509"]);
  });
});

describe("classifyAnswerability", () => {
  it("dx/age/sex → datasus (base cohort strata)", () => {
    expect(classifyAnswerability("diagnosis")).toBe("datasus");
    expect(classifyAnswerability("age")).toBe("datasus");
    expect(classifyAnswerability("sex")).toBe("datasus");
  });

  it("biomarkers / performance status / stage → depth (estimated)", () => {
    for (const f of ["her2_status", "ecog", "stage", "autoimmune", "kras_g12c", "pdl1_status", "prior_lines"]) {
      expect(classifyAnswerability(f)).toBe("depth");
    }
  });
});
