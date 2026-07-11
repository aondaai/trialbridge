/**
 * Envelope layer: raw bytes / pasted text → plain document text.
 *
 * This is the "how did the bytes arrive" layer, orthogonal to "what is the
 * document." It recognizes the container by magic bytes (not just extension)
 * and hands back text for the eligibility-locator to work on. DOCX/XLSX/eCTD
 * share the one `unzip` primitive; PDF has its own stream extractor. All of it
 * is dependency-free and runs offline.
 */

import type { IntakeInput } from "../types";
import { unzip, unzipTextEntry, utf8 } from "./zip";
import { extractPdfText } from "./pdf";

export { unzip, unzipTextEntry, utf8 } from "./zip";
export { extractPdfText } from "./pdf";

const XML_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
};

function decodeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isNaN(code) ? _ : String.fromCharCode(code);
    }
    return XML_ENTITIES[e] ?? _;
  });
}

/** DOCX → text: pull `<w:t>` runs, one line per `<w:p>` paragraph. */
export function docxToText(bytes: Uint8Array): string {
  const xml = unzipTextEntry(bytes, "word/document.xml");
  return xml
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .split(/<\/w:p>/)
    .map((p) =>
      // Match the text-run element `<w:t>`/`<w:t …>` ONLY — the `(?:\s[^>]*)?`
      // requires whitespace after the full tag name, so table tags like
      // `<w:tbl>`, `<w:tr>`, `<w:tc>` (eligibility often lives in tables) don't
      // false-match and leak markup into the extracted text.
      [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => decodeXml(m[1])).join(""),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isPdf(b: Uint8Array): boolean {
  return b.length >= 5 && utf8(b.subarray(0, 5)) === "%PDF-";
}

function isZip(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

/** Does this zip look like an Office Open XML doc (has word/document.xml)? */
function isDocx(bytes: Uint8Array): boolean {
  try {
    return unzip(bytes).has("word/document.xml");
  } catch {
    return false;
  }
}

/** Result of extracting a document envelope to text. */
export interface ExtractedText {
  text: string;
  /** "text" for real text extraction; callers may downgrade trust for OCR later. */
  extraction: "text";
  container: "pdf" | "docx" | "text";
}

/**
 * Turn a text/file input into plain text. Sniffs magic bytes so a mislabeled
 * extension still routes correctly. Throws for containers this layer doesn't
 * own (bare XLSX/eCTD zips — those have dedicated adapters).
 */
export function extractDocumentText(input: IntakeInput): ExtractedText {
  if (input.kind === "text") {
    return { text: input.text, extraction: "text", container: "text" };
  }
  if (input.kind === "file") {
    const b = input.bytes;
    if (isPdf(b)) return { text: extractPdfText(b), extraction: "text", container: "pdf" };
    if (isZip(b)) {
      if (isDocx(b)) return { text: docxToText(b), extraction: "text", container: "docx" };
      throw new Error(
        `envelope: ${input.filename} is a zip but not a DOCX — use the XLSX/eCTD adapter`,
      );
    }
    // Fall back to treating unknown bytes as UTF-8 text (e.g. .txt, .md).
    return { text: utf8(b), extraction: "text", container: "text" };
  }
  throw new Error(`envelope: cannot extract document text from a "${input.kind}" input`);
}
