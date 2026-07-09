/**
 * Request-time concept resolution, backed by the shared frozen concept-map.json.
 *
 * This replaces the old conceptId=0 / vocab-index.json path in transform.ts.
 * Resolution order for a criterion:
 *   1. the FROZEN entry from concept-map.json (by criterionId, then dx key, then
 *      field) — so the app reflects exactly the committed, human-reviewable map;
 *   2. a deterministic live fallback (`resolveEntry`) for criteria not in the map
 *      (e.g. freshly parsed protocols, tests) — same pure logic that built the
 *      map, no LLM and no network.
 *
 * Either way the output is pure and reproducible. The frozen map is the single
 * source of truth shared with the Python estimator (trialbridge/concept_map.py).
 */

import type { Criterion } from "@/lib/matcher/types";
import type { OmopConcept, VocabularyId } from "./types";
import { FIELD_CONCEPT_MAP, UNMAPPED_FIELD_CONCEPT } from "./vocabulary";
import { loadVocabIndex } from "./vocabIndex";
import { loadCid10Reference } from "./cid10";
import {
  loadConceptMap,
  resolveEntry,
  dxKeyFromValue,
  type ConceptMap,
  type ConceptMapEntry,
} from "./conceptMap";

interface ResolverIndex {
  byId: Map<string, ConceptMapEntry>;
  byField: Map<string, ConceptMapEntry>;
  byDxKey: Map<string, ConceptMapEntry>;
}

// undefined = not loaded; null = loaded and confirmed absent (live-only mode).
let index: ResolverIndex | null | undefined;

function buildIndex(): ResolverIndex | null {
  let map: ConceptMap;
  try {
    map = loadConceptMap();
  } catch {
    return null; // no frozen file yet — resolve everything live (still deterministic)
  }
  const idx: ResolverIndex = { byId: new Map(), byField: new Map(), byDxKey: new Map() };
  for (const e of map.entries) {
    idx.byId.set(e.criterionId, e);
    if (e.answerability === "datasus" && e.icd10) {
      if (!idx.byDxKey.has(e.key)) idx.byDxKey.set(e.key, e);
    } else if (!idx.byField.has(e.field)) {
      idx.byField.set(e.field, e);
    }
  }
  return idx;
}

function getIndex(): ResolverIndex | null {
  if (index === undefined) index = buildIndex();
  return index;
}

/** The ConceptMapEntry for a criterion — frozen if present, else live-resolved. */
export function resolveConceptEntry(c: Criterion): ConceptMapEntry {
  const idx = getIndex();
  if (idx) {
    const frozen =
      idx.byId.get(c.id) ??
      (c.field === "diagnosis" ? idx.byDxKey.get(dxKeyFromValue(c.value)) : idx.byField.get(c.field));
    if (frozen) return frozen;
  }
  // Live fallback: same deterministic logic that built the map.
  return resolveEntry(c, loadCid10Reference());
}

/**
 * Map a resolved entry to the OmopConcept shape transform.ts emits. `verified`
 * and `needsMapping` derive from whether a real concept_id was resolved — the
 * same external contract the previous resolver exposed (see omop-transform.test).
 *
 * An optional Athena vocabulary bundle (data/vocab-index.json, absent by
 * default) upgrades a matching concept to a verified concept_id — this is the
 * "drop in a vocab bundle" path; without it, SNOMED concept_ids stay
 * needsMapping, honestly flagged.
 */
export function entryToOmopConcept(entry: ConceptMapEntry): OmopConcept {
  const baseName = FIELD_CONCEPT_MAP[entry.field]?.conceptName ?? UNMAPPED_FIELD_CONCEPT.conceptName;
  let conceptId = entry.conceptId;
  let conceptName = baseName;
  let vocabularyId: VocabularyId = entry.vocabulary;

  const indexed = loadVocabIndex()?.[baseName];
  if (indexed) {
    conceptId = indexed.conceptId;
    conceptName = indexed.conceptName;
    vocabularyId = indexed.vocabularyId as VocabularyId;
  }

  return {
    domain: entry.domain,
    table: entry.table,
    vocabularyId,
    conceptId,
    conceptName,
    verified: conceptId !== 0,
    needsMapping: conceptId === 0,
  };
}

/** Convenience: resolve a criterion straight to its OmopConcept. */
export function resolveConcept(c: Criterion): OmopConcept {
  return entryToOmopConcept(resolveConceptEntry(c));
}

/** Test-only: reset the module-level index between cases. */
export function __resetConceptResolverCacheForTests(): void {
  index = undefined;
}
