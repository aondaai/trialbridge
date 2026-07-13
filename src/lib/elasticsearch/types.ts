import type { Criterion } from "@/lib/matcher/types";

export type ElasticsearchClause = Record<string, unknown>;

export interface ElasticsearchBoolQuery {
  bool: {
    must: ElasticsearchClause[];
    filter: ElasticsearchClause[];
    should: ElasticsearchClause[];
    minimum_should_match?: number;
  };
}

export interface ElasticsearchStage {
  criterionId: string;
  criterionText: string;
  stageType: "INCLUSION" | "EXCLUSION";
  /** How safely this stage can be used as an eligibility gate. */
  automation: "AUTOMATED" | "ASSISTED" | "MANUAL_REVIEW";
  rationale: string;
  /** Human-readable caveats the sponsor must acknowledge before posting. */
  limitations: string[];
  query: ElasticsearchBoolQuery;
}

export interface ElasticsearchQueryPlan {
  schemaVersion: "elasticsearch-funnel.v1";
  source: "claude" | "deterministic";
  model?: string;
  note: string;
  /** Set only after the sponsor explicitly reviews the generated stages. */
  reviewedAt?: string;
  stages: ElasticsearchStage[];
}

export interface ElasticsearchPlanInput {
  criteria: Criterion[];
}
