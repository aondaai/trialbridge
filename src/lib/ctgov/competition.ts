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

/**
 * Choose a registry-sized condition term from reviewed protocol data. CT.gov's
 * query.cond parser rejects long protocol titles as "Too complicated query", so
 * the diagnosis criterion is authoritative when available and the title is only
 * a short, indication-aware fallback.
 */
export function competitionCondition(
  title: string,
  criteria: { field?: string; value?: unknown }[] = [],
): string {
  const diagnosis = criteria.find((criterion) =>
    criterion.field === "diagnosis" || criterion.field === "dx"
  )?.value;
  const diagnosisValue = Array.isArray(diagnosis) ? diagnosis[0] : diagnosis;
  if (typeof diagnosisValue === "string" && diagnosisValue.trim()) return diagnosisValue.trim();

  const value = title.toLowerCase();
  if (/idiopathic pulmonary fibrosis|\bipf\b/.test(value)) return "idiopathic pulmonary fibrosis";
  if (/breast/.test(value)) return "breast cancer";
  if (/\bnsclc\b|non-small cell lung|lung cancer/.test(value)) return "non-small cell lung cancer";
  if (/melanoma/.test(value)) return "melanoma";
  if (/colorectal|\bcrc\b/.test(value)) return "colorectal cancer";

  return title.replace(/^phase\s+[ivx]+\s*[—-]\s*/i, "")
    .replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || title;
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

export interface CompetitionQueryCut {
  key: "broad" | "indication" | "intervention";
  label: string;
  total: number | null;
  url: string;
}

/**
 * Evidence shown in the report pipeline. Registry search results are candidate
 * universes, not automatically direct competitors: CT.gov condition search is
 * deliberately recall-oriented and can return records from adjacent subtypes.
 */
export interface CompetitionLandscapeData {
  schemaVersion: "competition-landscape.v1";
  source: "live";
  assessment: "pending_adjudication";
  directCompetitors: null;
  broad: CompetitionData;
  cuts: CompetitionQueryCut[];
  limitations: string[];
}

export function competitionLandscapeSummary(data: CompetitionLandscapeData): string {
  const broad = data.cuts.find((cut) => cut.key === "broad");
  const indication = data.cuts.find((cut) => cut.key === "indication" && cut.total !== null);
  const intervention = data.cuts.find((cut) => cut.key === "intervention" && cut.total !== null);
  const narrower = [
    indication ? `${indication.total} indication-adjacent` : null,
    intervention ? `${intervention.total} mentioning T-DXd` : null,
  ].filter(Boolean).join(" and ");
  return narrower
    ? `Assessment pending adjudication. Broad background: ${broad?.total ?? "unknown"} recruiting studies in Brazil. Narrow registry cuts returned ${narrower}; direct competitors remain unvalidated.`
    : `Assessment pending adjudication. Broad background: ${broad?.total ?? "unknown"} recruiting studies in Brazil. Direct competitors remain unvalidated.`;
}

interface CompetitionQuery {
  key: CompetitionQueryCut["key"];
  label: string;
  condition: string;
  term?: string;
}

export function buildCompetitionQueries(condition: string, title: string): CompetitionQuery[] {
  const lower = title.toLowerCase();
  const queries: CompetitionQuery[] = [{
    key: "broad",
    label: `Recruiting ${condition} studies in Brazil`,
    condition,
  }];

  if (/breast/.test(lower) && /her2\s*(?:\+|-positive|positive)/i.test(title)) {
    queries.push({
      key: "indication",
      label: "Potentially indication-adjacent HER2-positive metastatic breast-cancer studies",
      condition: /metastatic/.test(lower) ? "HER2-positive metastatic breast cancer" : "HER2-positive breast cancer",
    });
  }

  if (/\bt[\s-]?dxd\b|trastuzumab deruxtecan/i.test(title)) {
    queries.push({
      key: "intervention",
      label: "Breast-cancer studies mentioning trastuzumab deruxtecan",
      condition,
      term: '"trastuzumab deruxtecan"',
    });
  }
  return queries;
}

export function competitionQueryUrl(query: Pick<CompetitionQuery, "condition" | "term">, pageSize = 1): string {
  const params = new URLSearchParams({
    "query.cond": query.condition,
    "query.locn": "Brazil",
    "filter.overallStatus": "RECRUITING",
    countTotal: "true",
    pageSize: String(pageSize),
  });
  if (query.term) params.set("query.term", query.term);
  return `${CTGOV_BASE}?${params.toString()}`;
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
  opts: { pageSize?: number; maxPages?: number; signal?: AbortSignal } = {},
): Promise<CompetitionData> {
  const cond = condition.trim();
  if (!cond) return unavailableCompetition("No condition supplied for the CT.gov competition query.");
  const pageSize = Math.min(opts.pageSize ?? 200, 1000);
  const maxPages = Math.max(1, opts.maxPages ?? 5); // up to ~1000 studies before we stop

  try {
    // Paginate: the per-region counts must be built from ALL studies, not just page 1 —
    // otherwise byRegion undercounts while `total` reflects everything, inflating the
    // supply/demand ratio behind a "registry" seal.
    const studies: RawStudyLite[] = [];
    let totalCount: number | undefined;
    let pageToken: string | undefined;
    let truncated = false;
    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({
        "query.cond": cond,
        "query.locn": "Brazil",
        "filter.overallStatus": "RECRUITING",
        countTotal: "true",
        pageSize: String(pageSize),
        fields: "protocolSection.identificationModule,protocolSection.contactsLocationsModule",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await fetch(`${CTGOV_BASE}?${params.toString()}`, {
        signal: opts.signal ?? AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "application/json" },
      });
      if (!res.ok) {
        if (page === 0) return unavailableCompetition(`ClinicalTrials.gov returned ${res.status} for the competition query.`);
        break; // keep what we have from earlier pages
      }
      const json = (await res.json()) as { studies?: RawStudyLite[]; totalCount?: number; nextPageToken?: string };
      totalCount = json.totalCount ?? totalCount;
      studies.push(...(json.studies ?? []));
      pageToken = json.nextPageToken;
      if (!pageToken) break;
      if (page === maxPages - 1) truncated = true;
    }
    const data = parseCompetition(studies, totalCount);
    // If pagination was cut off, the per-region counts cover only the studies we read.
    if (truncated) data.note = `Per-region counts cover the first ${studies.length} of ${totalCount ?? "?"} studies (pagination capped).`;
    return data;
  } catch (e) {
    return unavailableCompetition(
      `CT.gov competition query unavailable (${e instanceof Error ? e.message : "error"}); using modeled placeholders.`,
    );
  }
}

async function fetchCompetitionCount(query: CompetitionQuery, signal?: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(competitionQueryUrl(query), {
      signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { totalCount?: number };
    return typeof json.totalCount === "number" ? json.totalCount : null;
  } catch {
    return null;
  }
}

/**
 * Build report-grade competition evidence: retain the broad universe used by
 * supply/demand calculations, but clearly separate narrower candidate cuts and
 * refuse to manufacture a "direct competitor" count without study-level review.
 */
export async function fetchCompetitionLandscape(
  condition: string,
  title: string,
  opts: { signal?: AbortSignal } = {},
): Promise<CompetitionLandscapeData | ReturnType<typeof unavailableCompetition>> {
  const queries = buildCompetitionQueries(condition, title);
  const broad = await fetchCompetition(condition, { signal: opts.signal });
  if (broad.source !== "live") return broad;

  const narrower = queries.filter((query) => query.key !== "broad");
  const narrowerTotals = await Promise.all(narrower.map((query) => fetchCompetitionCount(query, opts.signal)));
  const cuts: CompetitionQueryCut[] = [
    {
      key: "broad",
      label: queries[0].label,
      total: broad.total,
      url: competitionQueryUrl(queries[0]),
    },
    ...narrower.map((query, index) => ({
      key: query.key,
      label: query.label,
      total: narrowerTotals[index],
      url: competitionQueryUrl(query),
    })),
  ];

  return {
    schemaVersion: "competition-landscape.v1",
    source: "live",
    assessment: "pending_adjudication",
    directCompetitors: null,
    broad,
    cuts,
    limitations: [
      "Registry search counts are candidate universes, not validated direct competitors.",
      "Direct competition requires study-level review of subtype, metastatic setting, treatment line, phase, eligibility overlap, and active Brazilian sites.",
    ],
  };
}
