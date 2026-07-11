/**
 * File-backed KOL enrichment store — the "precompute, don't block the request" pattern
 * the Parallel cookbook recommends (and this repo already uses for the OMOP vocab index).
 *
 * The Task API enriches a physician over ~1 min, which must NOT happen inside a page
 * render. Instead a background script (`npm run enrich-kols`) does the deep research and
 * writes results here; the page reads this JSON instantly and applies it. Server-only
 * (uses node:fs) — imported by the page (a server component) and the script, never the
 * client bundle.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { InvestigatorEnrichment } from "@/lib/kol/enrich";

const STORE_PATH = "data/kol-enrichment.json";

/** Stable key for an investigator (name only — distinct enough for the KOL map). */
export function enrichmentKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function loadEnrichmentStore(): Record<string, InvestigatorEnrichment> {
  try {
    return existsSync(STORE_PATH) ? (JSON.parse(readFileSync(STORE_PATH, "utf8")) as Record<string, InvestigatorEnrichment>) : {};
  } catch {
    return {};
  }
}

export function saveEnrichmentStore(store: Record<string, InvestigatorEnrichment>): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

/** Fast lookup: build the enrichment map for a set of names from the precomputed store. */
export function enrichmentsForNames(names: string[]): Map<string, InvestigatorEnrichment> {
  const store = loadEnrichmentStore();
  const map = new Map<string, InvestigatorEnrichment>();
  for (const name of names) {
    const e = store[enrichmentKey(name)];
    if (e && e.source === "parallel") map.set(name, e);
  }
  return map;
}

/** Merge freshly-researched enrichments into the store (used by the script). */
export function mergeIntoStore(enrichments: Map<string, InvestigatorEnrichment>): Record<string, InvestigatorEnrichment> {
  const store = loadEnrichmentStore();
  for (const [name, e] of enrichments) {
    if (e.source === "parallel") store[enrichmentKey(name)] = e;
  }
  saveEnrichmentStore(store);
  return store;
}
