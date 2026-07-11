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

import { extractDocumentText, unzip } from "../envelope";
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

function isDocxZip(bytes: Uint8Array): boolean {
  try {
    return unzip(bytes).has("word/document.xml");
  } catch {
    return false;
  }
}

export const documentAdapter: SourceAdapter = {
  id: "document",

  detect(input) {
    if (input.kind === "text") return 0.5;
    if (input.kind !== "file") return 0;
    const b = input.bytes;
    if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b) {
      // A zip: only claim it if it's actually a DOCX. XLSX/eCTD have their own
      // adapters; any other zip we leave UNCLAIMED so the registry returns a
      // clean "no adapter recognized" error instead of us throwing a misleading
      // "not a DOCX" from extract().
      return isDocxZip(b) ? 0.8 : 0;
    }
    // PDF or plain/unknown bytes (treated as text) — the envelope handles both.
    return 0.8;
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
