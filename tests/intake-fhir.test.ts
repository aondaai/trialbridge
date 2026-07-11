import { describe, it, expect } from "vitest";
import { defaultRegistry } from "@/lib/intake";
import { fhirAdapter } from "@/lib/intake/adapters/fhir";
import { FHIR_EVIDENCE_VARIABLE } from "@/data/intakeFixtures";

describe("fhir adapter — structured lane (skips the LLM)", () => {
  it("detects an EvidenceVariable and a Bundle wrapping one, rejects other json", () => {
    expect(fhirAdapter.detect({ kind: "json", data: FHIR_EVIDENCE_VARIABLE })).toBe(1);
    expect(
      fhirAdapter.detect({
        kind: "json",
        data: { resourceType: "Bundle", entry: [{ resource: FHIR_EVIDENCE_VARIABLE }] },
      }),
    ).toBe(1);
    expect(fhirAdapter.detect({ kind: "json", data: { resourceType: "Patient" } })).toBe(0);
    expect(fhirAdapter.detect({ kind: "text", text: "{}" })).toBe(0);
  });

  it("maps every characteristic to a typed Criterion on the preParsedCriteria lane", async () => {
    const result = await defaultRegistry().ingest({ kind: "json", data: FHIR_EVIDENCE_VARIABLE });

    expect(result.provenance).toMatchObject({ adapter: "fhir", extraction: "structured", trust: "high" });
    expect(result.eligibilityText).toBeUndefined(); // structured → no LLM lane
    const c = result.preParsedCriteria!;
    expect(c).toHaveLength(5);

    expect(c[0]).toMatchObject({ field: "age", operator: "gte", value: 18, unit: "years", kind: "inclusion" });
    expect(c[1]).toMatchObject({ field: "ecog", operator: "between", value: [0, 1], kind: "inclusion" });
    expect(c[2]).toMatchObject({ field: "her2_status", operator: "eq", value: "positive", kind: "inclusion" });
    expect(c[3]).toMatchObject({ field: "brain_metastases", operator: "exists", kind: "exclusion" });
    expect(c[4]).toMatchObject({ field: "ejection_fraction", operator: "lt", value: 50, unit: "%", kind: "exclusion" });

    // Cleanly-mapped known fields are high-confidence (few verify flags).
    expect(c.every((x) => x.confidence === 0.9)).toBe(true);
  });

  it("gives unknown/free-text fields a LOWER confidence so they still surface in verify", async () => {
    const ev = {
      resourceType: "EvidenceVariable",
      id: "ev-x",
      characteristic: [
        { description: "Some bespoke biomarker present", definitionByTypeAndValue: { type: { text: "Bespoke marker XYZ" }, valueBoolean: true } },
      ],
    };
    const { preParsedCriteria } = await fhirAdapter.extract({ kind: "json", data: ev });
    expect(preParsedCriteria![0].confidence).toBe(0.6);
    expect(preParsedCriteria![0].field).toBe("bespoke_marker_xyz");
  });

  it("does not present a NaN/missing quantity as high-confidence (honesty)", async () => {
    const ev = {
      resourceType: "EvidenceVariable",
      id: "ev-nan",
      characteristic: [
        // Recognized field (age) but the quantity has no usable value → NaN.
        { description: "Age threshold", definitionByTypeAndValue: { type: { text: "Age" }, valueQuantity: { comparator: ">=" } } },
      ],
    };
    const { preParsedCriteria } = await fhirAdapter.extract({ kind: "json", data: ev });
    // A known field would normally be 0.9; the unusable value must drop it to 0.6.
    expect(preParsedCriteria![0].confidence).toBe(0.6);
  });

  it("maps a one-sided FHIR valueRange to a bound (>= low), not [low, NaN]", async () => {
    const ev = {
      resourceType: "EvidenceVariable",
      id: "ev-range",
      characteristic: [
        { description: "Age >= 50", definitionByTypeAndValue: { type: { text: "Age" }, valueRange: { low: { value: 50, unit: "years" } } } },
      ],
    };
    const { preParsedCriteria } = await fhirAdapter.extract({ kind: "json", data: ev });
    expect(preParsedCriteria![0]).toMatchObject({ field: "age", operator: "gte", value: 50, confidence: 0.9 });
  });

  it("produces criteria the matcher's Criterion shape accepts (contract check)", async () => {
    const { preParsedCriteria } = await fhirAdapter.extract({ kind: "json", data: FHIR_EVIDENCE_VARIABLE });
    for (const x of preParsedCriteria!) {
      expect(["inclusion", "exclusion"]).toContain(x.kind);
      expect(typeof x.id).toBe("string");
      expect(typeof x.field).toBe("string");
      expect(typeof x.confidence).toBe("number");
    }
  });
});
