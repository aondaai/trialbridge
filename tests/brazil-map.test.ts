import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clusterBrazilSites,
  filterBrazilSites,
  isDefensibleActiveCenter,
  type BrazilTrialSite,
} from "@/lib/map/brazil-sites";

function loadPayload(): { dedup: { input_sites: number; output_sites: number; merged_groups: number; provisional_sites: number }; sites: BrazilTrialSite[] } {
  const path = resolve(process.cwd(), "public", "data", "brazil-sites.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("Brazil site intelligence payload", () => {
  const payload = loadPayload();
  const sites = payload.sites;

  it("contains only mappable Brazilian non-placeholder sites", () => {
    expect(sites.length).toBeGreaterThan(7_000);
    expect(new Set(sites.map((site) => site.country))).toEqual(new Set(["br"]));
    expect(sites.every((site) => Number.isFinite(site.lat) && Number.isFinite(site.lng))).toBe(true);
    expect(sites.some((site) => /^(local institution|research site|clinical.*trial.*site)$/i.test(site.name))).toBe(false);
  });

  it("preserves unknown capability as null instead of false", () => {
    const intelligence = sites.map((site) => site.intelligence).filter(Boolean);
    expect(intelligence.length).toBeGreaterThan(7_000);
    expect(intelligence.some((item) => item?.oncology === null)).toBe(true);
    expect(intelligence.some((item) => item?.oncology === true)).toBe(true);
  });

  it("runs a strict identity dedup and labels unresolved identities", () => {
    expect(payload.dedup.input_sites).toBeGreaterThanOrEqual(payload.dedup.output_sites);
    expect(payload.dedup.merged_groups).toBeGreaterThan(0);
    expect(payload.dedup.provisional_sites).toBeGreaterThan(0);
    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const strongKeys = sites.map((site) => `${normalize(site.name)}|${normalize(site.city ?? "")}|${site.uf ?? ""}`);
    expect(new Set(strongKeys).size).toBe(sites.length);
    expect(sites.every((site) => site.source_site_ids.length >= 1 && site.aliases.length >= 1)).toBe(true);
  });

  it("filters by activity, state, volume and research scope", () => {
    const filtered = filterBrazilSites(sites, {
      query: "",
      activity: "active",
      uf: "SP",
      minActiveTrials: 3,
      scope: "research_network",
      identity: "identified",
    });
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((site) => site.activity_status === "active" && site.uf === "SP" && site.active_trial_count >= 3)).toBe(true);
    expect(filtered.every((site) => site.intelligence?.sources.some((source) => source === "abracro" || source === "acesse"))).toBe(true);
  });

  it("uses only defensible active centers for the headline count", () => {
    const defensible = sites.filter(isDefensibleActiveCenter);
    expect(defensible).toHaveLength(96);
    expect(defensible.every((site) => site.activity_status === "active" && site.active_trial_count > 0)).toBe(true);
    expect(defensible.every((site) => site.identity_status === "identified")).toBe(true);
    expect(defensible.every((site) => site.intelligence?.sources.some((source) => source === "abracro" || source === "acesse"))).toBe(true);
  });

  it("clusters low-zoom points and exposes individual sites at high zoom", () => {
    const sample = sites.slice(0, 100);
    const lowZoom = clusterBrazilSites(sample, 4);
    const highZoom = clusterBrazilSites(sample, 9);
    expect(lowZoom.length).toBeLessThan(sample.length);
    expect(lowZoom.reduce((sum, cluster) => sum + cluster.count, 0)).toBe(sample.length);
    expect(highZoom).toHaveLength(sample.length);
    expect(highZoom.every((cluster) => cluster.site !== null && cluster.count === 1)).toBe(true);
  });
});
