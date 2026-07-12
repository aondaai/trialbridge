/**
 * Learning loop (F5-3) — every human edit improves the next form (spec §6, US-6).
 *
 * Two write-backs, as pure record builders (the server action persists them):
 *   1. Concept mapping: when a coordinator maps an unmapped field to a concept, that
 *      phrasing becomes a new synonym → the classifier catches it next time. This grows
 *      the PT-BR synonym layer the reconciliation doc flags as new work.
 *   2. RAG index: when a D (narrative) answer is APPROVED, its text is indexed as a
 *      PriorFormAnswer → future drafts retrieve it as an exemplar.
 *
 * Pure and deterministic. `approvedAt` is injected (never clock-read).
 */

import { normalize } from "./ingest";
import type { PriorAnswer } from "./rag";

/** A learned synonym to persist into concept_synonym (source = 'human'). */
export interface LearnedSynonym {
  conceptId: string;
  /** Normalized term (accent-folded, lowercased) — how it will be matched. */
  term: string;
  lang: string;
  source: "human" | "form";
}

/**
 * Turn a human concept mapping (label phrasing → concept) into a synonym record. The
 * stored term is normalized so the classifier's synonym rung matches it directly. Returns
 * null for an empty label (nothing to learn).
 */
export function synonymWriteback(
  conceptId: string,
  labelPhrasing: string,
  source: "human" | "form" = "human",
): LearnedSynonym | null {
  const term = normalize(labelPhrasing);
  if (!term || !conceptId) return null;
  return { conceptId, term, lang: "pt-BR", source };
}

/** A D answer eligible for RAG indexing (approved narrative only). */
export interface ApprovedNarrative {
  siteId: string;
  section: string;
  label: string;
  conceptId?: string | null;
  answerText: string;
  status: string;
}

/**
 * Index an APPROVED narrative answer as a PriorFormAnswer for future retrieval. Returns
 * null unless the answer is approved and non-empty — an un-approved draft is never
 * indexed (the RAG memory holds only human-signed-off text; no PHI, spec §9).
 */
export function indexApprovedNarrative(
  answer: ApprovedNarrative,
  approvedAt: string,
): (PriorAnswer & { siteId: string; approvedAt: string }) | null {
  if (answer.status !== "approved") return null;
  if (!answer.answerText.trim()) return null;
  return {
    // Stable on (site, label) — NOT the timestamp — so re-approving the same field UPDATES the
    // one exemplar (persist via upsert) instead of minting near-duplicates that skew retrieval.
    id: `${answer.siteId}:${normalize(answer.label).replace(/\s+/g, "_")}`,
    siteId: answer.siteId,
    section: answer.section,
    label: answer.label,
    conceptId: answer.conceptId ?? null,
    answerText: answer.answerText,
    approvedAt,
  };
}
