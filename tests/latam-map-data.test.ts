import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface LatamTrialSite {
  site_id: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string;
  lat: number;
  lng: number;
  activity_status: "active" | "dormant";
  trial_count: number;
  active_trial_count: number;
}

function loadPayload(): { generated_at: string; sites: LatamTrialSite[] } {
  const p = resolve(process.cwd(), "public", "data", "latam-sites.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

describe("latam-sites.json map payload", () => {
  const payload = loadPayload();
  const sites = payload.sites;

  it("has a plausible volume of sites", () => {
    expect(sites.length).toBeGreaterThan(10_000);
  });

  it("has globally unique site_ids", () => {
    expect(new Set(sites.map((s) => s.site_id)).size).toBe(sites.length);
  });

  it("covers exactly the four target countries", () => {
    expect(new Set(sites.map((s) => s.country))).toEqual(
      new Set(["br", "mx", "cl", "ar"]),
    );
  });

  it("every site is mappable with finite coordinates", () => {
    for (const s of sites) {
      expect(Number.isFinite(s.lat)).toBe(true);
      expect(Number.isFinite(s.lng)).toBe(true);
    }
  });

  it("has consistent activity fields", () => {
    for (const s of sites) {
      expect(["active", "dormant"]).toContain(s.activity_status);
      expect(s.trial_count).toBeGreaterThanOrEqual(1);
      expect(s.active_trial_count).toBeGreaterThanOrEqual(0);
      expect(s.active_trial_count).toBeLessThanOrEqual(s.trial_count);
      expect(s.activity_status === "active").toBe(s.active_trial_count > 0);
    }
  });

  it("contains no sponsor-placeholder site names", () => {
    // Test that the payload has no pure generic placeholder patterns;
    // allows local-institution/research-site if they have identifiers (codes, locations, coordinates).
    // Only flags sites that match the pattern exactly with no distinguishing suffix.
    const noise = /^(local institution|research site|clinical.*trial.*site)$/i;
    const hits = sites.filter((s) => noise.test(s.name));
    expect(hits.map((s) => s.name)).toEqual([]);
  });
});
