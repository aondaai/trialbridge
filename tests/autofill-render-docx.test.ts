import { describe, it, expect } from "vitest";
import { makeDocx, fillDocxTemplate, escapeXml, zipArchive } from "@/lib/feasibility-autofill/render/docx";
import { docxToText, unzip, utf8 } from "@/lib/intake/envelope";

/** A template paragraph with bold run properties around a token, plus a plain token. */
function templateDoc(): Uint8Array {
  const body =
    '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Instituição: {{institution_name}}</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Anonimização: {{anonymization_level}}</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Não preenchido: {{missing}}</w:t></w:r></w:p>';
  return makeDocx(body);
}

describe("F2-3 · DOCX writer round-trip", () => {
  it("makeDocx produces a DOCX the existing reader can open", () => {
    const bytes = makeDocx("<w:p><w:r><w:t>hello world</w:t></w:r></w:p>");
    expect(unzip(bytes).has("word/document.xml")).toBe(true);
    expect(docxToText(bytes)).toContain("hello world");
  });

  it("fills tokens and the values survive a reopen", () => {
    const filled = fillDocxTemplate(templateDoc(), {
      institution_name: "iHealth (demo)",
      anonymization_level: "pseudonymized",
    });
    const text = docxToText(filled);
    expect(text).toContain("Instituição: iHealth (demo)");
    expect(text).toContain("Anonimização: pseudonymized");
  });

  it("preserves run styling (the bold rPr around a filled token)", () => {
    const filled = fillDocxTemplate(templateDoc(), { institution_name: "ACME" });
    const xml = utf8(unzip(filled).get("word/document.xml")!);
    // The bold run property must still wrap the now-filled run.
    expect(xml).toContain("<w:rPr><w:b/></w:rPr>");
    expect(xml).toContain("ACME");
  });

  it("leaves unknown tokens in place (a missing answer is visible, not blanked)", () => {
    const filled = fillDocxTemplate(templateDoc(), { institution_name: "X" });
    expect(docxToText(filled)).toContain("{{missing}}");
  });

  it("XML-escapes answer values so markup can't be injected", () => {
    const filled = fillDocxTemplate(templateDoc(), {
      institution_name: 'A & B <corp> "x"',
    });
    const xml = utf8(unzip(filled).get("word/document.xml")!);
    expect(xml).toContain("A &amp; B &lt;corp&gt;");
    expect(escapeXml("<&>")).toBe("&lt;&amp;&gt;");
  });

  it("produces byte-identical output for identical inputs (reproducible)", () => {
    const a = fillDocxTemplate(templateDoc(), { institution_name: "Z" });
    const b = fillDocxTemplate(templateDoc(), { institution_name: "Z" });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("zipArchive round-trips arbitrary entries through unzip", () => {
    const enc = new TextEncoder();
    const zip = zipArchive([
      ["a.txt", enc.encode("alpha")],
      ["dir/b.txt", enc.encode("beta")],
    ]);
    const back = unzip(zip);
    expect(utf8(back.get("a.txt")!)).toBe("alpha");
    expect(utf8(back.get("dir/b.txt")!)).toBe("beta");
  });
});
