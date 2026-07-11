/**
 * Network fan-out (ADR-002, phase M3) — one study across N sites concurrently.
 *
 * The marketplace multiplier (spec E6): a sponsor study fans out to every candidate site,
 * each running the full A/B/C/D orchestration in parallel. Wall-clock is the slowest single
 * site, not the sum. Each site's cohort count comes from ITS OWN site-side cohort.preview MCP
 * tool (via per-site injected deps), so no patient data crosses sites or reaches the cloud.
 *
 * Failures are isolated: one site erroring (offline MCP tool, missing profile) does not sink
 * the sweep — it surfaces as a per-site error. The network summary reports only aggregates and
 * counts responding sites; a small/suppressed per-site count is excluded from the precise
 * numeric total and noted, never guessed.
 */

import { orchestrateAutofill, type AutofillRequest, type AutofillResult, type OrchestratorDeps } from "./orchestrator";
import type { FormFieldDraft } from "../ingest";
import type { Criterion } from "@/lib/matcher/types";

export interface StudyRequest {
  fields: FormFieldDraft[];
  criteria: Criterion[];
}

export interface SiteOutcome {
  siteId: string;
  result: AutofillResult | null;
  error?: string;
}

export interface NetworkAutofillResult {
  perSite: SiteOutcome[];
  summary: {
    sites: number;
    succeeded: number;
    failed: number;
    /** Sites whose candidate N is a precise (non-suppressed) number. */
    countedSites: number;
    /** Sum of the precise per-site candidate counts (suppressed sites excluded — see suppressedSites). */
    totalCandidates: number;
    /** Sites whose count was suppressed (<5) and thus excluded from totalCandidates. */
    suppressedSites: number;
    /** Sites that answered A/B/D but whose cohort tool was unavailable (C degraded). */
    cohortUnavailableSites: number;
  };
}

/** Bounded concurrency: run `tasks` at most `limit` at a time (avoids stampeding N site tools). */
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Fan a study out across sites. `depsFor(siteId)` yields that site's orchestrator deps (its own
 * cohort.preview MCP client, profile/capability loaders, drafter). `concurrency` caps parallel
 * sites. Per-site failures are captured, never thrown.
 */
export async function fanOutAutofill(
  request: StudyRequest,
  siteIds: string[],
  depsFor: (siteId: string) => OrchestratorDeps,
  concurrency = 8,
): Promise<NetworkAutofillResult> {
  const perSite = await mapWithLimit(siteIds, concurrency, async (siteId): Promise<SiteOutcome> => {
    try {
      const req: AutofillRequest = { siteId, fields: request.fields, criteria: request.criteria };
      const result = await orchestrateAutofill(req, depsFor(siteId));
      return { siteId, result };
    } catch (err) {
      return { siteId, result: null, error: (err as Error).message };
    }
  });

  let countedSites = 0;
  let totalCandidates = 0;
  let suppressedSites = 0;
  let cohortUnavailableSites = 0;
  for (const o of perSite) {
    if (!o.result) continue;
    // Annotate the outcome so an offline cohort tool is visible, not silently uncounted.
    if (o.result.cohortUnavailable) {
      cohortUnavailableSites++;
      o.error = o.error ?? `cohort unavailable: ${o.result.cohortError ?? "unknown"}`;
    }
    const n = o.result.cohort?.n;
    if (typeof n === "number") {
      countedSites++;
      totalCandidates += n;
    } else if (n === "<5" || o.result.cohort?.suppressed) {
      suppressedSites++;
    }
  }

  const succeeded = perSite.filter((o) => o.result).length;
  return {
    perSite,
    summary: {
      sites: siteIds.length,
      succeeded,
      failed: siteIds.length - succeeded,
      countedSites,
      totalCandidates,
      suppressedSites,
      cohortUnavailableSites,
    },
  };
}
