export type SiteActivity = "active" | "dormant";
export type IntelligenceScope = "all" | "research_network" | "oncology" | "inspection";

export interface BrazilSiteIntelligence {
  facility_id: string;
  cnes: string | null;
  sources: string[];
  therapeutic_areas: string[];
  oncology: boolean | null;
  edc: boolean | null;
  rbm: boolean | null;
  central_lab_exams: boolean | null;
  central_lab_imaging: boolean | null;
  inspections: string[];
}

export interface BrazilTrialSite {
  site_id: string;
  source_site_ids: string[];
  aliases: string[];
  identity_status: "identified" | "provisional";
  name: string;
  city: string | null;
  state: string | null;
  uf: string | null;
  country: "br";
  lat: number;
  lng: number;
  geo_precision: string;
  activity_status: SiteActivity;
  trial_count: number;
  active_trial_count: number;
  trial_refs: string[];
  discovered_via: string[];
  intelligence: BrazilSiteIntelligence | null;
}

export interface BrazilSiteFilters {
  query: string;
  activity: "all" | SiteActivity;
  uf: string;
  minActiveTrials: number;
  scope: IntelligenceScope;
  identity: "identified" | "all" | "provisional";
}

export interface SiteCluster {
  id: string;
  lat: number;
  lng: number;
  count: number;
  activeCount: number;
  trialCount: number;
  site: BrazilTrialSite | null;
}

export function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/**
 * Conservative headline cohort: a resolved facility with a currently active
 * registered trial and corroborating presence in a Brazilian research network.
 */
export function isDefensibleActiveCenter(site: BrazilTrialSite): boolean {
  return site.activity_status === "active"
    && site.identity_status === "identified"
    && site.active_trial_count > 0
    && Boolean(site.intelligence?.sources.some((source) => source === "abracro" || source === "acesse"));
}

export function filterBrazilSites(sites: BrazilTrialSite[], filters: BrazilSiteFilters): BrazilTrialSite[] {
  const query = normalizeSearch(filters.query);
  return sites.filter((site) => {
    if (filters.activity !== "all" && site.activity_status !== filters.activity) return false;
    if (filters.identity !== "all" && site.identity_status !== filters.identity) return false;
    if (filters.uf && site.uf !== filters.uf) return false;
    if (site.active_trial_count < filters.minActiveTrials) return false;
    if (query && !normalizeSearch(`${site.name} ${site.city ?? ""} ${site.uf ?? ""} ${site.intelligence?.cnes ?? ""}`).includes(query)) return false;

    const intelligence = site.intelligence;
    if (filters.scope === "research_network" && !intelligence?.sources.some((source) => source === "abracro" || source === "acesse")) return false;
    if (filters.scope === "oncology" && intelligence?.oncology !== true) return false;
    if (filters.scope === "inspection" && !intelligence?.inspections.length) return false;
    return true;
  });
}

export function gridDegreesForZoom(zoom: number): number {
  if (zoom <= 4) return 3.5;
  if (zoom === 5) return 1.8;
  if (zoom === 6) return 0.9;
  if (zoom === 7) return 0.45;
  return 0;
}

export function clusterBrazilSites(sites: BrazilTrialSite[], zoom: number): SiteCluster[] {
  const grid = gridDegreesForZoom(zoom);
  if (grid === 0) {
    return sites.map((site) => ({
      id: site.site_id,
      lat: site.lat,
      lng: site.lng,
      count: 1,
      activeCount: site.activity_status === "active" ? 1 : 0,
      trialCount: site.active_trial_count,
      site,
    }));
  }

  const buckets = new Map<string, BrazilTrialSite[]>();
  for (const site of sites) {
    const key = `${Math.floor(site.lat / grid)}:${Math.floor(site.lng / grid)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(site);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()].map(([key, bucket]) => {
    if (bucket.length === 1) {
      const site = bucket[0];
      return {
        id: site.site_id,
        lat: site.lat,
        lng: site.lng,
        count: 1,
        activeCount: site.activity_status === "active" ? 1 : 0,
        trialCount: site.active_trial_count,
        site,
      };
    }
    return {
      id: `cluster-${zoom}-${key}`,
      lat: bucket.reduce((sum, site) => sum + site.lat, 0) / bucket.length,
      lng: bucket.reduce((sum, site) => sum + site.lng, 0) / bucket.length,
      count: bucket.length,
      activeCount: bucket.filter((site) => site.activity_status === "active").length,
      trialCount: bucket.reduce((sum, site) => sum + site.active_trial_count, 0),
      site: null,
    };
  });
}
