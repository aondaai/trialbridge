import { describe, it, expect } from "vitest";
import { normalize } from "@/lib/parse";

// Representative IAM1363 (NCT06253871) parse output — offline, no live key.
const RAW = [
  { kind: "inclusion", field: "age", operator: "gte", value: 18, unit: "years", rawText: "Age >= 18", confidence: 0.98 },
  { kind: "inclusion", field: "her2", operator: "exists", value: null, unit: null, rawText: "HER2-altered", confidence: 0.8 },
  { kind: "inclusion", field: "ecog", operator: "in", value: [0, 1], unit: null, rawText: "ECOG 0-1", confidence: 0.9 },
  { kind: "exclusion", field: "hiv", operator: "exists", value: null, unit: null, rawText: "HIV infection", confidence: 0.7 },
  { kind: "exclusion", field: "solid_organ_transplant", operator: "exists", value: null, unit: null, rawText: "transplant", confidence: 0.7 },
  { kind: "inclusion", field: "able_to_swallow", operator: "exists", value: null, unit: null, rawText: "able to swallow", confidence: 0.5 },
] as const;

describe("normalize stamps base-fit", () => {
  const rows = normalize(RAW as never);
  const by = (f: string) => rows.find((r) => r.field === f)!;

  it("checkable / depth for real features", () => {
    expect(by("age").baseFit).toBe("checkable");
    expect(by("her2").baseFit).toBe("depth");
    expect(by("ecog").baseFit).toBe("depth");
  });
  it("nlp_extractable with pt-BR terms for catalog comorbidities", () => {
    expect(by("hiv").baseFit).toBe("nlp_extractable");
    expect(by("hiv").nlpTerms).toContain("HIV");
    expect(by("solid_organ_transplant").baseFit).toBe("nlp_extractable");
  });
  it("not_answerable for out-of-vocabulary concepts", () => {
    expect(by("able_to_swallow").baseFit).toBe("not_answerable");
    expect(by("able_to_swallow").nlpTerms).toBeUndefined();
  });
  it("derives evaluability from the tier", () => {
    expect(by("age").evaluability).toBe("pass_able");
    expect(by("hiv").evaluability).toBe("partial");
    expect(by("able_to_swallow").evaluability).toBe("not_evaluable");
  });
});
