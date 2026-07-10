/**
 * eCTD package adapter — Phase 4 long tail.
 *
 * An eCTD submission (IND/NDA/BLA/MAA) is a ZIP with an XML backbone; the
 * clinical protocol lives under Module 5. This adapter reuses the zip envelope
 * to open the package, finds the most protocol-like PDF (preferring m5/ paths),
 * extracts its text, and funnels the eligibility section to parse.ts. Trust is
 * "low" — we dug this out of a submission package, so everything should be
 * verified — which the provenance tier communicates to the verify UI.
 */

import { unzip, extractPdfText } from "../envelope";
import { locateEligibilityHeuristic } from "../locateEligibility";
import type { IntakeInput, IntakeResult, SourceAdapter } from "../types";

/** Looks like an eCTD package: a zip with a module folder or an index.xml backbone + a PDF. */
function ectdEntries(bytes: Uint8Array): Map<string, Uint8Array> | null {
  try {
    const map = unzip(bytes);
    const names = [...map.keys()];
    const hasModule = names.some((n) => /(?:^|\/)m[1-5]\//i.test(n));
    const hasBackbone = names.some((n) => /(?:^|\/)index\.xml$/i.test(n));
    const hasPdf = names.some((n) => /\.pdf$/i.test(n));
    // Don't claim Office docs.
    const isOffice = map.has("word/document.xml") || map.has("xl/workbook.xml");
    return !isOffice && hasPdf && (hasModule || hasBackbone) ? map : null;
  } catch {
    return null;
  }
}

/** Pick the most protocol-like PDF: prefer Module 5, then "protocol"/"csp" in the path. */
function findProtocolPdf(map: Map<string, Uint8Array>): { name: string; bytes: Uint8Array } | null {
  const pdfs = [...map.entries()].filter(([n]) => /\.pdf$/i.test(n));
  if (pdfs.length === 0) return null;
  const score = (n: string): number =>
    (/(?:^|\/)m5\//i.test(n) ? 4 : 0) +
    (/protocol|clinical[-_ ]?study|\bcsp\b/i.test(n) ? 2 : 0) +
    (/synops/i.test(n) ? 1 : 0);
  pdfs.sort((a, b) => score(b[0]) - score(a[0]));
  return { name: pdfs[0][0], bytes: pdfs[0][1] };
}

export const ectdAdapter: SourceAdapter = {
  id: "ectd",

  detect(input) {
    if (input.kind !== "file") return 0;
    return ectdEntries(input.bytes) ? 0.7 : 0;
  },

  async extract(input): Promise<IntakeResult> {
    if (input.kind !== "file") throw new Error("ectd adapter: expects a file input");
    const map = ectdEntries(input.bytes);
    if (!map) throw new Error("ectd adapter: not an eCTD-like package");

    const pdf = findProtocolPdf(map);
    if (!pdf) throw new Error("ectd adapter: no protocol PDF found in the package");

    const located = locateEligibilityHeuristic(extractPdfText(pdf.bytes));
    return {
      metadata: {
        sourceId: input.filename,
        sourceRegistry: "ectd",
        title: pdf.name.split("/").pop()?.replace(/\.pdf$/i, "") ?? input.filename,
      },
      eligibilityText: located.text,
      provenance: {
        adapter: "ectd",
        extraction: "text",
        trust: "low",
        note: `Extracted from eCTD package entry "${pdf.name}". ${located.note} — verify carefully.`,
      },
    };
  },
};
