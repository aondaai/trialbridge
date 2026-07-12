import { describe, it, expect } from "vitest";
import { retrievePriorAnswers, tokenize, type PriorAnswer } from "@/lib/feasibility-autofill/rag";
import { draftNarrative } from "@/lib/feasibility-autofill/resolvers/narrative";
import { isMetric, Provenance, Confidence } from "@/lib/metric";

const PRIORS: PriorAnswer[] = [
  { id: "pa1", section: "Limitações Metodológicas", label: "Principais limitações da base", conceptId: null, answerText: "A base cobre 2019–2025; sazonalidade não modelada." },
  { id: "pa2", section: "Desafios", label: "Principais desafios para condução", conceptId: null, answerText: "Volume adequado; elegibilidade depende de NLP." },
  { id: "pa3", section: "Interesse em Participar", label: "Interesse em participar", conceptId: null, answerText: "Sim, há interesse dada a experiência prévia em DII." },
];

describe("F4-1 · prior-answer RAG retrieval", () => {
  it("tokenize drops short tokens and folds accents", () => {
    expect(tokenize("Principais limitações da base")).toEqual(["principais", "limitacoes", "base"]);
  });

  it("retrieves the most similar prior by label overlap + section bonus", () => {
    const hits = retrievePriorAnswers(
      { label: "Quais as principais limitações da base?", section: "Limitações Metodológicas" },
      PRIORS,
    );
    expect(hits[0].id).toBe("pa1");
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it("a matching concept breaks a lexical tie in its favour", () => {
    // Equal label overlap; only the concept differs → the concept match wins.
    const priors: PriorAnswer[] = [
      { id: "x", section: "Variáveis", label: "detalhes diversos aqui", conceptId: "ibd", answerText: "..." },
      { id: "y", section: "Variáveis", label: "detalhes diversos aqui", conceptId: null, answerText: "..." },
    ];
    const hits = retrievePriorAnswers({ label: "detalhes diversos aqui agora", conceptId: "ibd" }, priors);
    expect(hits[0].id).toBe("x");
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("returns nothing when no prior overlaps", () => {
    expect(retrievePriorAnswers({ label: "xyzzy plugh" }, PRIORS)).toHaveLength(0);
  });
});

describe("F4-2 · narrative resolver (archetype D)", () => {
  const ctx = {
    fieldLabel: "Principais limitações metodológicas da base",
    section: "Limitações Metodológicas",
    exemplars: retrievePriorAnswers(
      { label: "Principais limitações da base", section: "Limitações Metodológicas" },
      PRIORS,
    ),
    institutionFacts: { anonimizacao: "pseudonymized" },
  };

  it("offline (no key, no client) returns a grounded template draft — always proposed", async () => {
    const d = await draftNarrative(ctx);
    expect(d.status).toBe("proposed");
    expect(d.source).toBe("template");
    expect(d.draft).toContain("limitações");
    expect(d.citations.map((c) => c.priorId)).toContain("pa1");
    expect(isMetric(d.metric)).toBe(true);
    expect(d.metric.provenance).toBe(Provenance.MODELED);
    expect(d.metric.confidence).toBe(Confidence.LOW);
  });

  it("with an injected Claude client, still proposed and MODELED (LLM has no submit authority)", async () => {
    const fakeClient = {
      messages: {
        create: async () => ({
          model: "claude-opus-4-8",
          content: [{ type: "text", text: "Rascunho: a base não modela sazonalidade." }],
        }),
      },
    } as never;
    const d = await draftNarrative(ctx, fakeClient);
    expect(d.source).toBe("claude");
    expect(d.status).toBe("proposed");
    expect(d.draft).toContain("sazonalidade");
    // The type of status is the literal "proposed" — an approved narrative is unrepresentable.
    expect(d.metric.provenance).toBe(Provenance.MODELED);
  });

  it("falls back to template if the client throws — flow never breaks", async () => {
    const throwing = {
      messages: { create: async () => { throw new Error("429 overloaded"); } },
    } as never;
    const d = await draftNarrative(ctx, throwing);
    expect(d.source).toBe("template");
    expect(d.status).toBe("proposed");
    expect(d.note).toContain("Live draft failed");
  });
});
