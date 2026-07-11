import { describe, it, expect } from "vitest";
import { slugify, ensureUniquePatientIds } from "@/app/site/new/parse";
import type { Patient } from "@/lib/matcher/types";

function makePatient(id: string): Patient {
  return {
    id, siteId: "", diagnosis: "breast cancer", stage: "IV",
    biomarkers: {}, priorLines: 2, ecog: 1, labs: {}, sex: "female", age: 55,
  };
}

describe("ensureUniquePatientIds", () => {
  it("assigns row-N ids when the id is blank/missing", () => {
    const result = ensureUniquePatientIds([makePatient(""), makePatient("")]);
    expect(result.map((p) => p.id)).toEqual(["row-1", "row-2"]);
  });

  it("suffixes a duplicate id so the second occurrence is unique", () => {
    const result = ensureUniquePatientIds([makePatient("p1"), makePatient("p1")]);
    expect(result.map((p) => p.id)).toEqual(["p1", "p1-2"]);
  });

  it("keeps ids unique when a source id collides with a generated blank id", () => {
    // Row 1 is blank -> would become "row-1"; row 2 already has a blank id too
    // that would collide with "row-2"; row 3 supplies the literal id "row-2".
    const result = ensureUniquePatientIds([makePatient(""), makePatient(""), makePatient("row-2")]);
    const ids = result.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["row-1", "row-2", "row-2-2"]);
  });

  it("leaves already-unique ids unchanged", () => {
    const result = ensureUniquePatientIds([makePatient("a"), makePatient("b"), makePatient("c")]);
    expect(result.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
});

describe("slugify", () => {
  it("strips diacritics, lowercases, and joins with hyphens", () => {
    expect(slugify("Clínica Norte Câncer")).toBe("clinica-norte-cancer");
  });

  it("collapses non-alphanumeric runs into a single hyphen", () => {
    expect(slugify("Hospital  São --- Paulo!!")).toBe("hospital-sao-paulo");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  ***Clínica do Sul***  ")).toBe("clinica-do-sul");
  });

  it("matches the seeded site id shape for a plain ASCII name", () => {
    expect(slugify("Site A")).toBe("site-a");
  });
});
