import { describe, it, expect, beforeEach } from "vitest";
import { parseCriteria } from "@/lib/parse";
import { stampBaseFit } from "@/lib/basefit/registry";
import { HERO_CRITERIA, HERO_META } from "@/data/hero-protocol";
import { NSCLC_CRITERIA, NSCLC_META } from "@/data/nsclc-kras-protocol";

describe("parse service — cached fallback (no API key)", () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("falls back to the cached verified criteria when the nctId matches a known fixture", async () => {
    const result = await parseCriteria("Age >= 18 years.\nHER2-positive.", HERO_META.nct);
    expect(result.source).toBe("cached");
    expect(result.criteria).toEqual(stampBaseFit(HERO_CRITERIA));
    expect(result.criteria.length).toBeGreaterThan(0);
    expect(result.note).toMatch(/ANTHROPIC_API_KEY not set/);
  });

  it("matches fixtures by nctId regardless of casing/whitespace", async () => {
    const result = await parseCriteria("anything", `  ${NSCLC_META.nct.toLowerCase()}  `);
    expect(result.source).toBe("cached");
    expect(result.criteria).toEqual(stampBaseFit(NSCLC_CRITERIA));
  });

  it("returns criteria the deterministic matcher can consume (shape check)", async () => {
    const { criteria } = await parseCriteria("anything", HERO_META.nct);
    for (const c of criteria) {
      expect(["inclusion", "exclusion"]).toContain(c.kind);
      expect(typeof c.field).toBe("string");
      expect(typeof c.rawText).toBe("string");
    }
  });

  it("throws instead of attaching an unrelated trial's cached criteria when nctId is missing", async () => {
    await expect(parseCriteria("Some unrelated protocol text.")).rejects.toThrow(
      /isn't one of the verified cached fixtures/,
    );
  });

  it("throws when nctId doesn't match any cached fixture", async () => {
    await expect(parseCriteria("Some unrelated protocol text.", "NCT00000102")).rejects.toThrow(
      /isn't one of the verified cached fixtures/,
    );
  });
});
