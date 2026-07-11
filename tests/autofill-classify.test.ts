import { describe, it, expect } from "vitest";
import { classifyField, classifyWithShortlist } from "@/lib/feasibility-autofill/classify";
import {
  QUESTION_BANK_LABELS,
  type Archetype,
} from "@/lib/feasibility-autofill/fixtures/questionBankLabels";

/** Confusion-matrix helpers over the 32 labelled fields. */
function evaluate() {
  const archetypes: Archetype[] = ["A", "B", "C", "D"];
  const tp: Record<Archetype, number> = { A: 0, B: 0, C: 0, D: 0 };
  const fp: Record<Archetype, number> = { A: 0, B: 0, C: 0, D: 0 };
  const fn: Record<Archetype, number> = { A: 0, B: 0, C: 0, D: 0 };
  let correct = 0;

  for (const label of QUESTION_BANK_LABELS) {
    const pred = classifyField({ section: label.section, label: label.field }).archetype;
    const gold = label.archetype;
    if (pred === gold) {
      correct++;
      tp[gold]++;
    } else {
      fp[pred]++;
      fn[gold]++;
    }
  }

  const precision = (a: Archetype) => (tp[a] + fp[a] === 0 ? 1 : tp[a] / (tp[a] + fp[a]));
  const recall = (a: Archetype) => (tp[a] + fn[a] === 0 ? 1 : tp[a] / (tp[a] + fn[a]));
  return { accuracy: correct / QUESTION_BANK_LABELS.length, precision, recall, archetypes };
}

describe("F1-2 · archetype classifier precision/recall vs QuestionBank labels", () => {
  const { accuracy, precision, recall, archetypes } = evaluate();

  it("overall archetype accuracy meets the bar (≥0.85)", () => {
    expect(accuracy).toBeGreaterThanOrEqual(0.85);
  });

  it("per-archetype precision ≥0.7", () => {
    for (const a of archetypes) expect(precision(a)).toBeGreaterThanOrEqual(0.7);
  });

  it("per-archetype recall ≥0.7", () => {
    for (const a of archetypes) expect(recall(a)).toBeGreaterThanOrEqual(0.7);
  });
});

describe("F1-2 · concept mapping ladder", () => {
  it("maps by exact PT-BR synonym", () => {
    const c = classifyField({ section: "Variáveis", label: "Idade" });
    expect(c.concept).toBe("age");
    expect(c.method).toBe("synonym");
  });

  it("maps by vocabulary code when present", () => {
    const c = classifyField({ section: "Variáveis", label: "Diagnóstico (CID-10 K50)" });
    expect(c.concept).toBe("ibd");
    // K50 in-label may hit the 'ibd' synonym list OR the code rung; both are acceptable hits.
    expect(["synonym", "code"]).toContain(c.method);
  });

  it("does not misclassify a contract/process number as a lab result (LOINC gate)", () => {
    // "12345-6" matches the LOINC shape but the label has no lab context → not lab_result.
    const c = classifyField({ section: "Contratação e Prazos", label: "Processo administrativo 12345-6" });
    expect(c.concept).not.toBe("lab_result");
    // With a lab cue present, a LOINC-shaped code IS a lab result.
    const lab = classifyField({ section: "Variáveis", label: "Exame LOINC 13457-9 no soro" });
    expect(lab.concept).toBe("lab_result");
  });

  it("flags an unknown B-field as unmapped — never guesses", () => {
    const c = classifyField({ section: "Matriz de Variáveis", label: "Fenótipo genômico raro XYZ" });
    expect(c.archetype).toBe("B");
    expect(c.concept).toBeNull();
    expect(c.method).toBe("unmapped");
  });

  it("shortlist rung fills an unmapped field from the known set (human-confirmed)", async () => {
    const resolver = async (_label: string, candidates: string[]) =>
      candidates.includes("medication") ? "medication" : null;
    const c = await classifyWithShortlist(
      { section: "Matriz de Variáveis", label: "Substância prescrita não catalogada" },
      resolver,
    );
    expect(c.concept).toBe("medication");
    expect(c.method).toBe("shortlist");
  });

  it("without a resolver, unmapped stays unmapped", async () => {
    const c = await classifyWithShortlist({ section: "Matriz de Variáveis", label: "Coisa desconhecida" });
    expect(c.method).toBe("unmapped");
  });
});
