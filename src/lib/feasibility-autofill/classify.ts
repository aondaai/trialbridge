/**
 * Field classifier (F1-2) — the make-or-break step (spec §6.2).
 *
 * Assigns each form field (a) an ARCHETYPE (A/B/C/D) from section + cell-type + concept
 * cues, and (b) a canonical CONCEPT via a first-hit-wins ladder:
 *   1. exact synonym match (PT-BR aware, accent-folded)
 *   2. vocabulary CODE match (CID-10 / LOINC / ATC regex in the label)
 *   3. Claude shortlist fallback (injected, optional; never free-form; human-confirmed)
 *   4. unmapped → flagged for review, NEVER guessed.
 *
 * Deterministic and pure for the first two rungs (what the tests grade); the Claude rung
 * is a pluggable async hook so the pure path stays offline. Misses surface as
 * `concept: null, method: "unmapped"` — the classifier never fabricates a concept.
 */

import type { Archetype } from "./fixtures/questionBankLabels";
import { normalize } from "./ingest";

export type ClassifyMethod = "synonym" | "code" | "shortlist" | "section" | "unmapped";

export interface FieldInput {
  section: string;
  label: string;
  cellType?: string;
}

export interface Classification {
  archetype: Archetype;
  /** Canonical concept slug, or null when unmapped (flagged, not guessed). */
  concept: string | null;
  /** Which rung produced the concept (or how the archetype was decided). */
  method: ClassifyMethod;
  confidence: "high" | "medium" | "low";
}

/**
 * Concept synonym index. Seeded from the QuestionBank capability catalog plus a compact
 * PT-BR clinical lexicon covering the canonical variable matrix (V-01…V-13). This is the
 * new PT-BR synonym layer the reconciliation doc flags as genuinely-new work; it grows via
 * the F5 learning loop (edit → concept_synonym write-back).
 */
export const CONCEPT_SYNONYMS: Record<string, string[]> = {
  age: ["idade", "age", "birthdate", "data de nascimento", "faixa etaria"],
  sex: ["sexo", "genero", "gender"],
  race: ["etnia", "raca", "cor", "race", "ethnicity"],
  payer: ["cobertura", "pagador", "payer", "convenio", "plano de saude"],
  ibd: ["dii", "ibd", "crohn", "doenca de crohn", "retocolite", "retocolite ulcerativa", "colite ulcerativa", "doenca inflamatoria intestinal", "k50", "k51"],
  dyslipidemia: ["dislipidemia", "e78", "colesterol alto", "hipercolesterolemia"],
  diagnosis_primary: ["diagnostico principal", "cid principal"],
  diagnosis_active: ["diagnostico ativo", "assertion", "presente", "confirmavel"],
  diagnosis_date: ["data do diagnostico", "document_date", "data diagnostico"],
  myocardial_infarction: ["iam", "infarto", "infarto agudo do miocardio", "infarto do miocardio", "i21"],
  stroke: ["avc", "acidente vascular cerebral", "derrame", "i63", "i64", "stroke"],
  pad: ["dap", "doenca arterial periferica", "i73", "peripheral artery"],
  t2dm: ["dm2", "diabetes mellitus tipo 2", "diabetes tipo 2", "e11", "type 2 diabetes"],
  hypertension: ["has", "hipertensao", "hipertensao arterial", "i10", "hypertension"],
  ckd: ["drc", "doenca renal cronica", "n18", "chronic kidney"],
  heart_failure: ["ic", "insuficiencia cardiaca", "i50", "heart failure"],
  comorbidities: ["comorbidade", "comorbidades"],
  lab_result: ["ldl", "colesterol ldl", "hdl", "colesterol hdl", "hba1c", "hemoglobina glicada", "pcr", "proteina c reativa", "laboratorial", "resultado laboratorial", "13457-7"],
  medication: ["medicamento", "medicacao", "droga", "atc", "classe terapeutica", "molecula", "estatina", "estatinas"],
  treatment_pattern: ["padrao de tratamento", "switch", "persistencia", "sequencia de tratamento"],
  resource_use: ["hospitalizacao", "ps", "obito", "custo", "utilizacao de recursos", "pronto socorro"],
  nlp_text: ["texto livre", "nlp", "ner", "conceitos extraiveis"],
};

/** Escape a string for use in a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Matcher = { concept: string; len: number; test: (n: string) => boolean };

/**
 * Build synonym matchers from a concept→terms map. A multi-word synonym matches as a substring;
 * a single token matches on WORD BOUNDARIES, so a 2–3 letter synonym ("mi", "dii", "ic") can't
 * shadow-match inside a longer word ("genômico"). Longer synonyms win ties (more specific).
 */
function buildMatchers(map: Record<string, string[]>): Matcher[] {
  const out: Matcher[] = [];
  for (const [concept, syns] of Object.entries(map)) {
    for (const s of syns) {
      const norm = normalize(s);
      if (!norm) continue;
      if (norm.includes(" ")) {
        out.push({ concept, len: norm.length, test: (n) => n.includes(norm) });
      } else {
        const re = new RegExp(`(^|[^a-z0-9])${escapeRe(norm)}([^a-z0-9]|$)`);
        out.push({ concept, len: norm.length, test: (n) => re.test(n) });
      }
    }
  }
  return out.sort((a, b) => b.len - a.len); // longest first
}

/** The built-in matchers (seed + lexicon). Learned synonyms (US-6) merge on top per call. */
const SYNONYM_MATCHERS: Matcher[] = buildMatchers(CONCEPT_SYNONYMS);

/** Vocabulary code patterns → concept, tried on the raw label (rung 2). */
const CODE_PATTERNS: Array<{ re: RegExp; concept: string }> = [
  { re: /\bK5[01]\b/i, concept: "ibd" },
  { re: /\bE78\b/i, concept: "dyslipidemia" },
  { re: /\bI21\b/i, concept: "myocardial_infarction" },
];

/** A LOINC code (NNNN[N]-N) only counts when the label is lab-ish — otherwise a year-range,
 *  process number, or phone fragment ("2024-1", "12345-6") would false-match as a lab result. */
const LOINC_RE = /\b\d{4,5}-\d\b/;
const LAB_CONTEXT = /\bloinc\b|\blab|\bexame|colesterol|\bldl\b|\bhdl\b|hba1c|\bpcr\b|resultado/;

/** Rung 1 — synonym hit; longest (most specific) synonym wins. Learned synonyms are tried first. */
function synonymMatch(label: string, learned?: Matcher[]): string | null {
  const n = normalize(label);
  if (learned) for (const m of learned) if (m.test(n)) return m.concept;
  for (const m of SYNONYM_MATCHERS) if (m.test(n)) return m.concept;
  return null;
}

/** Rung 2 — vocabulary code in the label. */
function codeMatch(label: string): string | null {
  for (const { re, concept } of CODE_PATTERNS) if (re.test(label)) return concept;
  if (LOINC_RE.test(label) && LAB_CONTEXT.test(normalize(label))) return "lab_result";
  return null;
}

// Section detection is KEYWORD-based (substring on the accent-folded section name) so it
// works for both full canonical names ("Informações da Instituição") and the abbreviated
// forms sponsors use on real forms ("Instituição", "Inf. Gerais", "Variáveis").
const RE_NARRATIVE = /interesse|desafio|limitac|coment/;
const RE_INSTITUTIONAL = /institui|responsav|descri|equipe|compliance|contrata|materia/;
const RE_POPULATION = /popula|contag/;
const RE_VARIABLES = /variav|matriz/;
const RE_TA_BLOCK = /bloco|area terapeutica|\bta\b/;

/** Count/population cues → archetype C. */
function isCountField(label: string, cellType?: string): boolean {
  const n = normalize(label);
  if (cellType === "number") return true;
  return (
    /\bN[º°]/.test(label) ||
    /\bquantos\b|\bquantidade\b|\bnumero\b|\bcontag|\bn por\b|\bcount\b|\bn estimado\b|aproximado de pacientes/.test(n)
  );
}

/**
 * Decide the archetype. Order matters: narrative and count/population cues win over the
 * section default, then institutional, then concept-bound → B.
 */
function classifyArchetype(input: FieldInput, concept: string | null): Archetype {
  const sec = normalize(input.section);
  const n = normalize(input.label);

  // D — free-text / judgment. "Título do estudo" is the one narrative field in Inf. Gerais.
  if (RE_NARRATIVE.test(sec)) return "D";
  if (/\btitulo do estudo\b/.test(n)) return "D";

  // C — a computed count / population-defining query (section or explicit count cue).
  if (RE_POPULATION.test(sec) || isCountField(input.label, input.cellType)) return "C";

  // A — static institutional facts (respondent id, contacts, roles, compliance, contracts).
  if (RE_INSTITUTIONAL.test(sec)) return "A";
  if (/\bid do estudo\b|respondente/.test(n)) return "A";

  // B — a concept-bound capability/metadata lookup (the variable matrix + TA block).
  if (RE_VARIABLES.test(sec) || RE_TA_BLOCK.test(sec)) return "B";
  if (concept) return "B";

  return "D";
}

/**
 * Classify a single field (deterministic rungs 1–2 + section rules). The Claude
 * shortlist rung is applied by `classifyWithShortlist`, keeping this path pure/offline.
 */
export function classifyField(input: FieldInput, learnedSynonyms?: Record<string, string[]>): Classification {
  const learned = learnedSynonyms ? buildMatchers(learnedSynonyms) : undefined;
  const synonym = synonymMatch(input.label, learned);
  const concept = synonym ?? codeMatch(input.label);
  const method: ClassifyMethod = synonym ? "synonym" : concept ? "code" : "section";
  const archetype = classifyArchetype(input, concept);

  // A concept-bound (B) field that produced no concept is UNMAPPED — flagged, not guessed.
  if (archetype === "B" && !concept) {
    return { archetype, concept: null, method: "unmapped", confidence: "low" };
  }
  return {
    archetype,
    concept,
    method,
    confidence: concept ? "high" : archetype === "D" ? "low" : "medium",
  };
}

/** Optional Claude shortlist resolver — picks a concept from a candidate set, never free-form. */
export type ShortlistResolver = (
  label: string,
  candidates: string[],
) => Promise<string | null>;

/**
 * Rung 3 — apply a Claude shortlist ONLY to fields that came back unmapped, choosing from
 * the known concept set. Human confirmation still required downstream (spec §6.2). If no
 * resolver is supplied, unmapped stays unmapped.
 */
export async function classifyWithShortlist(
  input: FieldInput,
  resolver?: ShortlistResolver,
): Promise<Classification> {
  const base = classifyField(input);
  if (base.method !== "unmapped" || !resolver) return base;
  const picked = await resolver(input.label, Object.keys(CONCEPT_SYNONYMS));
  if (picked && CONCEPT_SYNONYMS[picked]) {
    return { archetype: base.archetype, concept: picked, method: "shortlist", confidence: "medium" };
  }
  return base;
}
