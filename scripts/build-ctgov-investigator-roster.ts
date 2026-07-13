import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildCtgovInvestigatorRoster,
  extractCtgovOfficials,
  type CtgovOfficialOccurrence,
  type RawCtgovRosterStudy,
} from "@/lib/ctgov/investigatorRosterModel";

const API_BASE = "https://clinicaltrials.gov/api/v2";
const COUNTRY_QUERY = "AREA[LocationCountry]Brazil";
const FIELDS = "NCTId,BriefTitle,OverallStatus,Condition,OverallOfficialName,OverallOfficialRole,OverallOfficialAffiliation";

interface StudiesPage {
  studies?: RawCtgovRosterStudy[];
  totalCount?: number;
  nextPageToken?: string;
}

function args() {
  const config = { out: "data/ctgov-investigators-br.json", pageSize: 1000, maxPages: Number.POSITIVE_INFINITY };
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index]?.replace(/^--/, "");
    const value = process.argv[index + 1];
    if (!value) throw new Error(`Incomplete argument: ${process.argv[index]}`);
    if (key === "out") config.out = value;
    else if (key === "page-size") config.pageSize = Math.max(1, Math.min(1000, Number(value)));
    else if (key === "max-pages") config.maxPages = Math.max(1, Number(value));
    else throw new Error(`Unknown argument: ${process.argv[index]}`);
  }
  return config;
}

async function fetchJson<T>(url: string, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "TrialBridge/1.0 CTgov roster builder" }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json() as T;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 750));
    }
  }
  throw lastError;
}

async function main() {
  const config = args();
  const version = await fetchJson<{ apiVersion?: string; dataTimestamp?: string }>(`${API_BASE}/version`);
  const officials: CtgovOfficialOccurrence[] = [];
  let pageToken: string | undefined;
  let studiesScanned = 0;
  let totalStudies = 0;
  let page = 0;
  do {
    const params = new URLSearchParams({
      "query.term": COUNTRY_QUERY,
      countTotal: "true",
      pageSize: String(config.pageSize),
      fields: FIELDS,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const payload = await fetchJson<StudiesPage>(`${API_BASE}/studies?${params.toString()}`);
    const studies = payload.studies ?? [];
    totalStudies = payload.totalCount ?? totalStudies;
    studiesScanned += studies.length;
    officials.push(...extractCtgovOfficials(studies));
    pageToken = payload.nextPageToken;
    page++;
    console.log(`[ctgov-roster] page ${page}: studies=${studies.length} scanned=${studiesScanned}/${totalStudies || "?"} officials=${officials.length}`);
  } while (pageToken && page < config.maxPages);

  const roster = buildCtgovInvestigatorRoster(officials, {
    generatedAt: new Date().toISOString(),
    apiVersion: version.apiVersion,
    dataTimestamp: version.dataTimestamp,
    query: COUNTRY_QUERY,
    complete: !pageToken && studiesScanned === totalStudies,
    studiesScanned,
    totalStudies,
  });
  const out = resolve(config.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(roster, null, 2));
  console.log(JSON.stringify({ out, complete: roster.complete, studiesScanned, totalStudies, ...roster.summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
