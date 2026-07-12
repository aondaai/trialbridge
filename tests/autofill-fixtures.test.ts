import { describe, it, expect } from "vitest";
import {
  QUESTION_BANK_LABELS,
  ARCHETYPE_COUNTS,
  type Archetype,
} from "@/lib/feasibility-autofill/fixtures/questionBankLabels";

describe("F0-3 · QuestionBank classifier label fixture", () => {
  it("carries all 32 Banco de Perguntas rows", () => {
    expect(QUESTION_BANK_LABELS).toHaveLength(32);
  });

  it("matches the spec archetype distribution (A:10 B:14 C:4 D:4)", () => {
    expect(ARCHETYPE_COUNTS).toEqual({ A: 10, B: 14, C: 4, D: 4 });
  });

  it("every label has a valid archetype and a non-empty field", () => {
    const valid: Archetype[] = ["A", "B", "C", "D"];
    for (const l of QUESTION_BANK_LABELS) {
      expect(valid).toContain(l.archetype);
      expect(l.field.trim().length).toBeGreaterThan(0);
      expect(l.id.trim().length).toBeGreaterThan(0);
    }
  });

  it("ids are unique", () => {
    const ids = QUESTION_BANK_LABELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("B-archetype rows are concept-bound or catalog-sourced (never bare)", () => {
    const bRows = QUESTION_BANK_LABELS.filter((l) => l.archetype === "B");
    for (const l of bRows) {
      expect(l.source.length).toBeGreaterThan(0);
    }
  });
});
