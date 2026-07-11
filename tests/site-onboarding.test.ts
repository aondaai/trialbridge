import { describe, it, expect } from "vitest";
import { slugify } from "@/app/site/new/parse";

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
