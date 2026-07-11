/**
 * Scorecard feed (F6-1) — structured answers → scorecard Metrics.
 *
 * The autofill answers are ALREADY `Metric`s (src/lib/metric — A/B site-declared, C modeled,
 * D modeled). This module reuses that type verbatim (it does NOT fork it): it groups a
 * request's answers into a provenanced structure the existing scorecard/report assembler can
 * consume, and exposes the provenance index so the Risk Register can render "N site-declared,
 * M modeled". No new provenance vocabulary — the same 5 seals the scorecard already uses.
 */

import {
  assertProvenanced,
  buildProvenanceIndex,
  type Metric,
  type ProvenanceIndex,
} from "@/lib/metric";

/** One answered field contributing to the scorecard. */
export interface AnsweredField {
  fieldId: string;
  archetype: "A" | "B" | "C" | "D";
  metric: Metric;
}

/**
 * A site's feasibility contribution to the scorecard: the candidate-count Metric (C) plus
 * the capability/profile Metrics that back the site's readiness. Shaped so the report
 * assembler's provenance gate accepts it (every value in a `*metric`/`*metrics` slot is a
 * Metric).
 */
export interface ScorecardContribution {
  siteId: string;
  requestId: string;
  /** The eligible-N Metric (archetype C), if the cohort was resolved. */
  candidateMetric: Metric | null;
  /** Capability + profile Metrics backing the site's declared readiness. */
  supportingMetrics: Metric[];
  provenance: ProvenanceIndex;
}

/**
 * Build a site's scorecard contribution from its answered fields. Only APPROVED-worthy
 * deterministic answers (A/B/C) feed the scorecard automatically; D metrics are included
 * only when explicitly passed as approved (the caller filters), since D never auto-approves.
 */
export function buildScorecardContribution(
  siteId: string,
  requestId: string,
  answers: AnsweredField[],
): ScorecardContribution {
  const candidate = answers.find((a) => a.archetype === "C")?.metric ?? null;
  const supporting = answers
    .filter((a) => a.archetype === "A" || a.archetype === "B")
    .map((a) => a.metric);

  const contribution: ScorecardContribution = {
    siteId,
    requestId,
    candidateMetric: candidate,
    supportingMetrics: supporting,
    provenance: buildProvenanceIndex({ candidate, supporting }),
  };

  // The scorecard's provenance gate must pass over what we feed it. Assert here so a
  // mis-shaped contribution fails loudly at the source, not deep in the assembler. Only
  // include the candidate slot when present — an empty metric slot would (correctly) trip
  // the gate, but "no cohort yet" is a valid state, not a provenance violation.
  const gate: Record<string, unknown> = { supportingMetrics: supporting };
  if (candidate) gate.candidateMetric = candidate;
  assertProvenanced(gate);
  return contribution;
}
