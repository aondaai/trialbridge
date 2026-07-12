import { describe, it, expect } from "vitest";
import { suggestTarget, unitFromHeader } from "@/lib/patient-intake/headerMap";

describe("suggestTarget", () => {
  it("maps common EMR header variants to Patient fields", () => {
    expect(suggestTarget("Dx")).toBe("diagnosis");
    expect(suggestTarget("Primary Diagnosis")).toBe("diagnosis");
    expect(suggestTarget("HER-2 Status")).toBe("her2_status");
    expect(suggestTarget("Perf Status")).toBe("ecog");
    expect(suggestTarget("Creatinine (mg/dL)")).toBe("creatinine");
    expect(suggestTarget("LVEF")).toBe("ejection_fraction");
    expect(suggestTarget("Age (yrs)")).toBe("age");
    expect(suggestTarget("Sex")).toBe("sex");
    expect(suggestTarget("prior lines")).toBe("priorLines");
    expect(suggestTarget("MRN")).toBe("id");
  });
  it("routes an unrecognized clinical column to 'biomarker', not 'ignore'", () => {
    expect(suggestTarget("PD-L1 TPS")).toBe("biomarker");
  });
  it("extracts a unit from a parenthesized header", () => {
    expect(unitFromHeader("Creatinine (mg/dL)")).toBe("mg/dL");
    expect(unitFromHeader("Hemoglobin")).toBeNull();
  });
});
