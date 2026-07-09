/**
 * The deterministic CID-10 (ICD-10 WHO) backbone of the concept resolver.
 *
 * Everything here is PURE (except `loadCid10Reference`, which reads the frozen
 * `data/reference/cid10-onco.json` once). No LLM, no network — this is the
 * request-time-safe core the design promises. The one fuzzy step, anchoring a
 * free-text diagnosis to codes, is deliberately conservative: it matches on
 * whole specific tokens, so "breast cancer" resolves to C50 and "lung cancer"
 * to {C33, C34}, but a bare "cancer" matches nothing (→ needsReview) rather
 * than everything.
 *
 * The 3-char categories a diagnosis resolves to become the
 * `condition_source_value LIKE '<code>%'` prefixes the DataSUS base cohort
 * keys on (condition_concept_id is unmapped in the export — see
 * outputs/trialbridge_estimator/trialbridge/data.py).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface Cid10Entry {
  title: string;
  synonyms: string[];
  parent?: string;
}

/** code -> entry. `_meta` is stripped by the loader/normalizer. */
export type Cid10Reference = Record<string, Cid10Entry>;

/** How an anchor was found — surfaced on every resolved entry for auditability. */
export type MatchKind = "exact" | "substring";

export interface AnchorResult {
  /** Sorted, de-duplicated 3-char CID-10 categories the term resolved to. */
  codes: string[];
  matchedOn: MatchKind | null;
  /** Number of distinct categories matched (a large count is a review signal). */
  candidateCount: number;
}

/**
 * Fields a DataSUS-in-OMOP export can answer exactly: they are the base-cohort
 * strata (dx × age × sex) plus geography carried on the person row. Everything
 * else (biomarkers, stage, performance status, prior therapy) is depth — no
 * coverage in the export, estimated via the enrichment model.
 */
export const DATASUS_FIELDS: ReadonlySet<string> = new Set(["diagnosis", "age", "sex"]);

export type Answerability = "datasus" | "depth" | "ambos";

/** diagnosis/age/sex → datasus (base), everything else → depth. */
export function classifyAnswerability(field: string): Answerability {
  return DATASUS_FIELDS.has(field) ? "datasus" : "depth";
}

/**
 * Generic oncology words that carry no discriminating power — a match must
 * share at least one NON-generic token, so "cancer" alone never anchors.
 */
const GENERIC_TOKENS: ReadonlySet<string> = new Set([
  "cancer", "carcinoma", "neoplasm", "neoplasia", "malignant", "malignancy",
  "tumor", "tumour", "ca", "disease", "of", "the", "and", "de", "do", "da",
]);

/** lowercase, strip punctuation to spaces, collapse whitespace. */
export function normalizeTerm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // drop diacritics so "pulmão" == "pulmao"
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function specificTokens(normalized: string): string[] {
  return normalized.split(" ").filter((t) => t.length > 0 && !GENERIC_TOKENS.has(t));
}

/** All non-`a`-elements of `a` appear in `b`. */
function subset(a: string[], b: string[]): boolean {
  if (a.length === 0) return false;
  const set = new Set(b);
  return a.every((t) => set.has(t));
}

/**
 * Resolve a free-text diagnosis to the CID-10 categories it names. Exact
 * (normalized) match on a title/synonym wins; otherwise the term and a
 * title/synonym must share all specific tokens in one direction (so
 * "non-small cell lung cancer" still resolves via the "lung cancer" label,
 * but unrelated categories are never dragged in).
 */
export function anchorLexical(term: string, ref: Cid10Reference): AnchorResult {
  const q = normalizeTerm(term);
  const qTokens = specificTokens(q);
  const matched = new Map<string, boolean>(); // 3-char code -> wasExact

  for (const [code, entry] of Object.entries(ref)) {
    const cat = code.slice(0, 3).toUpperCase();
    const labels = [entry.title, ...(entry.synonyms ?? [])];
    let exact = false;
    let hit = false;
    for (const label of labels) {
      const c = normalizeTerm(label);
      if (c === q) {
        exact = true;
        hit = true;
        break;
      }
      const cTokens = specificTokens(c);
      if (subset(qTokens, cTokens) || subset(cTokens, qTokens)) {
        hit = true;
      }
    }
    if (hit) matched.set(cat, (matched.get(cat) ?? false) || exact);
  }

  const codes = [...matched.keys()].sort();
  const anyExact = [...matched.values()].some(Boolean);
  return {
    codes,
    matchedOn: codes.length === 0 ? null : anyExact ? "exact" : "substring",
    candidateCount: codes.length,
  };
}

/**
 * The DataSUS join prefixes for a set of resolved codes: the distinct 3-char
 * categories, sorted. `condition_source_value LIKE 'C50%'` already captures
 * every sub-code, so 3-char granularity is the correct join key.
 */
export function expandPrefixes(codes: string[]): string[] {
  return [...new Set(codes.map((c) => c.slice(0, 3).toUpperCase()))].sort();
}

/**
 * The full concept-set member codes for provenance/UI: every reference code
 * that falls under one of the prefixes (the prefix itself + any listed
 * sub-codes). Distinct from `expandPrefixes` — this is the expanded set, not
 * the join key.
 */
export function expandMembers(prefixes: string[], ref: Cid10Reference): string[] {
  const out = new Set<string>();
  for (const code of Object.keys(ref)) {
    const up = code.toUpperCase();
    if (prefixes.some((p) => up.startsWith(p))) out.add(up);
  }
  for (const p of prefixes) out.add(p);
  return [...out].sort();
}

let cache: Cid10Reference | null | undefined;

function referencePath(): string {
  // cwd is the trialbridge package dir under both Vitest and Next.
  return resolve(process.cwd(), "data", "reference", "cid10-onco.json");
}

/** Strip the leading `_meta` key so the object is a clean code->entry map. */
export function stripMeta(raw: Record<string, unknown>): Cid10Reference {
  const out: Cid10Reference = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "_meta") continue;
    out[k] = v as Cid10Entry;
  }
  return out;
}

/** Load and memoize the frozen oncology CID-10 reference. */
export function loadCid10Reference(): Cid10Reference {
  if (cache !== undefined && cache !== null) return cache;
  const raw = JSON.parse(readFileSync(referencePath(), "utf8")) as Record<string, unknown>;
  cache = stripMeta(raw);
  return cache;
}

/** Test-only: reset the module-level cache between cases. */
export function __resetCid10CacheForTests(): void {
  cache = undefined;
}
