import { describe, expect, it } from "vitest";
import type { Criterion } from "@/lib/matcher/types";
import { buildElasticsearchPlan, deterministicStage } from "@/lib/elasticsearch/plan";
import { validateElasticsearchPlan, validateElasticsearchQuery } from "@/lib/elasticsearch/validate";

const criterion = (patch: Partial<Criterion> = {}): Criterion => ({
  id: "c1", kind: "inclusion", field: "age", operator: "gte", value: 55,
  rawText: "Age 55 years or older", confidence: 0.9, ...patch,
});

describe("Elasticsearch funnel plan", () => {
  it("converts minimum age to a birthdate filter", () => {
    const stage = deterministicStage(criterion());
    expect(stage.automation).toBe("AUTOMATED");
    expect(stage.limitations).toEqual([]);
    expect(stage.query).toEqual({
      bool: { must: [], filter: [{ range: { birthdate: { lte: "now-55y/d" } } }], should: [] },
    });
  });

  it("marks unsupported clinical semantics for manual review", () => {
    const stage = deterministicStage(criterion({
      field: "signed_icf",
      operator: "exists",
      value: null,
      baseFit: "not_answerable",
      rawText: "Signed and dated informed consent before study procedures",
    }));
    expect(stage.automation).toBe("MANUAL_REVIEW");
    expect(stage.limitations[0]).toMatch(/documento-fonte/i);
  });

  it("keeps runtime configuration details out of sponsor-facing fallback notes", async () => {
    const prior = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const plan = await buildElasticsearchPlan([criterion()]);
      expect(plan.note).not.toContain("ANTHROPIC_API_KEY");
      expect(plan.note).toMatch(/validated local plan/i);
    } finally {
      if (prior === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prior;
    }
  });

  it("keeps exclusions as positive match queries in EXCLUSION stages", () => {
    const stage = deterministicStage(criterion({ kind: "exclusion", field: "diabetes", operator: "exists", value: null, rawText: "Diabetes" }));
    expect(stage.stageType).toBe("EXCLUSION");
    expect(JSON.stringify(stage.query)).not.toContain("must_not");
  });

  it("rejects nested fields outside nested and must_not", () => {
    expect(() => validateElasticsearchQuery({ bool: { must: [{ match: { "preds.clinical_entities.entity": "diabetes" } }], filter: [], should: [] } })).toThrow(/nested/i);
    expect(() => validateElasticsearchQuery({ bool: { must: [], filter: [], should: [], must_not: [] } })).toThrow(/EXCLUSION/);
  });

  it("accepts a valid clinical-entity nested query", () => {
    expect(() => validateElasticsearchQuery({ bool: { must: [{ nested: { path: "preds.clinical_entities", query: { bool: { must: [
      { match: { "preds.clinical_entities.entity": { query: "diabetes DM2", operator: "or" } } },
      { terms: { "preds.clinical_entities.label": ["DISEASE"] } },
      { terms: { "preds.clinical_entities.assertion": ["PRESENTE", "HISTORICO"] } },
    ] } } } }], filter: [], should: [] } })).not.toThrow();
  });

  it("requires all three root bool arrays", () => {
    expect(() => validateElasticsearchQuery({ bool: { must: [], filter: [] } })).toThrow(/should/);
  });

  it("validates automation metadata and review timestamp", () => {
    const stage = deterministicStage(criterion());
    expect(() => validateElasticsearchPlan({
      schemaVersion: "elasticsearch-funnel.v1",
      source: "deterministic",
      note: "reviewed",
      reviewedAt: "2026-07-13T12:00:00.000Z",
      stages: [stage],
    })).not.toThrow();
    expect(() => validateElasticsearchPlan({
      schemaVersion: "elasticsearch-funnel.v1",
      source: "deterministic",
      note: "invalid",
      stages: [{ ...stage, automation: "UNKNOWN" }],
    })).toThrow(/automation/i);
  });
});
