import { describe, it, expect } from "vitest";
import { normalizeInt, normalizeSex, normalizeMarker, normalizeStage, parseLab, slugColumn } from "@/lib/patient-intake/normalize";

describe("value normalizers", () => {
  it("normalizeInt bounds and rejects non-numbers", () => {
    expect(normalizeInt("1", 0, 5)).toBe(1);
    expect(normalizeInt(" 3 ", 0, 5)).toBe(3);
    expect(normalizeInt("9", 0, 5)).toBeNull();
    expect(normalizeInt("n/a", 0, 5)).toBeNull();
    expect(normalizeInt("", 0, 5)).toBeNull();
  });
  it("normalizeSex maps common forms", () => {
    expect(normalizeSex("F")).toBe("female");
    expect(normalizeSex("male")).toBe("male");
    expect(normalizeSex("feminino")).toBe("female");
    expect(normalizeSex("?")).toBeNull();
  });
  it("normalizeMarker maps 3+/pos/positive and neg", () => {
    expect(normalizeMarker("3+")).toBe("positive");
    expect(normalizeMarker("Positive")).toBe("positive");
    expect(normalizeMarker("neg")).toBe("negative");
    expect(normalizeMarker("unknown")).toBeNull();
  });
  it("normalizeStage extracts roman/int stage", () => {
    expect(normalizeStage("Stage IV")).toBe("IV");
    expect(normalizeStage("4")).toBe("IV");
    expect(normalizeStage("early")).toBeNull();
  });
  it("parseLab reads value+unit from the cell", () => {
    expect(parseLab("creatinine", "0.9 mg/dL", null)).toEqual({ value: 0.9, unit: "mg/dL" });
  });
  it("parseLab takes the unit from the header and canonicalizes", () => {
    // hemoglobin g/L → g/dL (÷10)
    expect(parseLab("hemoglobin", "120", "g/L")).toEqual({ value: 12, unit: "g/dL" });
  });
  it("parseLab returns null on an unparseable cell", () => {
    expect(parseLab("creatinine", "pending", null)).toBeNull();
  });
  it("slugColumn makes a snake_case key", () => {
    expect(slugColumn("PD-L1 TPS")).toBe("pd_l1_tps");
  });
});
