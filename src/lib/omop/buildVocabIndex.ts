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
 * concept whose name contains (or is contained by) the target string.
 */
export function buildVocabIndexFromConcepts(
  concepts: AthenaConceptRow[],
  conceptNames: string[],
): { index: VocabIndex; unmatched: string[] } {
  const standard = concepts.filter(
    (c) => c.standard_concept === "S" && ALLOWED_VOCABULARIES.has(c.vocabulary_id),
  );

  const index: VocabIndex = {};
  const unmatched: string[] = [];

  for (const conceptName of conceptNames) {
    const target = norm(conceptName);

    const exact = standard.find((c) => norm(c.concept_name) === target);
    const candidate =
      exact ??
      standard
        .filter((c) => {
          const n = norm(c.concept_name);
          return n.includes(target) || target.includes(n);
        })
        .sort((a, b) => a.concept_name.length - b.concept_name.length)[0];

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
