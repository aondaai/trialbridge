/**
 * The universal sponsor-intake contract.
 *
 * TrialBridge's downstream (the deterministic matcher + the softening simulator)
 * only ever consumes a typed `Criterion[]`, and the parse/verify table is where
 * trust happens. So "accept any sponsor format" is a FRONT-DOOR problem: every
 * input — an NCT id, a pasted synopsis, a protocol PDF, a FHIR EvidenceVariable,
 * an EudraCT number — is normalized by a `SourceAdapter` into one `IntakeResult`
 * that lands on one of two lanes:
 *
 *   • `eligibilityText`     → the existing LLM `parse.ts` (documents, registries)
 *   • `preParsedCriteria`   → straight to the verify table, no LLM (structured)
 *
 * The matcher and the `Criterion` type never change. This module only widens the
 * set of things that can produce that Criterion[].
 */

import type { Criterion } from "@/lib/matcher/types";

/** How the raw bytes arrive — orthogonal to what the document *is*. */
export type IntakeInput =
  /** Pasted text / markdown, or already-extracted document text. */
  | { kind: "text"; text: string; filename?: string }
  /** A registry id (NCT…, EudraCT…) an adapter knows how to fetch. */
  | { kind: "id"; id: string }
  /** A URL to fetch (registry study page, raw document). */
  | { kind: "url"; url: string }
  /** Raw file bytes (PDF, DOCX, XLSX, .zip/eCTD, image). */
  | { kind: "file"; filename: string; bytes: Uint8Array; mime?: string }
  /** Already-parsed structured data (FHIR resource/bundle, ATLAS cohort JSON). */
  | { kind: "json"; data: unknown; filename?: string };

/**
 * Generalized protocol metadata — the widening of ctgov's `NormalizedProtocol`.
 * `nctId` is NOT renamed there (that would break existing tests + downstream);
 * instead every adapter maps its own shape onto this neutral envelope.
 */
export interface ProtocolMeta {
  /** The natural id in the source system: nctId, EudraCT number, FHIR id, filename. */
  sourceId: string;
  /** Where it came from: "clinicaltrials.gov" | "eudract" | "fhir" | "document" | … */
  sourceRegistry: string;
  title: string;
  sponsor?: string | null;
  phase?: string[];
  conditions?: string[];
  sourceUrl?: string | null;
}

/** How the eligibility content was pulled — drives the trust tier + UI note. */
export type ExtractionMethod = "api" | "structured" | "text" | "ocr";

/**
 * Trust gradient. Structured/API sources are trustworthy enough to flag few rows
 * for human verification; OCR'd scans get everything flagged. This plugs straight
 * into the existing per-criterion `confidence`/verify mechanic.
 */
export type TrustTier = "high" | "medium" | "low";

export interface Provenance {
  adapter: string;
  extraction: ExtractionMethod;
  trust: TrustTier;
  /** Human-readable one-liner for the provenance badge. */
  note?: string;
}

/** The single shape every adapter returns. Exactly one lane should be populated. */
export interface IntakeResult {
  metadata: ProtocolMeta;
  /** Documents → feed the existing LLM parse + verify flow. */
  eligibilityText?: string;
  /** Structured sources → skip the LLM, go straight to the verify table. */
  preParsedCriteria?: Criterion[];
  provenance: Provenance;
}

/**
 * One format handler. `detect` is a cheap 0..1 vote (does this look like mine?);
 * the registry runs the highest scorer's `extract`.
 */
export interface SourceAdapter {
  id: string;
  /** 0 = "not mine", 1 = "certainly mine". Should be cheap and side-effect-free. */
  detect(input: IntakeInput): number;
  extract(input: IntakeInput): Promise<IntakeResult>;
}
