import { describe, it, expect, vi } from "vitest";
import { orchestrateAutofill, type OrchestratorDeps } from "@/lib/feasibility-autofill/mcp/orchestrator";
import { FEASIBILITY_AGENT, COHORT_MCP_SERVER } from "@/lib/feasibility-autofill/mcp/agentConfig";
import type { FormFieldDraft } from "@/lib/feasibility-autofill/ingest";
import type { Criterion } from "@/lib/matcher/types";
import type { ProfileLike } from "@/lib/feasibility-autofill/resolvers/profile";
import type { CapabilityLike } from "@/lib/feasibility-autofill/resolvers/capability";
import { Provenance } from "@/lib/metric";

const PROFILE: ProfileLike = {
  legalName: "iHealth (demo)", address: "", email: "", phone: "", website: "",
  anonymizationLevel: "pseudonymized", lgpdBasis: "", ethicsCommittee: "",
  contractingDaysEst: 45, acceptsEsignature: true, materials: "{}",
};

const CAP: CapabilityLike = {
  conceptId: "ibd", available: "yes", identificationMethod: "NLP", sourceField: "entity",
  completenessValue: 0.9, completenessQual: "high", notes: "",
};

const FIELDS: FormFieldDraft[] = [
  { section: "Instituição", label: "Nome da instituição", cellType: "text", archetypeHint: "A", orderIdx: 0 },
  { section: "Variáveis", label: "Diagnóstico de DII (Crohn/retocolite)", cellType: "yes_no_partial", archetypeHint: "B", orderIdx: 1 },
  { section: "Contagens", label: "Nº de pacientes elegíveis", cellType: "number", archetypeHint: "C", orderIdx: 2 },
  { section: "Limitações Metodológicas", label: "Principais limitações da base", cellType: "text", archetypeHint: "D", orderIdx: 3 },
];

const CRITERIA: Criterion[] = [
  { id: "c1", kind: "inclusion", field: "age", operator: "gte", value: 18, rawText: "Idade ≥ 18", confidence: 1 },
];

function makeDeps(over: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  return {
    loadProfile: async () => PROFILE,
    loadCapability: async (_s, concept) => (concept === "ibd" ? CAP : null),
    cohortPreview: async () => ({ n: 42, suppressed: false, perCriterionDelta: [] }),
    loadPriors: async () => [
      { id: "pa1", section: "Limitações Metodológicas", label: "Principais limitações da base", conceptId: null, answerText: "Cobertura 2019–2025." },
    ],
    asOf: "2026-07-11T00:00:00Z",
    ...over,
  };
}

describe("M1 · orchestrateAutofill routes A/B/C/D and assembles provenanced answers", () => {
  it("routes each field to its archetype and produces a Metric per field", async () => {
    const r = await orchestrateAutofill({ siteId: "s1", fields: FIELDS, criteria: CRITERIA }, makeDeps());
    const byArch = Object.fromEntries(r.answers.map((a) => [a.archetype, a]));
    expect(byArch.A.metric.value).toBe("iHealth (demo)");
    expect(byArch.B.metric.value).toBe("yes");
    expect(byArch.C.metric.value).toBe(42);
    expect(byArch.D.status).toBe("proposed");
    expect(byArch.D.narrative).toBeDefined();
  });

  it("calls cohort.preview exactly once, and only when a C field is present", async () => {
    const spy = vi.fn(async () => ({ n: 7, suppressed: false, perCriterionDelta: [] }));
    await orchestrateAutofill({ siteId: "s1", fields: FIELDS, criteria: CRITERIA }, makeDeps({ cohortPreview: spy }));
    expect(spy).toHaveBeenCalledTimes(1);

    const noCfields = FIELDS.filter((f) => f.section !== "Contagens");
    const spy2 = vi.fn(async () => ({ n: 0, suppressed: false, perCriterionDelta: [] }));
    await orchestrateAutofill({ siteId: "s1", fields: noCfields, criteria: CRITERIA }, makeDeps({ cohortPreview: spy2 }));
    expect(spy2).not.toHaveBeenCalled();
  });

  it("D is always proposed and comes from the injected drafter (no live LLM)", async () => {
    const drafted = vi.fn(async () => ({
      fieldLabel: "x", draft: "rascunho injetado", citations: [], status: "proposed" as const,
      metric: { key: "narrative.x", value: "rascunho injetado", provenance: Provenance.MODELED, confidence: "low" } as never,
      source: "template" as const, note: "",
    }));
    const r = await orchestrateAutofill({ siteId: "s1", fields: FIELDS, criteria: CRITERIA }, makeDeps({ draft: drafted }));
    expect(drafted).toHaveBeenCalledTimes(1);
    const d = r.answers.find((a) => a.archetype === "D")!;
    expect(d.narrative!.draft).toBe("rascunho injetado");
    expect(d.status).toBe("proposed");
  });

  it("the assembled result passes the provenance gate and indexes by seal", async () => {
    const r = await orchestrateAutofill({ siteId: "s1", fields: FIELDS, criteria: CRITERIA }, makeDeps());
    expect(r.provenance.total).toBe(4);
    expect(r.provenance.bySeal[Provenance.SITE_DECLARED]).toBeGreaterThanOrEqual(2); // A + B
    expect(r.provenance.bySeal[Provenance.MODELED]).toBeGreaterThanOrEqual(2); // C + D
  });

  it("no patient rows appear in the orchestrated output (C came via aggregates)", async () => {
    const r = await orchestrateAutofill({ siteId: "s1", fields: FIELDS, criteria: CRITERIA }, makeDeps());
    // Patient-record markers (a leaked Patient object) must be absent. "patients" as a unit is fine.
    expect(JSON.stringify(r)).not.toMatch(/biomarkers|her2_status|"diagnosis"|"labs"/i);
  });

  it("degrades gracefully when the profile is missing (unavailable, not a crash)", async () => {
    const r = await orchestrateAutofill({ siteId: "s1", fields: FIELDS, criteria: CRITERIA }, makeDeps({ loadProfile: async () => null }));
    const a = r.answers.find((x) => x.archetype === "A")!;
    expect(a.metric.value).toBeNull();
  });
});

describe("M1 · MCA agent definition", () => {
  it("declares only the cohort.preview MCP tool (A/B/D are orchestrated, not model-called)", () => {
    expect(FEASIBILITY_AGENT.tools).toHaveLength(1);
    expect(FEASIBILITY_AGENT.tools[0]).toEqual({ type: "mcp", server: COHORT_MCP_SERVER, name: "cohort.preview" });
  });

  it("system prompt encodes the hard invariants (aggregates-only C, D never approves)", () => {
    expect(FEASIBILITY_AGENT.systemPrompt).toMatch(/AGGREGATES ONLY/);
    expect(FEASIBILITY_AGENT.systemPrompt).toMatch(/proposed/);
    expect(FEASIBILITY_AGENT.model).toBe("claude-opus-4-8");
  });
});
