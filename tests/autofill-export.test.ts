import { describe, it, expect } from "vitest";
import { buildExportDocx } from "@/lib/feasibility-autofill/render/exportDocx";
import type { AnswerRecord } from "@/lib/feasibility-autofill/render/diff";
import { docxToText } from "@/lib/intake/envelope";

const RECORDS: AnswerRecord[] = [
  { fieldId: "f0", label: "Instituição", value: "iHealth", status: "approved" },
  { fieldId: "f1", label: "Anonimização", value: "pseudonymized", status: "approved" },
  { fieldId: "f2", label: "Interesse", value: "Sim, temos interesse", status: "proposed" }, // LLM/unapproved
  { fieldId: "f3", label: "Desafios", value: "rascunho editado", status: "edited" },
  { fieldId: "f4", label: "X", value: "nao", status: "rejected" },
];

describe("FIN-3 · US-5 export — only approved answers ship", () => {
  it("renders a .docx containing approved values, and none of the unapproved", () => {
    const { bytes, approvedCount, withheldCount } = buildExportDocx("HER2+ MBC (demo)", RECORDS);
    expect(approvedCount).toBe(2);
    expect(withheldCount).toBe(3);
    const text = docxToText(bytes);
    expect(text).toContain("HER2+ MBC (demo)");
    expect(text).toContain("Instituição: iHealth");
    expect(text).toContain("Anonimização: pseudonymized");
    // Unapproved answers (proposed / edited / rejected) must NOT appear:
    expect(text).not.toContain("Sim, temos interesse");
    expect(text).not.toContain("rascunho editado");
    expect(text).not.toContain("nao");
    // …and no leftover template tokens:
    expect(text).not.toMatch(/\{\{.*\}\}/);
  });

  it("all-approved ships everything", () => {
    const all = RECORDS.map((r) => ({ ...r, status: "approved" as const }));
    const { approvedCount, withheldCount } = buildExportDocx("t", all);
    expect(approvedCount).toBe(5);
    expect(withheldCount).toBe(0);
  });
});
