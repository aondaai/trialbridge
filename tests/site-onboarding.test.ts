import { describe, it, expect } from "vitest";
import { slugify, parsePatientsJson } from "@/app/site/new/parse";

describe("slugify", () => {
  it("strips diacritics, lowercases, and joins with hyphens", () => {
    expect(slugify("Clínica Norte Câncer")).toBe("clinica-norte-cancer");
  });

  it("collapses non-alphanumeric runs into a single hyphen", () => {
    expect(slugify("Hospital  São --- Paulo!!")).toBe("hospital-sao-paulo");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  ***Clínica do Sul***  ")).toBe("clinica-do-sul");
  });

  it("matches the seeded site id shape for a plain ASCII name", () => {
    expect(slugify("Site A")).toBe("site-a");
  });
});

describe("parsePatientsJson", () => {
  const validArray = JSON.stringify([
    { id: "p1", siteId: "wrong-site", diagnosis: "breast cancer" },
    { id: "p2", siteId: "wrong-site", diagnosis: "lung cancer" },
  ]);

  it("accepts a bare JSON array of patients", () => {
    const patients = parsePatientsJson(validArray, "site-x");
    expect(patients).toHaveLength(2);
    expect(patients.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("accepts an object with a patients array (data/site-*.json shape)", () => {
    const raw = JSON.stringify({
      site: { id: "site-a", name: "Whatever" },
      patients: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
    });
    const patients = parsePatientsJson(raw, "site-x");
    expect(patients).toHaveLength(3);
  });

  it("overwrites siteId on every patient with the derived site id", () => {
    const patients = parsePatientsJson(validArray, "site-x");
    expect(patients.every((p) => p.siteId === "site-x")).toBe(true);
  });

  it("rejects invalid JSON", () => {
    expect(() => parsePatientsJson("{not json", "site-x")).toThrow();
  });

  it("rejects a JSON value that is neither an array nor a {patients} object", () => {
    expect(() => parsePatientsJson(JSON.stringify({ foo: "bar" }), "site-x")).toThrow();
    expect(() => parsePatientsJson(JSON.stringify("just a string"), "site-x")).toThrow();
    expect(() => parsePatientsJson(JSON.stringify(42), "site-x")).toThrow();
  });

  it("rejects an empty array", () => {
    expect(() => parsePatientsJson(JSON.stringify([]), "site-x")).toThrow();
  });

  it("rejects a {patients} object with an empty patients array", () => {
    expect(() => parsePatientsJson(JSON.stringify({ patients: [] }), "site-x")).toThrow();
  });

  it("rejects elements missing a string id", () => {
    expect(() =>
      parsePatientsJson(JSON.stringify([{ diagnosis: "breast cancer" }]), "site-x"),
    ).toThrow();
    expect(() =>
      parsePatientsJson(JSON.stringify([{ id: 123 }]), "site-x"),
    ).toThrow();
    expect(() =>
      parsePatientsJson(JSON.stringify([{ id: "" }]), "site-x"),
    ).toThrow();
  });

  it("rejects duplicate ids within one paste", () => {
    expect(() =>
      parsePatientsJson(
        JSON.stringify([
          { id: "p1", diagnosis: "breast cancer" },
          { id: "p1", diagnosis: "lung cancer" },
        ]),
        "site-x",
      ),
    ).toThrow(/duplicate/i);
  });
});
