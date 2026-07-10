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
