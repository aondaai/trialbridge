import { describe, it, expect } from "vitest";
import { defaultPatientRegistry } from "@/lib/patient-intake";

const CSV = [
  "MRN,Dx,Age (yrs),Sex,Perf Status,HER-2 Status,Creatinine (mg/dL),Hemoglobin,PD-L1 TPS",
  "p1,Breast cancer,54,F,1,3+,0.8,13.1,40%",
  "p2,Breast cancer,,M,4,neg,pending,11.0,",
].join("\n");

describe("csv patient adapter", () => {
  it("structures CSV rows into Patient[] with correct slots", async () => {
    const r = await defaultPatientRegistry().structure({ kind: "text", text: CSV });
    expect(r.provenance.adapter).toBe("csv");
    expect(r.patients).toHaveLength(2);
    const p1 = r.patients[0];
    expect(p1).toMatchObject({ id: "p1", diagnosis: "Breast cancer", age: 54, sex: "female", ecog: 1 });
    expect(p1.biomarkers.her2_status).toBe("positive");
    expect(p1.biomarkers.pd_l1_tps).toBe("40%");
    expect(p1.labs.creatinine).toEqual({ value: 0.8, unit: "mg/dL" });
  });

  it("turns unparseable/blank cells into null (→ unknown), counted in stats", async () => {
    const r = await defaultPatientRegistry().structure({ kind: "text", text: CSV });
    const p2 = r.patients[1];
    expect(p2.age).toBeNull();            // blank age
    expect(p2.ecog).toBe(4);              // 4 is in range 0..4 — valid value
    expect(p2.labs.creatinine).toBeNull(); // "pending"
    expect(p2.biomarkers.pd_l1_tps).toBeNull(); // blank
    expect(r.stats.cellsUnparsed).toBeGreaterThan(0);
    expect(r.stats.rows).toBe(2);
  });

  it("respects a mapping override (force a column to 'ignore')", async () => {
    const r = await defaultPatientRegistry().structure({ kind: "text", text: CSV }, { "PD-L1 TPS": "ignore" });
    expect(r.patients[0].biomarkers.pd_l1_tps).toBeUndefined();
    expect(r.stats.columnsIgnored).toBeGreaterThan(0);
  });
});
