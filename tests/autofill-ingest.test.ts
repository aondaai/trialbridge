import { describe, it, expect } from "vitest";
import {
  parseFormText,
  ingestForm,
  recognizeTemplate,
  fingerprintSections,
  inferCellType,
  normalize,
} from "@/lib/feasibility-autofill/ingest";
import { CANONICAL_SECTIONS, CANONICAL_FINGERPRINT } from "@/lib/feasibility-autofill/canonicalTemplate";

/** A synthetic feasibility form covering all 16 canonical sections with a field line each. */
function syntheticForm(): string {
  return CANONICAL_SECTIONS.map(
    (s) => `${s.idx}. ${s.name}\n${s.content.split(",")[0]}?`,
  ).join("\n\n");
}

describe("F1-1 · feasibility form ingestion", () => {
  it("segments a form into FormFieldDraft[] under detected sections", () => {
    const { fields, sections } = parseFormText(syntheticForm());
    expect(fields.length).toBeGreaterThanOrEqual(16);
    // every field is tagged to a real canonical section
    const names = new Set(CANONICAL_SECTIONS.map((s) => s.name));
    for (const f of fields) expect(names.has(f.section)).toBe(true);
    expect(sections.length).toBe(16);
  });

  it("recognizes the canonical (MSD) template at 100% coverage", () => {
    const { recognition } = parseFormText(syntheticForm());
    expect(recognition.matched).toBe(true);
    expect(recognition.coverage).toBe(1);
    expect(recognition.fingerprint).toBe(CANONICAL_FINGERPRINT);
  });

  it("does NOT recognize a form with too few canonical sections", () => {
    const r = recognizeTemplate(["Informações da Instituição", "Comentários / Dúvidas"]);
    expect(r.matched).toBe(false);
    expect(r.fingerprint).not.toBe(CANONICAL_FINGERPRINT);
    expect(r.coverage).toBeLessThan(0.6);
  });

  it("fingerprint is order-independent and stable", () => {
    const a = fingerprintSections(["Desafios", "Instituição", "Equipe do Estudo"]);
    const b = fingerprintSections(["Equipe do Estudo", "Desafios", "Instituição"]);
    expect(a).toBe(b);
    expect(a).toMatch(/^fp-[0-9a-f]{8}$/);
  });

  it("infers cell types from question surface features", () => {
    expect(inferCellType("Interesse em participar (Sim/Não) + justificativa")).toBe("yes_no_partial");
    expect(inferCellType("[ ] Base do tipo claims")).toBe("checkbox");
    expect(inferCellType("Nº aproximado de pacientes na base")).toBe("number");
    expect(inferCellType("Título do estudo")).toBe("text");
  });

  it("normalize folds PT-BR accents", () => {
    expect(normalize("Informações da Instituição")).toBe("informacoes da instituicao");
  });

  it("ingestForm reads a text IntakeInput end-to-end", () => {
    const { fields, recognition } = ingestForm({ kind: "text", text: syntheticForm() });
    expect(fields.length).toBeGreaterThanOrEqual(16);
    expect(recognition.matched).toBe(true);
  });
});
