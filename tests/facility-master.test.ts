import { describe, expect, it } from "vitest";
import {
  buildFacilityMaster,
  cnesIdentifier,
  cnpjIdentifier,
  isValidCnpj,
  normalizeFacilityName,
  normalizeUf,
  sourceRecordId,
  type FacilitySourceRecord,
} from "@/lib/facilities/master";

function record(overrides: Partial<FacilitySourceRecord> & Pick<FacilitySourceRecord, "source" | "sourceKey" | "name">): FacilitySourceRecord {
  const { source, sourceKey, name, ...rest } = overrides;
  const sourceRecordIdValue = sourceRecordId(source, sourceKey);
  return {
    sourceRecordId: sourceRecordIdValue,
    source,
    sourceKey,
    name,
    normalizedName: normalizeFacilityName(name),
    city: null,
    uf: null,
    geoMethod: "unknown",
    membershipStatus: "unknown",
    isPlaceholder: false,
    identifiers: [],
    observations: [],
    trialRefs: [],
    activeTrialCount: 0,
    ...rest,
  };
}

describe("facility master normalization", () => {
  it("normalizes institution aliases and Brazilian states deterministically", () => {
    expect(normalizeFacilityName("Fundação Hospital Universitário")).toBe("fundacion hospital universitario");
    expect(normalizeUf("São Paulo")).toBe("SP");
    expect(normalizeUf("rj")).toBe("RJ");
  });

  it("validates CNES structurally and CNPJ check digits", () => {
    const rid = "r1";
    expect(cnesIdentifier("2.090.236", rid)).toMatchObject({ value: "2090236", validationStatus: "valid" });
    expect(cnesIdentifier("3816", rid)).toMatchObject({ value: "3816", validationStatus: "invalid" });
    expect(isValidCnpj("14.940.896/0001-01")).toBe(true);
    expect(cnpjIdentifier("09.219.229/001-96", rid)).toMatchObject({ validationStatus: "invalid" });
  });
});

describe("facility master resolution", () => {
  it("merges records only on validated identifiers", () => {
    const omop = record({ source: "omop_care_site", sourceKey: "2090236", name: "Fundacao Pio XII", city: "Barretos", uf: "SP", geoMethod: "official" });
    omop.identifiers = [cnesIdentifier("2090236", omop.sourceRecordId)!];
    const abracro = record({ source: "abracro", sourceKey: "pio", name: "Hospital de Amor", uf: "SP", geoMethod: "ddd" });
    abracro.identifiers = [cnesIdentifier("2090236", abracro.sourceRecordId)!];
    const result = buildFacilityMaster([omop, abracro]);
    expect(result.facilities).toHaveLength(1);
    expect(result.facilities[0]).toMatchObject({ facilityId: "fac-br-cnes-2090236", canonicalName: "Fundacao Pio XII", reportDisplayName: "Hospital de Amor", city: "Barretos", uf: "SP" });
    expect(result.facilities[0].sources.sort()).toEqual(["abracro", "omop_care_site"]);
  });

  it("does not merge invalid CNES values and records the identifier issue", () => {
    const a = record({ source: "abracro", sourceKey: "a", name: "Hospital A" });
    const b = record({ source: "omop_care_site", sourceKey: "b", name: "Hospital B" });
    a.identifiers = [cnesIdentifier("3816", a.sourceRecordId)!];
    b.identifiers = [cnesIdentifier("3816", b.sourceRecordId)!];
    const result = buildFacilityMaster([a, b]);
    expect(result.facilities).toHaveLength(2);
    expect(result.issues.filter((item) => item.kind === "invalid_identifier")).toHaveLength(2);
  });

  it("links association records to registry sites through the explicit SiteMap identifier", () => {
    const site = record({ source: "sitemap", sourceKey: "br-sp-hospital-x", name: "Hospital X", city: "Sao Paulo", uf: "SP", geoMethod: "registry" });
    site.identifiers = [{ system: "SITEMAP", value: "br-sp-hospital-x", validationStatus: "valid", sourceRecordId: site.sourceRecordId }];
    const association = record({ source: "acesse", sourceKey: "1", name: "Hospital X Pesquisa", city: "São Paulo", uf: "SP", geoMethod: "declared" });
    association.identifiers = [
      { system: "SITEMAP", value: "br-sp-hospital-x", validationStatus: "valid", sourceRecordId: association.sourceRecordId },
      cnpjIdentifier("14.940.896/0001-01", association.sourceRecordId)!,
    ];
    const result = buildFacilityMaster([site, association]);
    expect(result.facilities).toHaveLength(1);
    expect(result.facilities[0].sources.sort()).toEqual(["acesse", "sitemap"]);
  });

  it("blocks a transitive registry link from merging two distinct valid CNES values", () => {
    const siteMapId = "br-xx-infection-control";
    const site = record({ source: "sitemap", sourceKey: siteMapId, name: "Infection Control", geoMethod: "registry" });
    site.identifiers = [{ system: "SITEMAP", value: siteMapId, validationStatus: "valid", sourceRecordId: site.sourceRecordId }];
    const first = record({ source: "abracro", sourceKey: "first", name: "Infection Control" });
    first.identifiers = [
      cnesIdentifier("7210000", first.sourceRecordId)!,
      { system: "SITEMAP", value: siteMapId, validationStatus: "valid", sourceRecordId: first.sourceRecordId },
    ];
    const second = record({ source: "abracro", sourceKey: "second", name: "Infection Control" });
    second.identifiers = [
      cnesIdentifier("0358223", second.sourceRecordId)!,
      { system: "SITEMAP", value: siteMapId, validationStatus: "valid", sourceRecordId: second.sourceRecordId },
    ];
    const result = buildFacilityMaster([site, first, second]);
    expect(result.facilities).toHaveLength(2);
    expect(result.facilities.map((facility) => facility.facilityId).sort()).toEqual(["fac-br-cnes-0358223", "fac-br-cnes-7210000"]);
    expect(result.issues).toContainEqual(expect.objectContaining({ kind: "identifier_conflict", severity: "high" }));
  });

  it("keeps conflicting geography visible and prefers the official location", () => {
    const omop = record({ source: "omop_care_site", sourceKey: "2058391", name: "Hospital Israelita Albert Einstein", city: "Sao Paulo", uf: "SP", geoMethod: "official" });
    omop.identifiers = [cnesIdentifier("2058391", omop.sourceRecordId)!];
    const abracro = record({ source: "abracro", sourceKey: "einstein", name: "Hospital Israelita Albert Einstein", uf: "RJ", geoMethod: "ddd" });
    abracro.identifiers = [cnesIdentifier("2058391", abracro.sourceRecordId)!];
    const result = buildFacilityMaster([omop, abracro]);
    expect(result.facilities[0].uf).toBe("SP");
    expect(result.issues).toContainEqual(expect.objectContaining({ kind: "geography_conflict", severity: "high" }));
  });

  it("does not auto-merge exact names without a validated identifier", () => {
    const a = record({ source: "sitemap", sourceKey: "a", name: "Centro Pesquisa X", city: "Curitiba", uf: "PR", geoMethod: "registry" });
    const b = record({ source: "acesse", sourceKey: "b", name: "Centro Pesquisa X", city: "Curitiba", uf: "PR", geoMethod: "declared" });
    const result = buildFacilityMaster([a, b]);
    expect(result.facilities).toHaveLength(2);
    expect(result.issues).toContainEqual(expect.objectContaining({ kind: "possible_duplicate" }));
  });
});
