/**
 * Feasibility form ingestion (F1-1).
 *
 * A sponsor feasibility questionnaire (16-section form) → `FormFieldDraft[]` + a
 * template fingerprint. This is the form-side counterpart to protocol intake: it
 * REUSES the intake envelope's text extraction (`extractDocumentText`, dependency-free
 * DOCX/PDF), then segments the text into the canonical sections and emits one draft
 * field per question line. Archetype/concept tagging is the classifier's job (F1-2);
 * here we only structure the form and recognize repeat templates (the MSD fingerprint).
 *
 * Pure and offline: no LLM, no I/O beyond the passed-in bytes/text.
 */

import { extractDocumentText } from "@/lib/intake/envelope";
import type { IntakeInput } from "@/lib/intake/types";
import {
  CANONICAL_SECTIONS,
  CANONICAL_FINGERPRINT,
  CANONICAL_NAME,
  primaryArchetype,
  type CanonicalSection,
} from "./canonicalTemplate";
import type { Archetype } from "./fixtures/questionBankLabels";

/** Cell shape inferred from the question line (spec form_field.cell_type). */
export type CellType = "checkbox" | "yes_no_partial" | "text" | "number" | "matrix_cell";

/** A parsed form field before answer resolution. */
export interface FormFieldDraft {
  section: string;
  label: string;
  cellType: CellType;
  /** Section's dominant archetype (a starting hint; the classifier may override per field). */
  archetypeHint: Archetype;
  orderIdx: number;
}

/** Template-recognition outcome. */
export interface TemplateRecognition {
  fingerprint: string;
  matched: boolean;
  templateName: string | null;
  /** Fraction of canonical sections detected in the form (0..1). */
  coverage: number;
  matchedSections: string[];
}

export interface IngestedForm {
  fields: FormFieldDraft[];
  recognition: TemplateRecognition;
  /** Section names detected, in document order. */
  sections: string[];
}

/** Accent-fold + lowercase + collapse whitespace, for robust PT-BR matching. */
export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const NORM_SECTIONS: Array<{ section: CanonicalSection; norm: string }> = CANONICAL_SECTIONS.map(
  (section) => ({ section, norm: normalize(section.name) }),
);

/**
 * Does a line announce a canonical section? Matching is deliberately tight — a header
 * is short and closely equals a canonical name (after stripping leading numbering and
 * trailing punctuation) — so ordinary question lines are never swallowed as headers.
 */
function matchSectionHeader(line: string): CanonicalSection | null {
  const n = normalize(line.replace(/^[\d.\s)–-]+/, "").replace(/[:.\s]+$/, ""));
  if (n.length === 0 || n.length > 45) return null;
  for (const { section, norm } of NORM_SECTIONS) {
    if (n === norm) return section;
    // Allow a header that begins with the section name plus a tiny suffix.
    if (n.startsWith(norm) && n.length - norm.length <= 2) return section;
  }
  return null;
}

/** Infer the cell type from a question line's surface features. */
export function inferCellType(line: string): CellType {
  const n = normalize(line);
  if (/\[\s*[xX ]?\s*\]|☐|☑|checkbox|marque/.test(line)) return "checkbox";
  if (/\bsim\s*\/\s*nao\b|\(sim\/nao\)|parcial/.test(n)) return "yes_no_partial";
  // Number cues: check the RAW line for Nº/N° (normalize folds º→o), plus folded words.
  if (/\bN[º°]/.test(line) || /\bnumero\b|\bquantos\b|\bquantidade\b|\bcontagem\b|\btotal de\b/.test(n))
    return "number";
  return "text";
}

/** Is a line plausibly a field/question (not blank, not just a heading fragment)? */
function isFieldLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 3) return false;
  if (/^[-=_*.\s]+$/.test(t)) return false; // rule/separator
  return true;
}

/**
 * Segment already-extracted form text into drafts. Lines that name a canonical
 * section switch the "current section"; subsequent lines become fields under it.
 * Lines before the first recognized section are collected under "Informações Gerais".
 */
export function parseFormText(text: string): IngestedForm {
  const lines = text.split(/\r?\n/);
  const fields: FormFieldDraft[] = [];
  const detected: string[] = [];
  let current: CanonicalSection | null = null;
  let order = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const header = matchSectionHeader(line);
    if (header) {
      current = header;
      if (!detected.includes(header.name)) detected.push(header.name);
      continue;
    }
    if (!isFieldLine(line)) continue;
    const section = current ?? CANONICAL_SECTIONS[0];
    fields.push({
      section: section.name,
      label: line,
      cellType: inferCellType(line),
      archetypeHint: primaryArchetype(section),
      orderIdx: order++,
    });
  }

  return { fields, recognition: recognizeTemplate(detected), sections: detected };
}

/** Extract from raw input (docx/pdf/text) → structured form. */
export function ingestForm(input: IntakeInput): IngestedForm {
  const { text } = extractDocumentText(input);
  return parseFormText(text);
}

/**
 * Stable fingerprint of a form's detected section set — order-independent, so the
 * same template recognizes regardless of section ordering. A tiny FNV-1a hash keeps
 * it dependency-free.
 */
export function fingerprintSections(sections: string[]): string {
  const key = sections.map(normalize).sort().join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return "fp-" + h.toString(16).padStart(8, "0");
}

const RECOGNITION_THRESHOLD = 0.6;

/**
 * Recognize the canonical (MSD) template: if ≥60% of the 16 canonical sections are
 * present, report a match against the seeded template fingerprint. Otherwise return
 * the form's own computed fingerprint (an as-yet-unknown layout).
 */
export function recognizeTemplate(detectedSections: string[]): TemplateRecognition {
  const detectedNorm = new Set(detectedSections.map(normalize));
  const matched = CANONICAL_SECTIONS.filter((s) => detectedNorm.has(normalize(s.name)));
  const coverage = matched.length / CANONICAL_SECTIONS.length;
  const isMatch = coverage >= RECOGNITION_THRESHOLD;
  return {
    fingerprint: isMatch ? CANONICAL_FINGERPRINT : fingerprintSections(detectedSections),
    matched: isMatch,
    templateName: isMatch ? CANONICAL_NAME : null,
    coverage,
    matchedSections: matched.map((s) => s.name),
  };
}
