import { describe, it, expect } from "vitest";
import { parseInfra, infraPresentCount, infraInput, enrichSites, SITE_INFRA_SCHEMA } from "@/lib/sites/infraEnrich";
import { directorySiteToSiteInput } from "@/lib/sites/toSiteInput";
import { Confidence } from "@/lib/metric";
import type { DirectorySite } from "@/lib/sites/directory";

describe("parseInfra", () => {
  it("maps a completed result → infra + citations + confidence", () => {
    const e = parseInfra("100", {
      status: "completed", runId: "r",
      content: { cacon_or_unacon: true, pet_ct: true, linear_accelerator: true, mri: false, icu_beds: 30, gcp_pharmacy: true },
      basis: [{ field: "pet_ct", citations: [{ url: "https://cnes.gov/x", excerpts: [] }], confidence: "high" }],
    });
    expect(e.source).toBe("parallel");
    expect(e.caconOrUnacon).toBe(true);
    expect(e.icuBeds).toBe(30);
    expect(e.mri).toBe(false);
    expect(e.citations[0].url).toBe("https://cnes.gov/x");
    expect(e.confidence).toBe(Confidence.HIGH);
    expect(infraPresentCount(e)).toBe(5); // cacon, pet, linac, icu>0, pharmacy (mri false)
  });
  it("unavailable result → empty infra, LOW", () => {
    const e = parseInfra("1", { status: "unavailable", runId: null, content: null, basis: [] });
    expect(e.source).toBe("unavailable");
    expect(e.icuBeds).toBe(0);
    expect(e.confidence).toBe(Confidence.LOW);
  });
  it("coerces a bad icu_beds to 0", () => {
    const e = parseInfra("1", { status: "completed", runId: "r", content: { icu_beds: -5 }, basis: [] });
    expect(e.icuBeds).toBe(0);
  });
});

describe("infraInput + schema", () => {
  it("schema asks for the six infra items", () => {
    expect(Object.keys(SITE_INFRA_SCHEMA.properties)).toEqual([
      "cacon_or_unacon", "pet_ct", "linear_accelerator", "mri", "icu_beds", "gcp_pharmacy",
    ]);
  });
  it("input names the site + CNES", () => {
    expect(infraInput({ cnes: "100", name: "Barretos", city: "Barretos", uf: "SP" })).toMatch(/Barretos.*CNES 100/);
  });
});

describe("enrichSites — no-op without a key", () => {
  it("returns an empty map", async () => {
    expect((await enrichSites([{ cnes: "1", name: "X" }])).size).toBe(0);
  });
});

describe("directorySiteToSiteInput uses REAL infra when available", () => {
  const site: DirectorySite = {
    id: "cnes-1", name: "S", cnes: "1", cnpj: null, city: "X", uf: "SP", region: "Sudeste",
    therapeuticAreas: ["Oncologia"], oncology: true, cepName: "CEP",
    inspections: { anvisa: false, fda: false, ema: false, any: false },
    edcExperience: false, rbmExperience: false, centralLabExams: false, centralLabImaging: false,
    piCount: 3, contactName: null, contactEmail: null, contactPhone: null, sources: ["abracro"],
  };
  it("switches infra-fit to the researched equipment (5 oncology-core items)", () => {
    const infra = new Map([["1", { caconOrUnacon: true, petCt: true, linearAccelerator: true, mri: true, icuBeds: 20, gcpPharmacy: true }]]);
    const si = directorySiteToSiteInput(site, { profile: "onc_ph3", competingByRegion: {}, infraByCnes: infra });
    expect(si.requiredEquipment).toBe(5);
    expect(si.presentEquipment).toBe(5); // all five present
  });
  it("falls back to the capability-flag proxy without infra", () => {
    const si = directorySiteToSiteInput(site, { profile: "onc_ph3", competingByRegion: {} });
    expect(si.requiredEquipment).toBe(4); // proxy scale
  });
});
