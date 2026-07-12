import { describe, it, expect } from "vitest";
import { stampBaseFit } from "@/lib/basefit/registry";
import type { Criterion } from "@/lib/matcher/types";

const rows: Criterion[] = [
  { id: "c1", kind: "inclusion", field: "her2_status", operator: "eq", value: "positive", rawText: "HER2+", confidence: 0.9 },
  { id: "c2", kind: "inclusion", field: "ecog", operator: "lte", value: 1, rawText: "ECOG<=1", confidence: 0.9 },
  { id: "c3", kind: "inclusion", field: "age", operator: "gte", value: 18, rawText: "Age>=18", confidence: 0.98 },
  { id: "c4", kind: "exclusion", field: "some_unmapped_thing", operator: "exists", value: null, rawText: "x", confidence: 0.5 },
];

describe("stampBaseFit", () => {
  const out = stampBaseFit(rows);
  it("stamps depth/checkable via alias + registry", () => {
    expect(out[0].baseFit).toBe("depth");        // her2_status -> her2
    expect(out[1].baseFit).toBe("depth");        // ecog
    expect(out[2].baseFit).toBe("checkable");    // age
  });
  it("marks unmapped fields not_answerable with no nlpTerms", () => {
    expect(out[3].baseFit).toBe("not_answerable");
    expect(out[3].nlpTerms).toBeUndefined();
  });
  it("preserves original fields (id, value, rawText)", () => {
    expect(out[2].id).toBe("c3");
    expect(out[2].value).toBe(18);
  });
});
