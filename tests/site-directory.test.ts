import { describe, it, expect } from "vitest";
import {
  dddToUf,
  ufToRegion,
  truthy,
  normName,
  parseAbracro,
  parseAcesse,
  mergeDirectory,
  directoryStats,
} from "@/lib/sites/directory";

describe("geography helpers", () => {
  it("dddToUf maps area codes (with or without country code / formatting)", () => {
    expect(dddToUf("7132371311")).toBe("BA");
    expect(dddToUf("62 3252 5549")).toBe("GO");
    expect(dddToUf("+55 11 98765-4321")).toBe("SP");
    expect(dddToUf("2835225095")).toBe("ES");
    expect(dddToUf("")).toBeNull();
    expect(dddToUf(null)).toBeNull();
  });
  it("ufToRegion maps UF → macro-region", () => {
    expect(ufToRegion("SP")).toBe("Sudeste");
    expect(ufToRegion("rs")).toBe("Sul");
    expect(ufToRegion("PE")).toBe("Nordeste");
    expect(ufToRegion("DF")).toBe("Centro-Oeste");
    expect(ufToRegion("AM")).toBe("Norte");
    expect(ufToRegion("ZZ")).toBeNull();
  });
  it("truthy accepts True/1/sim/x", () => {
    expect(truthy("True")).toBe(true);
    expect(truthy("sim")).toBe(true);
    expect(truthy("False")).toBe(false);
    expect(truthy("")).toBe(false);
  });
});

// Build a 42-column ABRACRO row.
function abracroRow(over: Record<number, string>): string[] {
  const r = new Array(42).fill("");
  Object.entries(over).forEach(([i, v]) => (r[Number(i)] = v));
  return r;
}
const ABRACRO_HEADER = new Array(42).fill("h");

describe("parseAbracro", () => {
  it("maps institution, CNES, therapeutic areas, oncology, inspections, UF-from-phone", () => {
    const row = abracroRow({
      0: "Dr. Contact", 2: "10", 3: "7132371311", 5: "c@x.com",
      17: "True", 6: "True", // Oncologia + Alergia
      28: "HOSPITAL X", 29: "3816", 32: "CEP-X",
      33: "True", 36: "True", 38: "True", // EDC + ANVISA + EMA
    });
    const [s] = parseAbracro([ABRACRO_HEADER, row]);
    expect(s.name).toBe("HOSPITAL X");
    expect(s.cnes).toBe("3816");
    expect(s.oncology).toBe(true);
    expect(s.therapeuticAreas).toContain("Oncologia");
    expect(s.therapeuticAreas).toContain("Alergia/Imunologia");
    expect(s.uf).toBe("BA"); // from DDD 71
    expect(s.region).toBe("Nordeste");
    expect(s.inspections).toEqual({ anvisa: true, fda: false, ema: true, any: true });
    expect(s.edcExperience).toBe(true);
    expect(s.piCount).toBe(10);
    expect(s.sources).toEqual(["abracro"]);
    expect(s.id).toBe("cnes-3816");
  });

  it("skips rows with no institution", () => {
    expect(parseAbracro([ABRACRO_HEADER, abracroRow({ 0: "orphan contact" })])).toHaveLength(0);
  });
});

function acesseRow(over: Record<number, string>): string[] {
  const r = new Array(8).fill("");
  Object.entries(over).forEach(([i, v]) => (r[Number(i)] = v));
  return r;
}

describe("parseAcesse", () => {
  it("maps company, CNPJ, city, UF → region", () => {
    const [s] = parseAcesse([new Array(8).fill("h"), acesseRow({ 3: "14.940.896/0001-01", 4: "CEMEC", 6: "São Bernardo", 7: "SP" })]);
    expect(s.name).toBe("CEMEC");
    expect(s.cnpj).toBe("14940896000101");
    expect(s.city).toBe("São Bernardo");
    expect(s.uf).toBe("SP");
    expect(s.region).toBe("Sudeste");
    expect(s.sources).toEqual(["acesse"]);
  });
});

describe("mergeDirectory", () => {
  it("dedupes by CNES and unions therapeutic areas + sources + inspections", () => {
    const a = parseAbracro([ABRACRO_HEADER, abracroRow({ 17: "True", 28: "HOSP", 29: "1234", 36: "True" })]);
    const b = parseAbracro([ABRACRO_HEADER, abracroRow({ 7: "True", 28: "HOSP (unidade 2)", 29: "1234", 37: "True" })]);
    const merged = mergeDirectory(a, b);
    expect(merged).toHaveLength(1);
    expect(merged[0].cnes).toBe("1234");
    expect(merged[0].inspections.anvisa && merged[0].inspections.fda).toBe(true);
    expect(merged[0].therapeuticAreas.sort()).toEqual(["Cardiovascular", "Oncologia"]);
  });

  it("dedupes by normalized name when CNES is absent (cross-list overlap)", () => {
    const abr = parseAbracro([ABRACRO_HEADER, abracroRow({ 28: "Instituto XYZ" })]); // no cnes
    const ace = parseAcesse([new Array(8).fill("h"), acesseRow({ 4: "INSTITUTO XYZ", 7: "SP" })]);
    const merged = mergeDirectory(abr, ace);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources.sort()).toEqual(["abracro", "acesse"]);
    expect(normName("Instituto XYZ")).toBe(normName("INSTITUTO XYZ"));
  });
});

describe("directoryStats", () => {
  it("counts totals, cnes, oncology, regions", () => {
    const sites = mergeDirectory(
      parseAbracro([ABRACRO_HEADER, abracroRow({ 17: "True", 28: "A", 29: "1", 3: "1132000000" })]),
      parseAcesse([new Array(8).fill("h"), acesseRow({ 4: "B", 7: "RS" })]),
    );
    const st = directoryStats(sites);
    expect(st.total).toBe(2);
    expect(st.oncology).toBe(1);
    expect(st.withCnes).toBe(1);
    expect(st.byRegion.Sul).toBe(1);
    expect(st.byRegion.Sudeste).toBe(1);
  });
});
