import type { RegistryTrialProfile, SiteFeasibilityQuery } from "@/lib/site-feasibility/types";

const CTGOV_BASE = "https://clinicaltrials.gov/api/v2/studies";
const TIMEOUT_MS = 10_000;

interface RawRegistryStudy {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string; officialTitle?: string };
    statusModule?: { overallStatus?: string };
    designModule?: { phases?: string[] };
    conditionsModule?: { conditions?: string[] };
    armsInterventionsModule?: { interventions?: { name?: string }[] };
  };
}

export interface RegistryTrialUniverse {
  source: "live" | "unavailable";
  trials: RegistryTrialProfile[];
  total: number | null;
  truncated: boolean;
  note?: string;
}

export function parseRegistryTrials(studies: RawRegistryStudy[]): RegistryTrialProfile[] {
  const unique = new Map<string, RegistryTrialProfile>();
  for (const study of studies) {
    const protocol = study.protocolSection ?? {};
    const id = protocol.identificationModule?.nctId?.trim().toUpperCase();
    if (!id) continue;
    unique.set(id, {
      nctId: id,
      title: protocol.identificationModule?.officialTitle ??
        protocol.identificationModule?.briefTitle ?? "",
      conditions: protocol.conditionsModule?.conditions ?? [],
      phases: protocol.designModule?.phases ?? [],
      status: protocol.statusModule?.overallStatus ?? null,
      interventions: (protocol.armsInterventionsModule?.interventions ?? [])
        .map((intervention) => intervention.name?.trim() ?? "")
        .filter(Boolean),
    });
  }
  return [...unique.values()];
}

export async function fetchRegistryTrialUniverse(
  query: SiteFeasibilityQuery,
  opts: { pageSize?: number; maxPages?: number; signal?: AbortSignal } = {},
): Promise<RegistryTrialUniverse> {
  const condition = query.condition.trim();
  if (!condition) {
    return { source: "unavailable", trials: [], total: null, truncated: false, note: "No condition supplied." };
  }

  const pageSize = Math.min(1000, Math.max(1, opts.pageSize ?? 500));
  const maxPages = Math.max(1, opts.maxPages ?? 10);
  const studies: RawRegistryStudy[] = [];
  let pageToken: string | undefined;
  let total: number | null = null;
  let truncated = false;

  try {
    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({
        "query.cond": condition,
        "query.locn": "Brazil",
        countTotal: "true",
        pageSize: String(pageSize),
        fields: [
          "protocolSection.identificationModule",
          "protocolSection.statusModule",
          "protocolSection.designModule",
          "protocolSection.conditionsModule",
          "protocolSection.armsInterventionsModule",
        ].join(","),
      });
      if (pageToken) params.set("pageToken", pageToken);
      const response = await fetch(`${CTGOV_BASE}?${params.toString()}`, {
        signal: opts.signal ?? AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`ClinicalTrials.gov returned ${response.status}`);
      }
      const payload = await response.json() as {
        studies?: RawRegistryStudy[];
        totalCount?: number;
        nextPageToken?: string;
      };
      studies.push(...(payload.studies ?? []));
      total = payload.totalCount ?? total;
      pageToken = payload.nextPageToken;
      if (!pageToken) break;
      if (page === maxPages - 1) truncated = true;
    }
    return {
      source: "live",
      trials: parseRegistryTrials(studies),
      total,
      truncated,
      note: truncated ? `Study retrieval capped at ${studies.length} of ${total ?? "unknown"}.` : undefined,
    };
  } catch (error) {
    return {
      source: "unavailable",
      trials: [],
      total: null,
      truncated: false,
      note: error instanceof Error ? error.message : "ClinicalTrials.gov unavailable.",
    };
  }
}
