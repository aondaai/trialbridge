/**
 * Prior-answer RAG memory (F4-1) — retrieval over approved narrative answers.
 *
 * Archetype D drafts are grounded in the site's OWN prior form answers (spec §6.4): given
 * a field, retrieve the most similar prior answers and hand them to the narrative resolver
 * as exemplars. Retrieval is keyword/overlap-based ("embedding-lite") and PURE — no I/O, no
 * pgvector. When real embeddings are wanted they live in the Python estimator (reconciliation
 * decision), and `PriorAnswer.embedding` carries them; the scorer here degrades gracefully
 * to lexical overlap, which is enough for the exemplar-retrieval use.
 *
 * Privacy: prior answers store ANSWER TEXT only, never patient rows (spec §9).
 */

import { normalize } from "./ingest";

export interface PriorAnswer {
  id: string;
  section: string;
  label: string;
  conceptId?: string | null;
  answerText: string;
}

export interface RetrievedAnswer extends PriorAnswer {
  score: number;
}

/** Tokenize accent-folded text into content tokens (drops 1–2 char stopword-ish tokens). */
export function tokenize(s: string): string[] {
  return normalize(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

/** Jaccard-ish overlap of two token sets (0..1). */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface RetrievalQuery {
  label: string;
  section?: string | null;
  conceptId?: string | null;
}

/**
 * Retrieve the top-k most relevant prior answers. Score = label token overlap (0..1), plus a
 * bonus for a matching section (+0.25) and a stronger bonus for a matching concept (+0.5) — a
 * concept match is a strong signal two answers are about the same thing, decisive when lexical
 * overlap is comparable, without letting it override a much closer textual match.
 */
export function retrievePriorAnswers(
  query: RetrievalQuery,
  priors: PriorAnswer[],
  k = 3,
): RetrievedAnswer[] {
  const qTokens = new Set(tokenize(query.label));
  const qSection = query.section ? normalize(query.section) : null;

  const scored = priors.map((p) => {
    let score = overlap(qTokens, new Set(tokenize(p.label)));
    if (qSection && normalize(p.section) === qSection) score += 0.25;
    if (query.conceptId && p.conceptId && query.conceptId === p.conceptId) score += 0.5;
    return { ...p, score };
  });

  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
