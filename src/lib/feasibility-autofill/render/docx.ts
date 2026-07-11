/**
 * DOCX writer + template fill (F2-3) — the one genuinely-missing intake capability.
 *
 * The intake layer READS docx (envelope/docxToText); this WRITES it, so approved answers
 * render back into the sponsor's original template preserving formatting (spec §6 #6:
 * "unzip → edit document.xml → rezip"). Dependency-free: a minimal ZIP archiver (CRC32 +
 * Node's deflateRawSync) complements the existing reader. Timestamps are fixed, not
 * clock-read, so the same inputs produce byte-identical output (reproducible renders).
 *
 * Fill is token-based: `{{key}}` placeholders in the template's document.xml are replaced
 * with XML-escaped answer values. Everything around a token — run properties (`<w:rPr>`),
 * tables, checkboxes — is left byte-for-byte intact, so styling survives the round-trip.
 */

import { deflateRawSync } from "node:zlib";
import { unzip, utf8 } from "@/lib/intake/envelope/zip";

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Build a ZIP archive (deflate method 8) from name→bytes entries. Fixed dates → reproducible. */
export function zipArchive(entries: Array<[string, Uint8Array]>): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  const enc = new TextEncoder();
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = 0x21; // 1980-01-01, fixed

  for (const [name, data] of entries) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const comp = new Uint8Array(deflateRawSync(data));

    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 8, true);
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, comp.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);
    parts.push(lh, comp);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 8, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    central.push(ch);

    offset += lh.length + comp.length;
  }

  const centralStart = offset;
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);

  const all = [...parts, ...central, eocd];
  const total = all.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const chunk of all) {
    out.set(chunk, p);
    p += chunk.length;
  }
  return out;
}

/** XML-escape a replacement value so answer text can't break the document markup. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Fill a template DOCX: replace every `{{key}}` in word/document.xml with its (escaped)
 * value and rezip, leaving all other entries and surrounding markup untouched. Unknown
 * tokens are left in place (so a missing answer is visible, not silently blanked).
 */
export function fillDocxTemplate(
  templateBytes: Uint8Array,
  values: Record<string, string>,
): Uint8Array {
  const entries = unzip(templateBytes);
  const docXml = entries.get("word/document.xml");
  if (!docXml) throw new Error("fillDocxTemplate: template is not a DOCX (no word/document.xml)");

  const filled = utf8(docXml).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, key: string) =>
    key in values ? escapeXml(values[key]) : whole,
  );

  const enc = new TextEncoder();
  const out: Array<[string, Uint8Array]> = [];
  for (const [name, data] of entries) {
    out.push([name, name === "word/document.xml" ? enc.encode(filled) : data]);
  }
  return zipArchive(out);
}

/**
 * Build a minimal but valid DOCX from a document.xml body — used to synthesize templates
 * and fixtures without any binary asset. `bodyXml` is the inner content of `<w:body>`.
 */
export function makeDocx(bodyXml: string): Uint8Array {
  const enc = new TextEncoder();
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    "</Types>";
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>";
  const doc =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${bodyXml}</w:body></w:document>`;
  return zipArchive([
    ["[Content_Types].xml", enc.encode(contentTypes)],
    ["_rels/.rels", enc.encode(rels)],
    ["word/document.xml", enc.encode(doc)],
  ]);
}
