/**
 * The document adapter — the Phase 1 "universal funnel."
 *
 * One adapter covers ~every unstructured artifact a sponsor actually walks in
 * with: a full protocol, a synopsis, the clinical protocol inside an IND, a CSR,
 * pasted text. They're all "a document with an eligibility section," so the flow
 * is always the same: envelope → plain text → locate the eligibility block →
 * hand it to the existing `parse.ts` (the `eligibilityText` lane). No structured
 * shortcut here; the LLM parse + verify table stay the trust moment.
 */

import { extractDocumentText } from "../envelope";
import { locateEligibility } from "../locateEligibility";
import type { IntakeInput, IntakeResult, SourceAdapter, TrustTier } from "../types";

/** First non-empty line, trimmed and capped — a decent title guess. */
function firstLineTitle(text: string): string {
  const line = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line.slice(0, 120) || "Untitled protocol document";
}

function baseName(filename?: string): string | undefined {
  if (!filename) return undefined;
  return filename.replace(/\.[^./\\]+$/, "").split(/[\\/]/).pop() || undefined;
}

/** Can the envelope layer turn this input into document text? */
function isDocumentInput(input: IntakeInput): boolean {
  if (input.kind === "text") return true;
  if (input.kind === "file") {
    const b = input.bytes;
    const pdf = b.length >= 5 && b[0] === 0x25 && b[1] === 0x50; // %P
    const zip = b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b; // PK
    // PDFs yes; zips only if DOCX (envelope decides) — but XLSX/eCTD adapters
    // score higher for those, so a mild score here is fine. Plain bytes = text.
    return pdf || zip || true;
  }
  return false;
}

export const documentAdapter: SourceAdapter = {
  id: "document",

  detect(input) {
    if (input.kind === "text") return 0.5;
    if (input.kind === "file" && isDocumentInput(input)) {
      // Let the dedicated XLSX/eCTD zip adapters outrank us on their containers.
      const isZip = input.bytes[0] === 0x50 && input.bytes[1] === 0x4b;
      return isZip ? 0.4 : 0.8;
    }
    return 0;
  },

  async extract(input): Promise<IntakeResult> {
    const { text, container } = extractDocumentText(input);
    const located = await locateEligibility(text, { useLlm: true });

    const filename = input.kind === "file" ? input.filename : input.kind === "text" ? input.filename : undefined;
    const title = baseName(filename) ?? firstLineTitle(text);
    // Born-digital text is medium trust; if we couldn't find explicit headings
    // we're less sure we grabbed the right span, so flag it lower.
    const trust: TrustTier = located.found ? "medium" : "low";

    return {
      metadata: {
        sourceId: filename ?? "pasted-document",
        sourceRegistry: "document",
        title,
      },
      eligibilityText: located.text,
      provenance: {
        adapter: "document",
        extraction: "text",
        trust,
        note: `${container.toUpperCase()} document. ${located.note} (${located.method})`,
      },
    };
  },
};
