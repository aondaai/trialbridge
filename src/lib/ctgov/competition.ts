/**
 * CT.gov competition connector (R9, eng spec §7.3) — real competing-trial counts and
 * investigator names for a condition with Brazil sites, replacing the R7/R8 MODELED
 * placeholders with registry data.
 *
 * Two layers: a PURE parser (`parseCompetition`, unit-tested with fixtures, no network)
 * and a live fetch (`fetchCompetition`) that GRACEFULLY DEGRADES — on any failure it
 * returns `source: "unavailable"` so the caller keeps its modeled placeholders and
 * notes the gap in the risk register (spec §7.11), never a fabricated or zeroed count.
 */

const CTGOV_BASE = "https://clinicaltrials.gov/api/v2/studies";
const TIMEOUT_MS = 8000;

export type Macroregion = "Norte" | "Nordeste" | "Centro-Oeste" | "Sudeste" | "Sul";

/** Normalized Brazilian state-name → macro-region (accents stripped, lower-cased). */
const STATE_TO_REGION: Record<string, Macroregion> = {};
const REGION_STATES: Record<Macroregion, string[]> = {
  Norte: ["Acre", "Amapa", "Amazonas", "Para", "Rondonia", "Roraima", "Tocantins"],
  Nordeste: ["Alagoas", "Bahia", "Ceara", "Maranhao", "Paraiba", "Pernambuco", "Piaui", "Rio Grande do Norte", "Sergipe"],
  "Centro-Oeste": ["Distrito Federal", "Goias", "Mato Grosso", "Mato Grosso do Sul"],
  Sudeste: ["Espirito Santo", "Minas Gerais", "Rio de Janeiro", "Sao Paulo"],
  Sul: ["Parana", "Rio Grande do Sul", "Santa Catarina"],
};
for (const [region, states] of Object.entries(REGION_STATES) as [Macroregion, string[]][]) {
  for (const s of states) STATE_TO_REGION[norm(s)] = region;
}

/** Strip diacritics + lower-case, so "São Paulo" and "Sao Paulo" both map. */
export function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/** Map a CT.gov Brazilian state string to its macro-region, or null if unrecognized. */
export function stateToRegion(state: string | null | undefined): Macroregion | null {
  if (!state) return null;
  return STATE_TO_REGION[norm(state)] ?? null;
}

export interface CtgovInvestigator {
  name: string;
  regionCode: string; // macro-region, best-effort from the study's BR sites
  affiliation: string | null;
  trialsCount: number;
}

/**
 * CT.gov overall-official roles that denote a REAL investigator (a named person),
 * as opposed to STUDY_DIRECTOR which is almost always a generic sponsor contact
 * ("Clinical Trials", "Medical Director", a call-center number). Populating a KOL
 * map from STUDY_DIRECTOR entries would be dishonest, so we drop them.
 */
const INVESTIGATOR_ROLES = new Set(["PRINCIPAL_INVESTIGATOR", "STUDY_CHAIR"]);

export interface CompetitionData {
  source: "live" | "unavailable";
  total: number; // total recruiting BR studies for the condition
  byRegion: Partial<Record<Macroregion, number>>; // competing trials per macro-region
  investigators: CtgovInvestigator[];
  note?: string;
}

/** Minimal shape of the CT.gov v2 studies we read (parser input). */
export interface RawStudyLite {
  protocolSection?: {
    identificationModule?: { nctId?: string };
    contactsLocationsModule?: {
      locations?: { country?: string; state?: string; city?: string }[];
      overallOfficials?: { name?: string; role?: string; affiliation?: string }[];
    };
  };
}

/**
 * Pure: turn a page of CT.gov studies into per-region competition counts +
 * investigators. A study counts toward every macro-region in which it has a BR site
 * (that is the local competition each region's patients actually face).
 */
export function parseCompetition(studies: RawStudyLite[], total?: number): CompetitionData {
  const byRegion: Partial<Record<Macroregion, number>> = {};
  const investigators = new Map<string, CtgovInvestigator>();

  for (const study of studies) {
    const cl = study.protocolSection?.contactsLocationsModule;
    const brLocations = (cl?.locations ?? []).filter((l) => norm(l.country ?? "") === "brazil");
    const regions = new Set<Macroregion>();
    for (const loc of brLocations) {
      const region = stateToRegion(loc.state);
      if (region) regions.add(region);
    }
    for (const region of regions) byRegion[region] = (byRegion[region] ?? 0) + 1;

    // Attach each REAL investigator (PI/chair only) to the study's first BR region.
    const primaryRegion = [...regions][0];
    if (primaryRegion) {
      for (const off of cl?.overallOfficials ?? []) {
        if (!INVESTIGATOR_ROLES.has(off.role ?? "")) continue; // drop generic sponsor contacts
        const name = (off.name ?? "").trim();
        if (!name) continue;
        const existing = investigators.get(name);
        if (existing) existing.trialsCount += 1;
        else
          investigators.set(name, {
            name,
            regionCode: primaryRegion,
            affiliation: (off.affiliation ?? "").trim() || null,
            trialsCount: 1,
          });
      }
    }
  }

  return {
    source: "live",
    total: total ?? studies.length,
    byRegion,
    investigators: [...investigators.values()].sort((a, b) => b.trialsCount - a.trialsCount),
  };
}

/** The "unavailable" result — the caller keeps modeled placeholders (spec §7.11). */
export function unavailableCompetition(note: string): CompetitionData {
  return { source: "unavailable", total: 0, byRegion: {}, investigators: [], note };
}

/**
 * Live fetch: recruiting BR studies for `condition`. Never throws — degrades to
 * `unavailable` on timeout / non-200 / parse failure.
 */
export async function fetchCompetition(
  condition: string,
  opts: { pageSize?: number; signal?: AbortSignal } = {},
): Promise<CompetitionData> {
  const cond = condition.trim();
  if (!cond) return unavailableCompetition("No condition supplied for the CT.gov competition query.");
  const pageSize = Math.min(opts.pageSize ?? 200, 1000);
  const params = new URLSearchParams({
    "query.cond": cond,
    "query.locn": "Brazil",
    "filter.overallStatus": "RECRUITING",
    countTotal: "true",
    pageSize: String(pageSize),
    fields: "protocolSection.identificationModule,protocolSection.contactsLocationsModule",
  });
  try {
    const res = await fetch(`${CTGOV_BASE}?${params.toString()}`, {
      signal: opts.signal ?? AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return unavailableCompetition(`ClinicalTrials.gov returned ${res.status} for the competition query.`);
    const json = (await res.json()) as { studies?: RawStudyLite[]; totalCount?: number };
    const studies = json.studies ?? [];
    return parseCompetition(studies, json.totalCount);
  } catch (e) {
    return unavailableCompetition(
      `CT.gov competition query unavailable (${e instanceof Error ? e.message : "error"}); using modeled placeholders.`,
    );
  }
}
