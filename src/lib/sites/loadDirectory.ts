/**
 * Runtime loader for the imported site directory (data/site-directory.json). Server-only
 * (node:fs); imported by the page + scripts, never the client bundle. Returns [] if the
 * import has not been run.
 */
import { readFileSync, existsSync } from "node:fs";
import type { DirectorySite } from "@/lib/sites/directory";

const DIRECTORY_PATH = "data/site-directory.json";

let cache: DirectorySite[] | null = null;

export function loadDirectory(): DirectorySite[] {
  if (cache) return cache;
  try {
    cache = existsSync(DIRECTORY_PATH) ? (JSON.parse(readFileSync(DIRECTORY_PATH, "utf8")) as DirectorySite[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}
