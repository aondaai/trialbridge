/**
 * Scheduled-deployment planner (ADR-002, phase M4) — freshness as a job.
 *
 * A Managed-Agents scheduled deployment (cron) runs a nightly job that keeps the module
 * fresh: revalidate stale capability-catalog rows (the F5 "stale catalog" risk), re-index the
 * prior-answer RAG store, and pre-match newly-posted studies. This module is the PURE planning
 * logic — given the current catalog + an injected `now`, it decides WHAT the job should do. The
 * scheduled agent executes the plan (calls the site's revalidation, re-indexes, etc.).
 *
 * Clock-free: `nowIso` is injected so the plan is deterministic and testable (no Date.now).
 */

export interface CatalogRowLike {
  conceptId: string;
  dataSourceId: string;
  siteId: string;
  /** ISO timestamp of the last validation. */
  lastValidatedAt: string;
  completenessQual: string;
}

export interface RevalidationTask {
  siteId: string;
  dataSourceId: string;
  conceptId: string;
  ageDays: number;
  reason: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Finite "effectively infinite" age for never/unparseable-validated rows — JSON-safe and sortable
 *  (Infinity serializes to null and makes the sort comparator return NaN). ~274 years. */
export const NEVER_VALIDATED_AGE = 100_000;

/** Whole days between an ISO timestamp and `now` (floored, never negative). */
export function ageInDays(iso: string, nowIso: string): number {
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(then) || Number.isNaN(now)) return NEVER_VALIDATED_AGE; // unparseable → treat as stale
  return Math.max(0, Math.floor((now - then) / DAY_MS));
}

/**
 * Which capability rows need revalidation. A row is stale if it hasn't been validated within
 * `maxAgeDays`; low-completeness rows are revalidated more aggressively (half the window), since
 * a weak capability is the one most worth re-checking.
 */
export function findStaleCapabilities(
  rows: CatalogRowLike[],
  nowIso: string,
  maxAgeDays = 90,
): RevalidationTask[] {
  const tasks: RevalidationTask[] = [];
  for (const row of rows) {
    const ageDays = ageInDays(row.lastValidatedAt, nowIso);
    const threshold = row.completenessQual.toLowerCase() === "low" ? Math.ceil(maxAgeDays / 2) : maxAgeDays;
    if (ageDays >= threshold) {
      tasks.push({
        siteId: row.siteId,
        dataSourceId: row.dataSourceId,
        conceptId: row.conceptId,
        ageDays,
        reason: ageDays >= NEVER_VALIDATED_AGE ? "never validated" : `stale: ${ageDays}d ≥ ${threshold}d threshold`,
      });
    }
  }
  // Most stale first — bounded work per run should tackle the worst offenders.
  return tasks.sort((a, b) => b.ageDays - a.ageDays);
}

export interface NightlyJob {
  kind: "nightly-freshness";
  generatedAt: string;
  revalidate: RevalidationTask[];
  /** Re-index the RAG store if any prior answers changed since the last run. */
  reindexRag: boolean;
  /** New study ids (e.g. from CT.gov) to pre-match against site capacity. */
  preMatchStudies: string[];
  /** Bounded so one run can't schedule unbounded revalidation work. */
  truncated: boolean;
}

export interface NightlyInputs {
  catalog: CatalogRowLike[];
  nowIso: string;
  maxAgeDays?: number;
  /** Prior-answer changes since the last run → whether to re-index. */
  ragDirty?: boolean;
  /** Newly-seen study ids to pre-match. */
  newStudyIds?: string[];
  /** Cap on revalidation tasks per run (default 100). */
  maxTasks?: number;
}

/** Plan the nightly freshness job from current state. Deterministic given `nowIso`. */
export function planNightlyJob(inputs: NightlyInputs): NightlyJob {
  const all = findStaleCapabilities(inputs.catalog, inputs.nowIso, inputs.maxAgeDays);
  const cap = inputs.maxTasks ?? 100;
  const revalidate = all.slice(0, cap);
  return {
    kind: "nightly-freshness",
    generatedAt: inputs.nowIso,
    revalidate,
    reindexRag: inputs.ragDirty ?? false,
    preMatchStudies: inputs.newStudyIds ?? [],
    truncated: all.length > revalidate.length,
  };
}
