import { describe, it, expect, vi } from "vitest";
import { heuristicCritique, critiqueNarrative } from "@/lib/feasibility-autofill/resolvers/narrativeCritic";
import { orchestrateAutofill, type OrchestratorDeps } from "@/lib/feasibility-autofill/mcp/orchestrator";
import type { NarrativeDraft, NarrativeContext } from "@/lib/feasibility-autofill/resolvers/narrative";
import type { FormFieldDraft } from "@/lib/feasibility-autofill/ingest";
import { Provenance } from "@/lib/metric";

function draft(text: string, citations: Array<{ priorId: string; label: string }> = []): NarrativeDraft {
  return {
    fieldLabel: "Limitações", draft: text, citations, status: "proposed",
    metric: { key: "narrative.x", value: text, provenance: Provenance.MODELED, confidence: "low" } as never,
    source: "template", note: "",
  };
}

const ctx = (answer: string): NarrativeContext => ({
  fieldLabel: "Limitações", section: "Limitações Metodológicas",
  exemplars: [{ id: "pa1", section: "Limitações Metodológicas", label: "Limitações", answerText: answer, score: 1 }],
  institutionFacts: { anonimizacao: "pseudonymized" },
});

describe("M2 · narrative critic (adversarial grounding)", () => {
  it("passes a draft grounded in its exemplar", () => {
    const c = heuristicCritique(draft("A base cobre o período informado.", [{ priorId: "pa1", label: "Limitações" }]), ctx("A base cobre o período informado."));
    expect(c.grounded).toBe(true);
    expect(c.issues).toHaveLength(0);
  });

  it("flags a draft that cites no exemplars (ungrounded)", () => {
    const c = heuristicCritique(draft("Uma afirmação longa e específica sem qualquer fundamento em exemplares anteriores."), ctx("algo diferente"));
    expect(c.grounded).toBe(false);
    expect(c.issues.join(" ")).toMatch(/ungrounded/);
  });

  it("flags a fabricated number/count not supported by any exemplar (D must not state counts)", () => {
    const c = heuristicCritique(
      draft("Temos 4200 pacientes elegíveis.", [{ priorId: "pa1", label: "x" }]),
      ctx("A base tem boa cobertura."), // exemplar has no 4200
    );
    expect(c.grounded).toBe(false);
    expect(c.issues.join(" ")).toMatch(/4200|fabricated count/);
  });

  it("allows a number that IS present in the exemplar", () => {
    const c = heuristicCritique(
      draft("Cobertura de 2019 a 2025.", [{ priorId: "pa1", label: "x" }]),
      ctx("Período 2019 a 2025 disponível."),
    );
    expect(c.grounded).toBe(true);
  });

  it("uses an injected Claude critic when provided; falls back to heuristic on failure", async () => {
    const good = { messages: { create: async () => ({ content: [{ type: "text", text: '{"grounded":true,"issues":[]}' }] }) } } as never;
    expect((await critiqueNarrative(draft("x", [{ priorId: "pa1", label: "y" }]), ctx("x"), good)).source).toBe("claude");
    const bad = { messages: { create: async () => { throw new Error("boom"); } } } as never;
    expect((await critiqueNarrative(draft("x"), ctx("x"), bad)).source).toBe("heuristic");
  });
});

const FIELDS: FormFieldDraft[] = [
  { section: "Limitações Metodológicas", label: "Principais limitações da base", cellType: "text", archetypeHint: "D", orderIdx: 0 },
];

describe("M2 · orchestrator attaches a critique to D — never changes status", () => {
  it("runs the critic and annotates the D answer, keeping status proposed", async () => {
    const criticSpy = vi.fn(async () => ({ grounded: false, issues: ["contains a number not supported"], source: "heuristic" as const }));
    const deps: OrchestratorDeps = {
      loadProfile: async () => null,
      loadCapability: async () => null,
      cohortPreview: async () => ({ n: 0, suppressed: false, perCriterionDelta: [] }),
      loadPriors: async () => [{ id: "pa1", section: "Limitações Metodológicas", label: "Principais limitações da base", conceptId: null, answerText: "cobertura" }],
      critique: criticSpy,
    };
    const r = await orchestrateAutofill({ siteId: "s1", fields: FIELDS, criteria: [] }, deps);
    const d = r.answers.find((a) => a.archetype === "D")!;
    expect(criticSpy).toHaveBeenCalledTimes(1);
    expect(d.critique?.grounded).toBe(false);
    expect(d.critique?.issues[0]).toMatch(/not supported/);
    expect(d.status).toBe("proposed"); // critique is advisory — it CANNOT approve or reject
  });
});
