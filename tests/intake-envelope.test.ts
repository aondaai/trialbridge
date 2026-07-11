import { describe, it, expect } from "vitest";
import { unzip, unzipTextEntry, docxToText, extractPdfText, extractDocumentText } from "@/lib/intake/envelope";
import { makeZip, makeDocx, makePdf } from "./helpers/fixtures";

const PROTOCOL = `Inclusion Criteria:
- Age >= 18 years.
- HER2-positive (IHC 3+).

Exclusion Criteria:
- Active brain metastases.`;

describe("zip reader", () => {
  it("round-trips a deflate archive (method 8)", () => {
    const zip = makeZip([{ name: "a.txt", data: "hello" }, { name: "d/b.txt", data: "world" }], true);
    const map = unzip(zip);
    expect(unzipTextEntry(zip, "a.txt")).toBe("hello");
    expect(unzipTextEntry(zip, "d/b.txt")).toBe("world");
    expect([...map.keys()].sort()).toEqual(["a.txt", "d/b.txt"]);
  });

  it("round-trips a stored archive (method 0, edge case: no compression)", () => {
    const zip = makeZip([{ name: "s.txt", data: "stored bytes" }], false);
    expect(unzipTextEntry(zip, "s.txt")).toBe("stored bytes");
  });

  it("throws on a missing entry and on non-zip bytes", () => {
    const zip = makeZip([{ name: "only.txt", data: "x" }]);
    expect(() => unzipTextEntry(zip, "nope.txt")).toThrow(/not found/);
    expect(() => unzip(new Uint8Array([1, 2, 3, 4]))).toThrow(/End Of Central Directory/);
  });
});

describe("pdf text extraction", () => {
  it("recovers text from a FlateDecode content stream", () => {
    const text = extractPdfText(makePdf(PROTOCOL, true));
    expect(text).toMatch(/Inclusion Criteria/);
    expect(text).toMatch(/HER2-positive \(IHC 3\+\)/);
    expect(text).toMatch(/Exclusion Criteria/);
  });

  it("recovers text from an uncompressed stream (edge case) and preserves line breaks", () => {
    const text = extractPdfText(makePdf(PROTOCOL, false));
    expect(text).toMatch(/Age >= 18 years\./);
    expect(text.split("\n").length).toBeGreaterThan(3);
  });

  it("rejects non-PDF bytes", () => {
    expect(() => extractPdfText(new Uint8Array([1, 2, 3]))).toThrow(/not a PDF/);
  });
});

describe("docx text extraction", () => {
  it("pulls paragraph text with entities decoded", () => {
    const docx = makeDocx(["Inclusion Criteria:", "Age >= 18 & ECOG <= 1", "HER2-positive"]);
    const text = docxToText(docx);
    expect(text).toBe("Inclusion Criteria:\nAge >= 18 & ECOG <= 1\nHER2-positive");
  });

  it("does not leak table markup (<w:tbl>/<w:tr>/<w:tc>) into extracted text", () => {
    // Eligibility is frequently laid out in DOCX tables; the run regex must not
    // false-match the table element tags that start with 'w:t'.
    const docXml =
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Age &gt;= 18</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:p><w:r><w:t>ECOG 0-1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
      `</w:body></w:document>`;
    const docx = makeZip([{ name: "[Content_Types].xml", data: "<x/>" }, { name: "word/document.xml", data: docXml }]);
    const text = docxToText(docx);
    expect(text).toMatch(/Age >= 18/);
    expect(text).toMatch(/ECOG 0-1/);
    expect(text).not.toMatch(/<w:t[rc]/); // no raw table markup leaked
  });
});

describe("malformed / hostile input handling", () => {
  it("throws a clean error on a truncated central directory rather than a RangeError", () => {
    const zip = makeZip([{ name: "a.txt", data: "hello world" }]);
    // Corrupt the EOCD's central-directory offset to point past EOF.
    const corrupt = zip.slice();
    const view = new DataView(corrupt.buffer, corrupt.byteOffset, corrupt.byteLength);
    // EOCD is the last 22 bytes; CD offset is at eocd+16.
    const eocd = corrupt.byteLength - 22;
    view.setUint32(eocd + 16, 0xfffffff0, true);
    expect(() => unzip(corrupt)).toThrow(/ZIP64|out of range|past end|central directory/i);
  });
});

describe("extractDocumentText dispatch", () => {
  it("passes through text input", () => {
    expect(extractDocumentText({ kind: "text", text: PROTOCOL }).container).toBe("text");
  });

  it("sniffs PDF and DOCX by magic bytes regardless of filename", () => {
    const pdf = extractDocumentText({ kind: "file", filename: "wrong.dat", bytes: makePdf(PROTOCOL) });
    expect(pdf.container).toBe("pdf");
    expect(pdf.text).toMatch(/Exclusion Criteria/);

    const docx = extractDocumentText({ kind: "file", filename: "p.docx", bytes: makeDocx(["Eligibility"]) });
    expect(docx.container).toBe("docx");
    expect(docx.text).toBe("Eligibility");
  });

  it("rejects a non-DOCX zip (belongs to the XLSX/eCTD adapters)", () => {
    const zip = makeZip([{ name: "xl/worksheets/sheet1.xml", data: "<x/>" }]);
    expect(() => extractDocumentText({ kind: "file", filename: "book.xlsx", bytes: zip })).toThrow(
      /not a DOCX/,
    );
  });
});
