/**
 * Test fixture builders — construct REAL PDF/DOCX/ZIP bytes at runtime so the
 * envelope readers are exercised end-to-end with no committed binary blobs and
 * no network. These are writers that mirror the readers under test: a genuine
 * PKZIP archive (stored + deflate), a FlateDecode PDF content stream, and an
 * Office Open XML document.
 */

import { deflateSync, deflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
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

export interface ZipFile {
  name: string;
  data: string | Uint8Array;
}

/** Build a real ZIP archive. `compress` toggles deflate (method 8) vs stored (0). */
export function makeZip(files: ZipFile[], compress = true): Uint8Array {
  const enc = new TextEncoder();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const name = enc.encode(f.name);
    const method = compress ? 8 : 0;
    const comp = compress ? new Uint8Array(deflateRawSync(data)) : data;
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const localRec = Buffer.concat([lh, Buffer.from(name), Buffer.from(comp)]);
    locals.push(localRec);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([ch, Buffer.from(name)]));

    offset += localRec.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Build a real DOCX (zip with word/document.xml), one `<w:p>` per paragraph. */
export function makeDocx(paragraphs: string[]): Uint8Array {
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(p)}</w:t></w:r></w:p>`)
    .join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  const contentTypes = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`;
  return makeZip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "word/document.xml", data: documentXml },
  ]);
}

function colLetter(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Build a minimal real XLSX with `rows` as inline-string cells on Sheet1. */
export function makeXlsx(rows: string[][]): Uint8Array {
  const sheetData = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => `<c r="${colLetter(c)}${r + 1}" t="inlineStr"><is><t>${escapeXml(v)}</t></is></c>`)
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Sheet1" sheetId="1"/></sheets></workbook>`;
  const contentTypes = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`;
  return makeZip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/worksheets/sheet1.xml", data: sheet },
  ]);
}

/** Build a minimal eCTD-like package: an index.xml backbone + a Module 5 protocol PDF. */
export function makeEctd(protocolText: string): Uint8Array {
  const index = `<?xml version="1.0"?><ectd:ectd xmlns:ectd="http://www.ich.org/ectd"><m5/></ectd:ectd>`;
  return makeZip([
    { name: "index.xml", data: index },
    { name: "m5/53-clin-stud-rep/535-rep-effic-safety-stud/protocol.pdf", data: makePdf(protocolText) },
  ]);
}

/** Build a minimal PDF whose content stream carries `text`, one Tj per line. */
export function makePdf(text: string, compress = true): Uint8Array {
  const lines = text.split("\n");
  const ops =
    "BT /F1 12 Tf 72 720 Td\n" +
    lines
      .map((l, i) => {
        const esc = l.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
        return `${i === 0 ? "" : "0 -14 Td "}(${esc}) Tj`;
      })
      .join("\n") +
    "\nET";
  const streamBytes = compress
    ? new Uint8Array(deflateSync(Buffer.from(ops, "latin1")))
    : new Uint8Array(Buffer.from(ops, "latin1"));
  const filter = compress ? "/Filter/FlateDecode" : "";
  const head = `%PDF-1.4\n4 0 obj\n<</Length ${streamBytes.length}${filter}>>\nstream\n`;
  const tail = `\nendstream\nendobj\n%%EOF`;
  return new Uint8Array(
    Buffer.concat([Buffer.from(head, "latin1"), Buffer.from(streamBytes), Buffer.from(tail, "latin1")]),
  );
}
