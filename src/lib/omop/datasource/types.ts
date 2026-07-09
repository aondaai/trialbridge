/**
 * The OmopDataSource port — what a future OMOP-native matcher needs to
 * query real OMOP databases (DataSUS Tier 1 aggregate, DoctorAssistant
 * Tier 2 row-level, per docs/trialbridge-prd-v4.md). Additive: nothing in
 * matcher/engine.ts changes — this is a new, parallel query surface that
 * consumes `OmopCriterion[]` (src/lib/omop/transform.ts) instead of the
 * synthetic `Patient` fixture the current matcher evaluates against.
 *
 * `AggregateResult.counts` reuses matcher/engine.ts's `CohortCounts` shape
 * on purpose, so the existing aggregation/suppression layer
 * (matcher/aggregate.ts, already has <5 suppression) can consume a real
 * OMOP-backed count with zero changes once a concrete adapter is wired up.
 */

import type { CohortCounts } from "@/lib/matcher/engine";
import type { OmopCriterion } from "../types";

export interface AggregateQueryOptions {
  /** Restrict to one region. NOTE: not implemented by the DuckDB/GCS adapter this round — DataSUS's actual region column isn't confirmed yet (docs/trialbridge-prd-v4.md open question). */
  region?: string;
}

export interface RowLevelQueryOptions {
  siteId: string;
}

/** Per-criterion, per-patient result at the OMOP layer — the Tier 2 analogue of matcher/types.ts's CriterionResult. */
export interface OmopCriterionResult {
  criterionId: string;
  status: "pass" | "fail" | "unknown";
  /** The concept_id actually matched in the source table, for audit. */
  matchedConceptId: number | null;
  /** DoctorAssistant Tier 2's note_nlp provenance phrase, when available. */
  sourcePhrase?: string;
}

export interface OmopPatientEvaluation {
  personId: string;
  cohort: "definite" | "possible" | "excluded";
  results: OmopCriterionResult[];
}

/**
 * A criterion still `needsMapping: true` can't be pushed into a WHERE
 * clause against a real concept_id. Implementations must report it here
 * rather than silently dropping it or miscounting the cohort.
 */
export interface NotEvaluableCriterion {
  criterionId: string;
  reason: string;
}

export interface AggregateResult {
  counts: CohortCounts;
  notEvaluable: NotEvaluableCriterion[];
}

export interface OmopDataSource {
  /** Tier 1 — DataSUS-style aggregate-only counts. Must never return row-level data. */
  queryAggregate(criteria: OmopCriterion[], opts?: AggregateQueryOptions): Promise<AggregateResult>;
  /** Tier 2 — DoctorAssistant-style row-level, per-criterion pass/fail + provenance, one site at a time. */
  queryRowLevel(criteria: OmopCriterion[], opts: RowLevelQueryOptions): Promise<OmopPatientEvaluation[]>;
}

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}
