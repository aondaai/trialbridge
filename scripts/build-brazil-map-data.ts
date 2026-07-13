/**
 * Build the Brazil-first site-intelligence payload used by /map.
 *
 * Usage:
 *   ./node_modules/.bin/tsx scripts/build-brazil-map-data.ts \
 *     /path/to/sitemap/sites.json \
 *     data/facility-master/facility-report-view.v1.json
 *
 * The geographic payload stays compact. Facility-master observations are
 * reduced to filterable, public reporting fields; full evidence remains on
 * the server and is fetched only when a site is selected.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

interface FullSite {
  site_id: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string;
  lat: number | null;
  lng: number | null;
  geo_precision?: string | null;
  activity_status: "active" | "dormant";
  trial_refs?: string[];
  trial_count: number;
  active_trial_count: number;
  is_placeholder?: boolean;
  provenance?: { discovered_via?: string[] };
}

interface Observation {
  field: string;
  value: unknown;
  assertion: "yes" | "no" | "unknown" | "value";
  observedAt: string | null;
}

interface MasterFacility {
  facilityId: string;
  name: string;
  cnes: string | null;
  city: string | null;
  uf: string | null;
  sources: string[];
  observations: Observation[];
}

interface MasterFile {
  generatedAt: string;
  facilities: MasterFacility[];
}

interface MapIntelligence {
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

interface MapSite {
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
  activity_status: "active" | "dormant";
  trial_count: number;
  active_trial_count: number;
  trial_refs: string[];
  discovered_via: string[];
  intelligence: MapIntelligence | null;
}

const [sitePath, masterPath] = process.argv.slice(2);
if (!sitePath || !masterPath) {
  console.error("usage: build-brazil-map-data.ts <sites.json> <facility-master.json>");
  process.exit(1);
}

const source = JSON.parse(readFileSync(sitePath, "utf8")) as {
  generated_at?: string;
  sites: FullSite[];
};
const master = JSON.parse(readFileSync(masterPath, "utf8")) as MasterFile;
const masterById = new Map(master.facilities.map((facility) => [facility.facilityId, facility]));

const UF_NAMES: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE",
  "distrito federal": "DF", "federal district": "DF", "espirito santo": "ES", goias: "GO",
  maranhao: "MA", "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG",
  para: "PA", paraiba: "PB", parana: "PR", pernambuco: "PE", piaui: "PI",
  "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS",
  rondonia: "RO", roraima: "RR", "santa catarina": "SC", "sao paulo": "SP",
  sergipe: "SE", tocantins: "TO",
};
const UF_CODES = new Set(Object.values(UF_NAMES));

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function identityKey(value: string): string {
  return normalize(value).replace(/[^a-z0-9]+/g, "");
}

const GENERIC_SITE = /(^|\b)(investigational|investigative|investigator|clinical study|clinical trial|study|research) site\b|\bFIN[- ]?\d|^local institution\b|^research facility\b|^site\s*(?:#|no\.?|number|id|br|\d)|^multiple .* sites?$/i;
const INSTITUTION_ANCHOR = /hospital|hosp\b|cl[ií]nic|centro|institut|univers|funda[cç][aã]o|faculdade|associa[cç][aã]o|laborat|maternidade|policl[ií]nica|santa casa|oncolog|pesquisa|medical|medic|sa[uú]de|cardio|hemato|benefic|irmandade/i;

function identityStatus(name: string): MapSite["identity_status"] {
  return GENERIC_SITE.test(name) && !INSTITUTION_ANCHOR.test(name) ? "provisional" : "identified";
}

function inferUf(state: string | null, masterUf: string | null): string | null {
  const normalized = normalize(state ?? "").replace(/[^a-z0-9]+/g, " ").trim();
  const tokens = normalized.toUpperCase().split(/\s+/).filter(Boolean);
  const explicitCode = tokens.find((token) => UF_CODES.has(token));
  if (explicitCode) return explicitCode;
  for (const [name, code] of Object.entries(UF_NAMES)) {
    if (normalized === name || normalized.includes(name)) return code;
  }
  return masterUf && UF_CODES.has(masterUf) ? masterUf : null;
}

function observation(facility: MasterFacility | undefined, field: string): Observation | undefined {
  return facility?.observations.find((item) => item.field === field);
}

function triState(facility: MasterFacility | undefined, field: string): boolean | null {
  const item = observation(facility, field);
  if (!item || item.assertion === "unknown") return null;
  if (item.assertion === "yes") return true;
  if (item.assertion === "no") return false;
  return typeof item.value === "boolean" ? item.value : null;
}

const mappedSites: MapSite[] = source.sites
  .filter((site) => site.country === "br" && !site.is_placeholder && site.lat != null && site.lng != null)
  .map((site) => {
    const facility = masterById.get(`fac-${site.site_id}`);
    const areas = observation(facility, "research.therapeutic_areas")?.value;
    const inspections = ["anvisa", "fda", "ema"].filter(
      (agency) => triState(facility, `inspection.${agency}`) === true,
    );
    return {
      site_id: site.site_id,
      source_site_ids: [site.site_id],
      aliases: [site.name],
      identity_status: identityStatus(site.name),
      name: facility?.name || site.name,
      city: site.city,
      state: site.state,
      uf: inferUf(site.state, facility?.uf ?? null),
      country: "br" as const,
      lat: site.lat as number,
      lng: site.lng as number,
      geo_precision: site.geo_precision ?? "city",
      activity_status: site.activity_status,
      trial_count: site.trial_count,
      active_trial_count: site.active_trial_count,
      trial_refs: site.trial_refs ?? [],
      discovered_via: site.provenance?.discovered_via ?? [],
      intelligence: facility ? {
        facility_id: facility.facilityId,
        cnes: facility.cnes,
        sources: facility.sources,
        therapeutic_areas: Array.isArray(areas) ? areas.map(String) : [],
        oncology: triState(facility, "research.oncology_experience"),
        edc: triState(facility, "research.edc_experience"),
        rbm: triState(facility, "research.rbm_experience"),
        central_lab_exams: triState(facility, "research.central_lab_exams"),
        central_lab_imaging: triState(facility, "research.central_lab_imaging"),
        inspections,
      } : null,
    };
  });

function mergeTriState(values: Array<boolean | null>): boolean | null {
  if (values.includes(true)) return true;
  if (values.includes(false)) return false;
  return null;
}

function mergeIntelligence(group: MapSite[]): MapIntelligence | null {
  const all = group.map((site) => site.intelligence).filter((item): item is MapIntelligence => Boolean(item));
  if (!all.length) return null;
  const primary = [...all].sort((a, b) => b.sources.length - a.sources.length)[0];
  return {
    ...primary,
    cnes: all.find((item) => item.cnes)?.cnes ?? null,
    sources: [...new Set(all.flatMap((item) => item.sources))],
    therapeutic_areas: [...new Set(all.flatMap((item) => item.therapeutic_areas))].sort(),
    oncology: mergeTriState(all.map((item) => item.oncology)),
    edc: mergeTriState(all.map((item) => item.edc)),
    rbm: mergeTriState(all.map((item) => item.rbm)),
    central_lab_exams: mergeTriState(all.map((item) => item.central_lab_exams)),
    central_lab_imaging: mergeTriState(all.map((item) => item.central_lab_imaging)),
    inspections: [...new Set(all.flatMap((item) => item.inspections))].sort(),
  };
}

// Final strict pass for the reporting view. The upstream SiteMapTool already
// performs fuzzy dedup and applies thousands of curated merge/keep decisions.
// Here we only collapse identities that are equal after punctuation/diacritic
// normalization in the same city + UF. Ambiguous sponsor-coded sites stay
// separate and are labelled provisional instead of being silently merged.
const exactGroups = new Map<string, MapSite[]>();
for (const site of mappedSites) {
  const key = `${identityKey(site.name)}|${identityKey(site.city ?? "")}|${site.uf ?? ""}`;
  const group = exactGroups.get(key) ?? [];
  group.push(site);
  exactGroups.set(key, group);
}

let mergedGroups = 0;
const sites: MapSite[] = [...exactGroups.values()].map((group) => {
  const primary = [...group].sort((a, b) => b.trial_count - a.trial_count || a.site_id.localeCompare(b.site_id))[0];
  if (group.length === 1) return { ...primary, trial_refs: primary.trial_refs.slice(0, 12) };
  mergedGroups++;
  const trialRefs = [...new Set(group.flatMap((site) => site.trial_refs))];
  return {
    ...primary,
    source_site_ids: [...new Set(group.flatMap((site) => site.source_site_ids))],
    aliases: [...new Set(group.flatMap((site) => site.aliases))],
    identity_status: group.some((site) => site.identity_status === "identified") ? "identified" : "provisional",
    activity_status: group.some((site) => site.activity_status === "active") ? "active" : "dormant",
    trial_count: trialRefs.length || Math.max(...group.map((site) => site.trial_count)),
    active_trial_count: Math.max(...group.map((site) => site.active_trial_count)),
    trial_refs: trialRefs.slice(0, 12),
    discovered_via: [...new Set(group.flatMap((site) => site.discovered_via))],
    intelligence: mergeIntelligence(group),
  };
});

mkdirSync("public/data", { recursive: true });
writeFileSync("public/data/brazil-sites.json", JSON.stringify({
  schema_version: "brazil-site-map.v1",
  generated_at: source.generated_at ?? new Date().toISOString(),
  master_generated_at: master.generatedAt,
  dedup: {
    method: "upstream fuzzy + curated decisions; strict normalized identity pass; provisional identities kept separate",
    input_sites: mappedSites.length,
    output_sites: sites.length,
    merged_groups: mergedGroups,
    provisional_sites: sites.filter((site) => site.identity_status === "provisional").length,
  },
  sites,
}));

const active = sites.filter((site) => site.activity_status === "active").length;
const identifiedActive = sites.filter((site) => site.activity_status === "active" && site.identity_status === "identified").length;
const enriched = sites.filter((site) => site.intelligence).length;
console.log(`wrote public/data/brazil-sites.json: ${sites.length} deduped sites (${active} active, ${identifiedActive} active + identified, ${enriched} matched to master, ${mergedGroups} strict merges)`);
