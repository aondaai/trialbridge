import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defaultPatientRegistry } from "@/lib/patient-intake";
import { evaluateDataset } from "@/lib/service";
import { HERO_CRITERIA, HERO_META } from "@/data/hero-protocol";

const CSV = existsSync(resolve(process.cwd(), "data", "sample-ehr.csv"))
  ? readFileSync(resolve(process.cwd(), "data", "sample-ehr.csv"), "utf8")
  : "";

describe("sample EHR CSV → Patient[] → matcher", () => {
  it("structures the committed messy sample into a realistic cohort", async () => {
    expect(CSV).not.toBe("");
    const r = await defaultPatientRegistry().structure({ kind: "text", text: CSV });
    expect(r.patients.length).toBeGreaterThan(50);
    // Messy units handled: hemoglobin g/L in the CSV is canonicalized to g/dL.
    const withHgb = r.patients.find((p) => p.labs.hemoglobin);
    expect(withHgb?.labs.hemoglobin?.unit).toBe("g/dL");
  });

  it("imperfect structuring lands rows in possible/definite, not silently excluded", async () => {
    const r = await defaultPatientRegistry().structure({ kind: "text", text: CSV });
    const patients = r.patients.map((p) => ({ ...p, siteId: "sample" }));
    const ds = { site: { id: "sample", name: "Sample", country: "BR", city: "SP", region: "Sudeste", persona: "", monthlyIncidence: 10 }, patients };
    const { counts } = evaluateDataset(ds, HERO_CRITERIA);
    expect(counts.definite + counts.possible).toBeGreaterThan(0);
    expect(HERO_META.nct).toBeTruthy(); // sanity: criteria fixture loaded
  });
});
