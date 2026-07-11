/**
 * File-backed store for precomputed site-infrastructure enrichment (data/site-infra.json),
 * keyed by CNES. Same "precompute, don't block the render" pattern as KOL enrichment.
 * Server-only (node:fs).
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import type { SiteInfraEnrichment } from "@/lib/sites/infraEnrich";

const STORE_PATH = "data/site-infra.json";
let cache: Record<string, SiteInfraEnrichment> | null = null;

export function loadInfraStore(): Record<string, SiteInfraEnrichment> {
  if (cache) return cache;
  try {
    cache = existsSync(STORE_PATH) ? (JSON.parse(readFileSync(STORE_PATH, "utf8")) as Record<string, SiteInfraEnrichment>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

/** Map of CNES → infra, for the sites passed. Only successful (parallel) entries. */
export function infraForCnes(cnesList: (string | null)[]): Map<string, SiteInfraEnrichment> {
  const store = loadInfraStore();
  const map = new Map<string, SiteInfraEnrichment>();
  for (const cnes of cnesList) {
    if (!cnes) continue;
    const e = store[cnes];
    if (e && e.source === "parallel") map.set(cnes, e);
  }
  return map;
}

/** Merge freshly-researched infra into the store (used by the script; not for the app path). */
export function mergeInfraStore(enrichments: Map<string, SiteInfraEnrichment>): Record<string, SiteInfraEnrichment> {
  const store = loadInfraStore();
  for (const [cnes, e] of enrichments) if (e.source === "parallel") store[cnes] = e;
  mkdirSync("data", { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  cache = store;
  return store;
}
