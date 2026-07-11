import { describe, it, expect } from "vitest";
import {
  buildRenderDiff,
  approvedRenderValues,
  assertAllApproved,
  isShippable,
  UnapprovedContentError,
  type AnswerRecord,
} from "@/lib/feasibility-autofill/render/diff";
import { fillDocxTemplate, makeDocx } from "@/lib/feasibility-autofill/render/docx";
import { docxToText } from "@/lib/intake/envelope";

const ANSWERS: AnswerRecord[] = [
  { fieldId: "institution_name", label: "Instituição", value: "iHealth", status: "approved" },
  { fieldId: "interest", label: "Interesse", value: "Sim, temos interesse", status: "proposed" },
  { fieldId: "anon", label: "Anonimização", value: "pseudonymized", status: "approved" },
  { fieldId: "challenge", label: "Desafios", value: "rascunho LLM", status: "edited" },
  { fieldId: "reject", label: "X", value: "nao", status: "rejected" },
];

describe("F2-4 · render diff guard", () => {
  it("only 'approved' is shippable (edited/proposed/rejected are not)", () => {
    expect(isShippable({ ...ANSWERS[0] })).toBe(true);
    expect(isShippable({ ...ANSWERS[1] })).toBe(false); // proposed
    expect(isShippable({ ...ANSWERS[3] })).toBe(false); // edited
  });

  it("buildRenderDiff separates approved from withheld with reasons", () => {
    const d = buildRenderDiff(ANSWERS);
    expect(d.summary).toEqual({ total: 5, approved: 2, withheld: 3 });
    expect(d.approved.map((a) => a.fieldId)).toEqual(["institution_name", "anon"]);
    const reasons = Object.fromEntries(d.withheld.map((w) => [w.fieldId, w.reason]));
    expect(reasons.interest).toMatch(/awaiting human review/);
    expect(reasons.challenge).toMatch(/re-approval/);
    expect(reasons.reject).toMatch(/rejected/);
  });

  it("approvedRenderValues returns only approved tokens", () => {
    const v = approvedRenderValues(ANSWERS);
    expect(Object.keys(v).sort()).toEqual(["anon", "institution_name"]);
  });

  it("assertAllApproved throws when any answer is unapproved", () => {
    expect(() => assertAllApproved(ANSWERS)).toThrow(UnapprovedContentError);
  });

  it("assertAllApproved passes when every answer is approved", () => {
    const allApproved = ANSWERS.map((a) => ({ ...a, status: "approved" as const }));
    expect(() => assertAllApproved(allApproved)).not.toThrow();
  });

  it("end-to-end: an unapproved LLM draft never reaches the rendered DOCX", () => {
    const template = makeDocx(
      "<w:p><w:r><w:t>Inst: {{institution_name}} | Interesse: {{interest}}</w:t></w:r></w:p>",
    );
    const filled = fillDocxTemplate(template, approvedRenderValues(ANSWERS));
    const text = docxToText(filled);
    expect(text).toContain("Inst: iHealth");
    // the proposed (LLM) interest answer must NOT appear; its token stays unfilled
    expect(text).not.toContain("Sim, temos interesse");
    expect(text).toContain("{{interest}}");
  });
});
