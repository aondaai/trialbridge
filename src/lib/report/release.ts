import type { NationalEstimate } from "@/lib/estimator/client";

/**
 * Partial estimator payloads produced before eligibility_fraction_applied was
 * added omit the flag. A positive, explicitly review-only proprietary cohort
 * still permits the evidence report; it never permits quantitative scoring.
 */
export function hasCandidateValidationCohort(
  estimate: NationalEstimate | null | undefined,
): boolean {
  return !!estimate
    && estimate.eligibilityFractionApplied !== true
    && (estimate.proprietaryFindingTotal ?? 0) > 0;
}
