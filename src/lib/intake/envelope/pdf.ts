/**
 * Born-digital PDF text extraction — dependency-free, pragmatic.
 *
 * A protocol or synopsis exported straight to PDF stores its text in content
 * streams as `(literal) Tj` / `[(a) (b)] TJ` operators, usually FlateDecode-
 * compressed. We locate each stream, inflate it with Node's built-in `zlib`,
 * and pull the literal-string operands, using text-positioning operators
 * (Td/TD/T*) as line breaks.
 *
 * Explicit NON-goals (documented, not hidden): no OCR (scanned/image PDFs yield
 * little or nothing — the caller flags trust "low"), no CID/Type0 font CMap
 * decoding, no exotic filters. Good enough to recover the eligibility section
 * from a normal exported document; the verify table is the safety net.
 */

import { inflateSync, inflateRawSync } from "node:zlib";

/** Per-stream inflate cap — same decompression-bomb guard as the zip reader. */
const MAX_STREAM_BYTES = 64 * 1024 * 1024;

const latin1 = (b: Uint8Array): string => Buffer.from(b).toString("latin1");

export function extractPdfText(bytes: Uint8Array): string {
  if (latin1(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new Error("pdf: not a PDF (missing %PDF- header)");
  }
  const raw = latin1(bytes);
  const chunks: string[] = [];
  const streamRe = /stream\r?\n/g;
  let m: RegExpExecArray | null;

  while ((m = streamRe.exec(raw))) {
    const dictStart = raw.lastIndexOf("<<", m.index);
    const dict = dictStart >= 0 ? raw.slice(dictStart, m.index) : "";
    const dataStart = m.index + m[0].length;
    const endIdx = raw.indexOf("endstream", dataStart);
    if (endIdx < 0) break;

    // The EOL immediately before `endstream` is a delimiter, not stream data.
    let dataEnd = endIdx;
    if (raw[dataEnd - 1] === "\n") dataEnd--;
    if (raw[dataEnd - 1] === "\r") dataEnd--;

    const streamBytes = bytes.subarray(dataStart, dataEnd);
    let content: string;
    try {
      content = /\/FlateDecode/.test(dict) ? latin1(inflate(streamBytes)) : latin1(streamBytes);
    } catch {
      // Undecodable stream (image, unknown filter) — skip it, keep going.
      streamRe.lastIndex = endIdx + 9;
      continue;
    }
    const text = extractTextOperators(content);
    if (text.trim()) chunks.push(text);
    streamRe.lastIndex = endIdx + 9;
  }

  return chunks
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** PDF FlateDecode is zlib-wrapped; a few writers emit raw deflate — try both. */
function inflate(b: Uint8Array): Uint8Array {
  try {
    return new Uint8Array(inflateSync(b, { maxOutputLength: MAX_STREAM_BYTES }));
  } catch {
    return new Uint8Array(inflateRawSync(b, { maxOutputLength: MAX_STREAM_BYTES }));
  }
}

/** Pull text from a decoded content stream via (…)Tj / […]TJ, Td/TD/T* = newline. */
function extractTextOperators(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "(") {
      const [str, next] = readLiteral(s, i);
      out += str;
      i = next;
    } else if (c === "T" && (s[i + 1] === "d" || s[i + 1] === "D" || s[i + 1] === "*")) {
      out += "\n";
      i += 2;
    } else {
      i++;
    }
  }
  return out;
}

const ESCAPES: Record<string, string> = {
  n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\",
};

/** Read a PDF literal string starting at `(`; returns [text, indexAfterClose]. */
function readLiteral(s: string, start: number): [string, number] {
  let i = start + 1;
  let depth = 1;
  let out = "";
  while (i < s.length && depth > 0) {
    const c = s[i];
    if (c === "\\") {
      const n = s[i + 1];
      if (n === undefined) {
        // Trailing backslash at end of a (truncated) stream — drop it rather
        // than appending the literal string "undefined".
        i += 1;
      } else if (n in ESCAPES) {
        out += ESCAPES[n];
        i += 2;
      } else if (n >= "0" && n <= "7") {
        let oct = n;
        i += 2;
        for (let k = 0; k < 2 && s[i] >= "0" && s[i] <= "7"; k++) oct += s[i++];
        out += String.fromCharCode(parseInt(oct, 8));
      } else if (n === "\n") {
        i += 2; // line-continuation
      } else {
        out += n;
        i += 2;
      }
    } else if (c === "(") {
      depth++;
      out += c;
      i++;
    } else if (c === ")") {
      depth--;
      if (depth > 0) out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return [out, i];
}
