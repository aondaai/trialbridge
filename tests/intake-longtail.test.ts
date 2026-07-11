import { describe, it, expect } from "vitest";
import { defaultRegistry } from "@/lib/intake";
import { xlsxRows } from "@/lib/intake/adapters/xlsx";
import { evaluatePatient } from "@/lib/matcher/engine";
import type { Patient } from "@/lib/matcher/types";
import { ATLAS_COHORT } from "@/data/intakeFixtures";
import { makeEctd, makeXlsx } from "./helpers/fixtures";

const PROTOCOL = `Study Population

Inclusion Criteria:
- Age >= 18 years.
- HER2-positive (IHC 3+).

Exclusion Criteria:
- Active brain metastases.

Study Design
Randomized.
`;

describe("eCTD adapter (Phase 4)", () => {
  it("digs the Module 5 protocol PDF out of the package and extracts eligibility", async () => {
    const result = await defaultRegistry().ingest({
      kind: "file",
      filename: "submission.zip",
      bytes: makeEctd(PROTOCOL),
    });
    expect(result.provenance.adapter).toBe("ectd");
    expect(result.provenance.trust).toBe("low");
    expect(result.eligibilityText).toMatch(/Inclusion Criteria/);
    expect(result.eligibilityText).toMatch(/Active brain metastases/);
    expect(result.eligibilityText).not.toMatch(/Study Design/);
  });
});

describe("XLSX adapter (Phase 4)", () => {
  const MATRIX = [
    ["kind", "field", "operator", "value", "unit"],
    ["inclusion", "age", ">=", "18", "years"],
    ["inclusion", "her2_status", "eq", "positive", ""],
    ["exclusion", "ejection_fraction", "<", "50", "%"],
  ];

  it("reads worksheet rows (shared/inline strings)", () => {
    const rows = xlsxRows(makeXlsx(MATRIX));
    expect(rows[0]).toEqual(["kind", "field", "operator", "value", "unit"]);
    expect(rows[1][1]).toBe("age");
  });

  it("maps a structured criteria matrix straight to preParsedCriteria", async () => {
    const result = await defaultRegistry().ingest({ kind: "file", filename: "elig.xlsx", bytes: makeXlsx(MATRIX) });
    expect(result.provenance.adapter).toBe("xlsx");
    expect(result.preParsedCriteria).toHaveLength(3);
    expect(result.preParsedCriteria![0]).toMatchObject({ field: "age", operator: "gte", value: 18, unit: "years", kind: "inclusion" });
    expect(result.preParsedCriteria![2]).toMatchObject({ field: "ejection_fraction", operator: "lt", value: 50, kind: "exclusion" });
  });

  it("falls back to flattened text when the sheet is not a criteria matrix (edge case)", async () => {
    const freeform = makeXlsx([["Notes"], ["Inclusion Criteria:"], ["Age >= 18"], ["Exclusion Criteria:"], ["Brain mets"]]);
    const result = await defaultRegistry().ingest({ kind: "file", filename: "notes.xlsx", bytes: freeform });
    expect(result.preParsedCriteria).toBeUndefined();
    expect(result.eligibilityText).toMatch(/Age >= 18/);
  });
});

describe("ATLAS cohort adapter (Phase 4)", () => {
  it("approximates inclusion rules + age into low-confidence criteria (flagged for verify)", async () => {
    const result = await defaultRegistry().ingest({ kind: "json", data: ATLAS_COHORT, filename: "cohort.json" });
    expect(result.provenance.adapter).toBe("atlas");
    const c = result.preParsedCriteria!;
    expect(c[0]).toMatchObject({ field: "age", operator: "gte", value: 18 });
    // The 3 inclusion rules become criteria — but NOT `exists` (see below).
    expect(c).toHaveLength(4);
    // Everything approximated from ATLAS logic is low-confidence.
    expect(c.every((x) => x.confidence <= 0.6)).toBe(true);
  });

  it("does NOT use `exists` inclusion on unmappable fields (would hard-exclude everyone)", async () => {
    const { preParsedCriteria } = await defaultRegistry().ingest({ kind: "json", data: ATLAS_COHORT, filename: "cohort.json" });
    // The bug: `exists` inclusion on a field absent from the patient schema
    // resolves to `fail` → excluded. None of the rule criteria may use it.
    for (const x of preParsedCriteria!.filter((k) => k.field !== "age")) {
      expect(x.operator).not.toBe("exists");
    }

    // End-to-end proof against the real engine: a patient who carries NONE of
    // the ATLAS slug fields must land in "possible" (unknown), never "excluded".
    const patient: Patient = {
      id: "p1", siteId: "s", diagnosis: "breast cancer", stage: "IV",
      biomarkers: {}, priorLines: 2, ecog: 1, labs: {}, sex: "female", age: 55,
    };
    const cohort = evaluatePatient(patient, preParsedCriteria!).cohort;
    expect(cohort).toBe("possible");
    expect(cohort).not.toBe("excluded");
  });
});
