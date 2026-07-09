/**
 * Loads `data/vocab-index.json`, built by `scripts/build-vocab-index.ts`
 * from a locally-downloaded Athena vocabulary bundle (`data/vocab/`,
 * gitignored — licensed data, never committed). Absent by default:
 * `resolveConcept()` in `src/lib/omop/transform.ts` falls back to the
 * honest `needsMapping: true` default when this returns null, so Phase 1
 * behavior is unchanged until the index is actually built — see
 * docs/omop-vocabulary-mapping.md.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface VocabIndexEntry {
  conceptId: number;
  conceptName: string;
  vocabularyId: string;
  matchedOn: "exact" | "substring";
}

export type VocabIndex = Record<string, VocabIndexEntry>;

// undefined = not loaded yet this process; null = loaded and confirmed absent.
let cache: VocabIndex | null | undefined;

function vocabIndexPath(): string {
  return resolve(process.cwd(), "data", "vocab-index.json");
}

/** Load data/vocab-index.json once per process. Returns null if it doesn't exist. */
export function loadVocabIndex(): VocabIndex | null {
  if (cache !== undefined) return cache;
  const p = vocabIndexPath();
  if (!existsSync(p)) {
    cache = null;
    return cache;
  }
  cache = JSON.parse(readFileSync(p, "utf8")) as VocabIndex;
  return cache;
}

/** Test-only: reset the module-level cache between test cases. */
export function __resetVocabIndexCacheForTests(): void {
  cache = undefined;
}
