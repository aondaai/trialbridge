import { describe, it, expect } from "vitest";
import { buildRequestDraft } from "@/lib/feasibility-autofill/intakeRequest";
import { CANONICAL_SECTIONS, CANONICAL_FINGERPRINT } from "@/lib/feasibility-autofill/canonicalTemplate";

/** A synthetic feasibility form covering all 16 canonical sections. */
function form(): string {
  return CANONICAL_SECTIONS.map((s) => `${s.idx}. ${s.name}\n${s.content.split(",")[0]}?`).join("\n\n");
}

describe("FIN-1 · US-1 buildRequestDraft (ingest → request draft)", () => {
  it("parses a form into fields + recognizes the canonical template", () => {
    const d = buildRequestDraft(form());
    expect(d.fields.length).toBeGreaterThanOrEqual(16);
    expect(d.templateMatched).toBe(true);
    expect(d.fingerprint).toBe(CANONICAL_FINGERPRINT);
    // Every field carries a section, a label, and an archetype.
    for (const f of d.fields) {
      expect(f.section.length).toBeGreaterThan(0);
      expect(f.label.length).toBeGreaterThan(0);
      expect(["A", "B", "C", "D"]).toContain(f.archetype);
    }
  });

  it("derives the study title from the filename when given", () => {
    const d = buildRequestDraft(form(), "MSD_ASCVD_feasibility.docx");
    expect(d.studyTitle).toBe("MSD_ASCVD_feasibility");
  });

  it("falls back to a default title without a filename", () => {
    expect(buildRequestDraft(form()).studyTitle.length).toBeGreaterThan(0);
  });
});
