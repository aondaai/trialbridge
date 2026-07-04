/**
 * Server-side loader for the seeded site datasets. Used by both the demo script
 * and the Next server components — one source of truth for reading data/.
 *
 * Reads plain JSON from the committed data/ directory (the frozen snapshot). This
 * is the counts-not-rows boundary's *origin*: raw patient rows live here and are
 * only ever read server-side; nothing below sends rows across the sponsor boundary.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Patient } from "@/lib/matcher/types";

export interface SiteMeta {
  id: string;
  name: string;
  country: string;
  city: string;
  persona: string;
  monthlyIncidence: number;
}

export interface SiteDataset {
  site: SiteMeta;
  patients: Patient[];
}

function dataDir(): string {
  return resolve(process.cwd(), "data");
}

export function loadSiteIds(): string[] {
  const idx = JSON.parse(readFileSync(resolve(dataDir(), "index.json"), "utf8")) as {
    sites: { id: string; file: string }[];
  };
  return idx.sites.map((s) => s.id);
}

export function loadSite(id: string): SiteDataset {
  const raw = JSON.parse(readFileSync(resolve(dataDir(), `${id}.json`), "utf8")) as SiteDataset;
  return raw;
}

export function loadAllSites(): SiteDataset[] {
  return loadSiteIds().map(loadSite);
}
