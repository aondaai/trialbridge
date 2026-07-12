/**
 * Core matching logic behind `scripts/build-vocab-index.ts`. Separated from
 * the CLI wrapper so it's directly testable with small in-memory fixtures —
 * you should never need the real (large, licensed) Athena bundle to verify
 * this logic works.
 *
 * Input: rows from the Athena OMOP vocabulary CONCEPT.csv export (tab-
 * delimited — the real Athena download format). Output: a small
 * `VocabIndex` keyed by the `conceptName` strings already used in
 * `src/lib/omop/vocabulary.ts`'s `FIELD_CONCEPT_MAP`.
 *
 * Matching is a best-effort heuristic (case-insensitive exact match, then
 * substring containment either direction) — it is explicitly NOT a
 * guarantee of correctness. Anything it matches still deserves a human
 * glance before being trusted in a pitch (same "verify before you rely on
 * it" discipline as the rest of this repo — docs/citations.md,
 * docs/omop-vocabulary-mapping.md).
 */

import type { VocabIndex, VocabIndexEntry } from "./vocabIndex";

export interface AthenaConceptRow {
  concept_id: string;
  concept_name: string;
  domain_id: string;
  vocabulary_id: string;
  concept_class_id: string;
  standard_concept: string;
  concept_code: string;
}

const ALLOWED_VOCABULARIES = new Set(["SNOMED", "LOINC", "RxNorm", "Gender"]);

/** Parse the real Athena CONCEPT.csv export: tab-delimited, header-driven (no fixed column order assumed). */
export function parseConceptTsv(content: string): AthenaConceptRow[] {
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);

  const idxId = col("concept_id");
  const idxName = col("concept_name");
  const idxDomain = col("domain_id");
  const idxVocab = col("vocabulary_id");
  const idxClass = col("concept_class_id");
  const idxStandard = col("standard_concept");
  const idxCode = col("concept_code");

  const rows: AthenaConceptRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split("\t");
    rows.push({
      concept_id: cells[idxId] ?? "",
      concept_name: cells[idxName] ?? "",
      domain_id: cells[idxDomain] ?? "",
      vocabulary_id: cells[idxVocab] ?? "",
      concept_class_id: idxClass >= 0 ? cells[idxClass] ?? "" : "",
      standard_concept: idxStandard >= 0 ? cells[idxStandard] ?? "" : "",
      concept_code: idxCode >= 0 ? cells[idxCode] ?? "" : "",
    });
  }
  return rows;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * For each `conceptName` we need mapped (from FIELD_CONCEPT_MAP), find the
 * best candidate among standard concepts in an allowed vocabulary family.
 * Exact (case-insensitive) name match wins; otherwise the shortest standard
 * concept whose name contains (or is contained by) the target string — but
 * only when the overlap is substantial (see `substringOverlapOk`).
 */

// Substring containment alone is not enough: the real Athena bundle contains
// 1–2 character standard concept names (e.g. the LOINC answers "O", "I"), and
// since "shortest wins", such a fragment is a substring of almost every long
// field name and would spuriously win every time — resolving "Hemoglobin" to
// concept "O", "HER2 status" to "I", etc. That is worse than an honest
// needsMapping. Require the shorter of the two strings to be a real token, not
// a sliver: at least 5 chars AND at least half the length of the longer one.
// The legitimate case this must keep — "serum creatinine" inside "serum
// creatinine measurement" — has ratio 16/28 ≈ 0.57, comfortably above 0.5.
const MIN_SUBSTRING_LEN = 5;
const MIN_SUBSTRING_RATIO = 0.5;
function substringOverlapOk(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!long.includes(short)) return false;
  return short.length >= MIN_SUBSTRING_LEN && short.length / long.length >= MIN_SUBSTRING_RATIO;
}

/**
 * A field to resolve: its `conceptName` plus, optionally, the vocabulary it is
 * declared to live in (FIELD_CONCEPT_MAP.vocabularyId). When `vocabularyId` is
 * given, a match is only accepted from that same vocabulary — otherwise the
 * OMOP preview row is internally inconsistent (its Vocabulary column would say
 * LOINC while the resolved concept_id came from SNOMED or RxNorm). "None"
 * (age, which isn't concept-coded) means "never resolve".
 */
export type FieldToResolve = string | { conceptName: string; vocabularyId?: string };

function asField(f: FieldToResolve): { conceptName: string; vocabularyId?: string } {
  return typeof f === "string" ? { conceptName: f } : f;
}

export interface BuildOptions {
  /**
   * Whether to fall back to substring containment when there's no exact name
   * match. Substring hits are heuristic guesses that the repo's doctrine says
   * a human must review before a pitch (e.g. "Hemoglobin" would substring-match
   * the unrelated LOINC concept "Hemoglobin casts"), so the deployed index is
   * built exact-only. Defaults to true for library callers/tests.
   */
  allowSubstring?: boolean;
}

export function buildVocabIndexFromConcepts(
  concepts: AthenaConceptRow[],
  fields: FieldToResolve[],
  options: BuildOptions = {},
): { index: VocabIndex; unmatched: string[] } {
  const { allowSubstring = true } = options;
  const standard = concepts.filter(
    (c) => c.standard_concept === "S" && ALLOWED_VOCABULARIES.has(c.vocabulary_id),
  );

  const index: VocabIndex = {};
  const unmatched: string[] = [];

  for (const field of fields) {
    const { conceptName, vocabularyId } = asField(field);
    const target = norm(conceptName);

    // A declared vocabulary of "None" (e.g. age) is never concept-resolvable.
    if (vocabularyId === "None") {
      unmatched.push(conceptName);
      continue;
    }
    // Resolve only within the field's declared vocabulary, when one is given,
    // so the resolved concept can never contradict the row's Vocabulary column.
    const pool = vocabularyId
      ? standard.filter((c) => c.vocabulary_id === vocabularyId)
      : standard;

    const exact = pool.find((c) => norm(c.concept_name) === target);
    const candidate =
      exact ??
      (allowSubstring
        ? pool
            .filter((c) => substringOverlapOk(norm(c.concept_name), target))
            .sort((a, b) => a.concept_name.length - b.concept_name.length)[0]
        : undefined);

    if (!candidate) {
      unmatched.push(conceptName);
      continue;
    }

    const entry: VocabIndexEntry = {
      conceptId: Number(candidate.concept_id),
      conceptName: candidate.concept_name,
      vocabularyId: candidate.vocabulary_id,
      matchedOn: exact ? "exact" : "substring",
    };
    index[conceptName] = entry;
  }

  return { index, unmatched };
}
