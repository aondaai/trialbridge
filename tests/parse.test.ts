import { describe, it, expect, beforeEach } from "vitest";
import { parseCriteria } from "@/lib/parse";
import { HERO_CRITERIA } from "@/data/hero-protocol";

describe("parse service — cached fallback (no API key)", () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("falls back to the cached verified criteria when no key is set", async () => {
    const result = await parseCriteria("Age >= 18 years.\nHER2-positive.");
    expect(result.source).toBe("cached");
    expect(result.criteria).toEqual(HERO_CRITERIA);
    expect(result.criteria.length).toBeGreaterThan(0);
    expect(result.note).toMatch(/ANTHROPIC_API_KEY not set/);
  });

  it("returns criteria the deterministic matcher can consume (shape check)", async () => {
    const { criteria } = await parseCriteria("anything");
    for (const c of criteria) {
      expect(["inclusion", "exclusion"]).toContain(c.kind);
      expect(typeof c.field).toBe("string");
      expect(typeof c.rawText).toBe("string");
    }
  });
});
