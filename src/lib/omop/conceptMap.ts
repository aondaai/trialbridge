/**
 * The unified concept map — one frozen artifact, two readers (this app's
 * transform layer and the Python estimator). It replaces the two disjoint
 * half-maps that existed before: the conceptId=0 `FIELD_CONCEPT_MAP` path and
 * the hand-typed `dx_cid_prefixes` in the estimator's data.py.
 *
 * Each entry follows the §2.2 concept-set contract from
 * outputs/.../ARQUITETURA_Texto-NCT_para_OMOP_com_DataSUS.md (domain,
 * vocabulary, concept_id, source_code, assertion, temporality,
 * value_constraint, answerability, inclusion) plus the provenance the repo's
 * honesty discipline demands (anchoredBy, confidence, needsReview,
 * needsMapping).
 *
 * BUILD-time vs REQUEST-time: `buildConceptMap` runs offline (it may, in F006,
 * call Claude as an anchor fallback). The map it writes is pure data; the
 * readers do lookups only — no LLM, no network at request time.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Criterion, Operator, CriterionValue } from "@/lib/matcher/types";
import type { OmopDomain, OmopTable, VocabularyId } from "./types";
import { FIELD_CONCEPT_MAP, UNMAPPED_FIELD_CONCEPT, VERIFIED_GENDER_CONCEPTS } from "./vocabulary";
import {
  anchorLexical,
  classifyAnswerability,
  expandMembers,
  expandPrefixes,
  loadCid10Reference,
  normalizeTerm,
  type Answerability,
  type Cid10Reference,
  type MatchKind,
} from "./cid10";

export type Assertion3 = "present" | "absent" | "history";
export type AnchoredBy = "lexical" | "model" | "verified";

export interface ValueConstraint {
  operator: Operator;
  value: CriterionValue;
  unit: string | null;
}

export interface Icd10Binding {
  /** The `condition_source_value LIKE '<prefix>%'` join keys (3-char CID-10). */
  prefixes: string[];
  /** Expanded member codes present in the reference — provenance/UI only. */
  members: string[];
}

export interface ConceptMapEntry {
  criterionId: string;
  /** Stable concept key: a dx key ("breast_cancer") or the field id ("her2_status"). */
  key: string;
  /** The original Criterion.field this entry came from (e.g. "diagnosis", "her2_status"). */
  field: string;
  textOriginal: string;
  inclusion: boolean;
  assertion: Assertion3;
  domain: OmopDomain;
  table: OmopTable;
  /** Standard-target vocabulary (SNOMED for conditions; LOINC for labs; Gender; None). */
  vocabulary: VocabularyId;
  /** Standard OMOP concept_id; 0 = unmapped (OMOP convention). */
  conceptId: number;
  /** Representative source code (e.g. a CID-10 prefix "C50", or "F"/"M" for gender). */
  sourceCode: string | null;
  needsMapping: boolean;
  answerability: Answerability;
  temporality: { window: string; anchor: string };
  valueConstraint: ValueConstraint | null;
  /** Present for base-tier (datasus) condition entries; null otherwise. */
  icd10: Icd10Binding | null;
  anchoredBy: AnchoredBy;
  matchedOn: MatchKind | null;
  confidence: number;
  needsReview: boolean;
  provenance: string;
}

export interface ConceptMap {
  version: string;
  contract: string;
  generatedFrom: string[];
  /** Convenience aggregate the Python estimator reads directly as dx_cid_prefixes. */
  dxPrefixes: Record<string, string[]>;
  entries: ConceptMapEntry[];
}

export interface ProtocolInput {
  nct: string;
  criteria: Criterion[];
}

/**
 * OFFLINE-ONLY anchor fallback: given a diagnosis the lexical layer couldn't
 * resolve, propose CID-10 code(s). Injected by the build CLI (where it may call
 * Claude). NEVER passed on the request-time path — the resolver stays LLM-free.
 * Anything it returns is marked anchoredBy="model" + needsReview=true.
 */
export type AnchorFallback = (term: string) => { codes: string[]; note?: string } | null;

/** "breast cancer" -> "breast_cancer" (the dx key both sides agree on). */
export function dxKeyFromValue(value: CriterionValue): string {
  const s = Array.isArray(value) ? value.join(" ") : String(value ?? "");
  return normalizeTerm(s).replace(/ /g, "_");
}

function assertionFor(kind: Criterion["kind"]): Assertion3 {
  return kind === "inclusion" ? "present" : "absent";
}

function valueConstraintFor(c: Criterion): ValueConstraint | null {
  // exists/not_exists carry no value to constrain on.
  if (c.operator === "exists" || c.operator === "not_exists") return null;
  return { operator: c.operator, value: c.value, unit: c.unit ?? null };
}

/**
 * Resolve one criterion into a concept-map entry. Diagnoses anchor to CID-10
 * via the reference (lexical); other fields resolve through the human-authored
 * FIELD_CONCEPT_MAP (their domain/vocabulary is trusted; concept_id stays
 * needsMapping until a vocabulary bundle is loaded). Gender values resolve to
 * verified OMOP concept_ids.
 */
export function resolveEntry(c: Criterion, ref: Cid10Reference, fallback?: AnchorFallback): ConceptMapEntry {
  const base = FIELD_CONCEPT_MAP[c.field] ?? UNMAPPED_FIELD_CONCEPT;
  const answerability = classifyAnswerability(c.field);
  const common = {
    criterionId: c.id,
    field: c.field,
    textOriginal: c.rawText,
    inclusion: c.kind === "inclusion",
    assertion: assertionFor(c.kind),
    domain: base.domain as OmopDomain,
    table: base.table as OmopTable,
    vocabulary: base.vocabularyId as VocabularyId,
    answerability,
    temporality: { window: "any", anchor: "index" },
    valueConstraint: valueConstraintFor(c),
    confidence: c.confidence,
  };

  // --- Diagnosis: lexical CID-10 anchor (the base-cohort join) ---
  if (c.field === "diagnosis") {
    const key = dxKeyFromValue(c.value);
    const anchor = anchorLexical(String(c.value ?? ""), ref);
    const prefixes = expandPrefixes(anchor.codes);

    if (prefixes.length > 0) {
      return {
        ...common,
        key,
        conceptId: 0, // standard SNOMED concept_id requires a vocabulary bundle (needsMapping)
        sourceCode: prefixes[0],
        needsMapping: true,
        icd10: { prefixes, members: expandMembers(prefixes, ref) },
        anchoredBy: "lexical",
        matchedOn: anchor.matchedOn,
        needsReview: false,
        provenance: `lexical anchor -> CID-10 ${prefixes.join(",")} (${anchor.matchedOn}); SNOMED concept_id needs a vocabulary bundle`,
      };
    }

    // Lexical miss: try the offline model fallback (build-time only). Anything it
    // proposes is model-anchored and MUST be human-reviewed before it is trusted.
    const fb = fallback ? fallback(String(c.value ?? "")) : null;
    if (fb && fb.codes.length > 0) {
      const fbPrefixes = expandPrefixes(fb.codes);
      return {
        ...common,
        key,
        conceptId: 0,
        sourceCode: fbPrefixes[0],
        needsMapping: true,
        icd10: { prefixes: fbPrefixes, members: expandMembers(fbPrefixes, ref) },
        anchoredBy: "model",
        matchedOn: null,
        needsReview: true,
        provenance: `model-proposed CID-10 ${fbPrefixes.join(",")}${fb.note ? ` (${fb.note})` : ""} — NEEDS HUMAN REVIEW before trusting`,
      };
    }

    // No lexical match and no (successful) fallback.
    return {
      ...common,
      key,
      conceptId: 0,
      sourceCode: null,
      needsMapping: true,
      icd10: null,
      anchoredBy: "lexical",
      matchedOn: null,
      needsReview: true,
      provenance: `lexical anchor found no CID-10 match for "${String(c.value)}" — needs review / model fallback`,
    };
  }

  // --- Gender: verified OMOP concept by value ---
  if (c.field === "sex" && typeof c.value === "string") {
    const known = VERIFIED_GENDER_CONCEPTS[c.value.toLowerCase()];
    if (known !== undefined) {
      return {
        ...common,
        key: "sex",
        conceptId: known,
        sourceCode: c.value.toUpperCase().slice(0, 1),
        needsMapping: false,
        icd10: null,
        anchoredBy: "verified",
        matchedOn: "exact",
        needsReview: false,
        provenance: `verified OMOP Gender concept ${known}`,
      };
    }
  }

  // --- Everything else: FIELD_CONCEPT_MAP (curated) or unmapped fallback ---
  const isKnownField = c.field in FIELD_CONCEPT_MAP;
  const conceptId = base.conceptId ?? 0;
  // vocabulary "None" (e.g. age, derived from year_of_birth) is not concept-coded,
  // so it is not "unmapped" — only concept-coded fields with conceptId 0 are.
  const needsMapping = conceptId === 0 && base.vocabularyId !== "None";
  return {
    ...common,
    key: c.field,
    conceptId,
    sourceCode: null,
    needsMapping,
    icd10: null,
    // FIELD_CONCEPT_MAP is human-authored from the OMOP CDM spec, so a known
    // field's domain/vocabulary is "verified" even while its concept_id is
    // still needsMapping. An unknown field has no anchor at all -> needsReview.
    anchoredBy: "verified",
    matchedOn: null,
    needsReview: !isKnownField,
    provenance: isKnownField
      ? `FIELD_CONCEPT_MAP: ${base.domain}/${base.table}/${base.vocabularyId}${needsMapping ? " (concept_id needs a vocabulary bundle)" : ""}`
      : `no field mapping for "${c.field}" — needs review`,
  };
}

/** Aggregate all base-tier diagnosis entries into { dxKey: prefixes }. */
export function buildDxPrefixes(entries: ConceptMapEntry[]): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const e of entries) {
    if (e.answerability === "datasus" && e.icd10 && e.key) {
      out[e.key] ??= new Set();
      for (const p of e.icd10.prefixes) out[e.key].add(p);
    }
  }
  const result: Record<string, string[]> = {};
  for (const [k, set] of Object.entries(out)) result[k] = [...set].sort();
  return result;
}

/** Build the full concept map from one or more parsed protocols. `fallback` is
 * an OFFLINE-only anchor fallback (build CLI passes a Claude-backed one). */
export function buildConceptMap(
  protocols: ProtocolInput[],
  ref?: Cid10Reference,
  fallback?: AnchorFallback,
): ConceptMap {
  const reference = ref ?? loadCid10Reference();
  const entries: ConceptMapEntry[] = [];
  for (const p of protocols) {
    for (const c of p.criteria) entries.push(resolveEntry(c, reference, fallback));
  }
  return {
    version: "1",
    contract: "§2.2 concept-set (ARQUITETURA_Texto-NCT_para_OMOP_com_DataSUS.md)",
    generatedFrom: protocols.map((p) => p.nct),
    dxPrefixes: buildDxPrefixes(entries),
    entries,
  };
}

// ---- Shared concept-map.json location + IO (repo root) ----

/**
 * concept-map.json lives inside the trialbridge package (cwd under Vitest, Next
 * dev, and the web Docker image where WORKDIR=/app holds the package). This
 * keeps it inside the deployable build context. TB_CONCEPT_MAP overrides it
 * (the estimator image sets it explicitly).
 */
export function conceptMapPath(): string {
  return process.env.TB_CONCEPT_MAP ?? resolve(process.cwd(), "concept-map.json");
}

export function writeConceptMap(map: ConceptMap, path = conceptMapPath()): void {
  writeFileSync(path, JSON.stringify(map, null, 2) + "\n");
}

export function loadConceptMap(path = conceptMapPath()): ConceptMap {
  return JSON.parse(readFileSync(path, "utf8")) as ConceptMap;
}
