/**
 * Pure SQL-building logic for the Tier 1 (DataSUS-style, aggregate-only)
 * adapter — separated from the DB connection glue in `duckdbGcs.ts` so it's
 * unit-testable without a live DuckDB/GCS connection (no credentials exist
 * in this environment yet — see docs in that file).
 *
 * SIMPLIFICATION (documented, not hidden — same discipline as
 * docs/omop-vocabulary-mapping.md): this queries standard OMOP CDM v5.4
 * tables directly against `*_concept_id` (no concept_ancestor hierarchy
 * expansion), and treats "no matching record" as absence — the claims-
 * data-style limitation PRD v4 explicitly calls out for Tier 1 (DataSUS):
 * it cannot reliably distinguish "confirmed absent" from "never recorded"
 * the way Tier 2 (DoctorAssistant)'s `assertion` field can. `possible` is
 * therefore computed by the caller as `total - definite - excluded`, an
 * approximation — not a per-criterion `unknown` tally like the synthetic
 * matcher's tri-state (matcher/engine.ts). Revisit once Tier 2's row-level
 * assertion logic is designed (docs/trialbridge-prd-v4.md, Day 3).
 */

import type { OmopCriterion } from "../types";
import type { NotEvaluableCriterion } from "./types";

const CONCEPT_COLUMN: Record<string, string> = {
  condition_occurrence: "condition_concept_id",
  measurement: "measurement_concept_id",
  observation: "observation_concept_id",
  drug_exposure: "drug_concept_id",
  device_exposure: "device_concept_id",
};

export interface EvaluablePartition {
  evaluable: OmopCriterion[];
  notEvaluable: NotEvaluableCriterion[];
}

/** Criteria still `needsMapping: true` can't go in a WHERE clause — split them out rather than silently dropping or miscounting them. */
export function partitionEvaluable(criteria: OmopCriterion[]): EvaluablePartition {
  const evaluable: OmopCriterion[] = [];
  const notEvaluable: NotEvaluableCriterion[] = [];
  for (const c of criteria) {
    if (c.concept.needsMapping) {
      notEvaluable.push({
        criterionId: c.criterionId,
        reason: `concept "${c.concept.conceptName}" (field: ${c.sourceField}) has no verified concept_id yet`,
      });
    } else {
      evaluable.push(c);
    }
  }
  return { evaluable, notEvaluable };
}

function numericConditionOnColumn(col: string, operator: OmopCriterion["operator"], value: OmopCriterion["value"]): string | null {
  switch (operator) {
    case "lt":
      return typeof value === "number" ? `${col} < ${value}` : null;
    case "lte":
      return typeof value === "number" ? `${col} <= ${value}` : null;
    case "gt":
      return typeof value === "number" ? `${col} > ${value}` : null;
    case "gte":
      return typeof value === "number" ? `${col} >= ${value}` : null;
    case "between":
      return Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number"
        ? `${col} BETWEEN ${value[0]} AND ${value[1]}`
        : null;
    default:
      return null;
  }
}

/** One criterion -> a boolean SQL expression, true when the concept is PRESENT for person `p`. Assertion (PRESENT/ABSENT) is applied by the caller, not here. */
function presenceFragment(c: OmopCriterion, alias: string): string {
  const { concept } = c;

  if (concept.table === "person") {
    if (c.sourceField === "sex") {
      return `p.gender_concept_id = ${concept.conceptId}`;
    }
    if (c.sourceField === "age") {
      const numeric = numericConditionOnColumn(
        "(EXTRACT(YEAR FROM CURRENT_DATE) - p.year_of_birth)",
        c.operator,
        c.value,
      );
      return numeric ?? "TRUE";
    }
    return "TRUE"; // unrecognized person-domain field — nothing to filter on
  }

  const col = CONCEPT_COLUMN[concept.table];
  const conditions = [`${alias}.person_id = p.person_id`, `${alias}.${col} = ${concept.conceptId}`];
  if (concept.table === "measurement") {
    const numeric = numericConditionOnColumn(`${alias}.value_as_number`, c.operator, c.value);
    if (numeric) conditions.push(numeric);
  }
  return `EXISTS (SELECT 1 FROM ${concept.table} ${alias} WHERE ${conditions.join(" AND ")})`;
}

/**
 * Build the Tier 1 aggregate query as a single round-trip: total cohort size,
 * `definite` (every inclusion criterion's concept present, no exclusion
 * criterion's concept present), and `excluded` (any exclusion criterion's
 * concept present). Caller derives `possible = total - definite - excluded`.
 *
 * `criteria` should already be the `evaluable` half of `partitionEvaluable`
 * — this function does not check `needsMapping` itself.
 */
export function buildAggregateSql(criteria: OmopCriterion[], schema = "main"): string {
  const inclusionFragments = criteria
    .filter((c) => c.assertion !== "ABSENT")
    .map((c, i) => presenceFragment(c, `inc${i}`));
  const exclusionFragments = criteria
    .filter((c) => c.assertion === "ABSENT")
    .map((c, i) => presenceFragment(c, `exc${i}`));

  const inclusionAll = inclusionFragments.length ? inclusionFragments.join(" AND ") : "TRUE";
  const anyExclusion = exclusionFragments.length ? `(${exclusionFragments.join(" OR ")})` : "FALSE";

  return [
    "SELECT",
    "  COUNT(DISTINCT p.person_id) AS total,",
    `  COUNT(DISTINCT CASE WHEN (${inclusionAll}) AND NOT ${anyExclusion} THEN p.person_id END) AS definite,`,
    `  COUNT(DISTINCT CASE WHEN ${anyExclusion} THEN p.person_id END) AS excluded`,
    `FROM ${schema}.person p;`,
  ].join("\n");
}
