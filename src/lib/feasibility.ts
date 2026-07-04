/**
 * R1 + R2 — turning a raw match count into an honest feasibility statement.
 *
 * The spec's own killer statistic is that 76% of sponsors OVERESTIMATE available
 * patients. A chart-match count IS that overcount: it counts patients who exist on
 * paper, ignoring the screen-fail / consent / competition funnel and the fact that
 * trials enrol from *incident flow*, not a static prevalent snapshot.
 *
 * So we never present matchedCount as deliverable capacity. Two corrections:
 *
 *   R1  Funnel discount — a crude screen-to-enrol multiplier makes match ≠ enrollable
 *       visible. Default 0.30 (a deliberately conservative, labelled placeholder).
 *   R2  Capacity as a RATE — each site carries a nominal monthly-incidence figure so
 *       capacity reads "≈N enrollable over 6 months", not "N exist today".
 */

/** Default, clearly-labelled screen-to-enrol conversion. NOT a validated figure. */
export const DEFAULT_SCREEN_TO_ENROLL = 0.3;

export interface FeasibilityInput {
  /** Confirmed-eligible now (definite cohort). */
  definite: number;
  /** Possible-eligible now (needs a test/confirmation; possible cohort). */
  possible: number;
  /** Nominal new eligible patients per month at this site (incident flow, R2). */
  monthlyIncidence: number;
  /** Enrolment window to project over. */
  months: number;
  /** Screen-to-enrol multiplier (R1). */
  screenToEnroll?: number;
}

export interface FeasibilityEstimate {
  /** Upper-bound screening pool = definite + possible. NOT deliverable. */
  screeningPool: number;
  /** Incident candidates expected across the window (rate × months). */
  incidentOverWindow: number;
  /** Funnel-discounted deliverable estimate — the number a sponsor should plan around. */
  enrollableEstimate: number;
  screenToEnroll: number;
  months: number;
}

/** Round half-up to an integer patient count. */
function roundPatients(n: number): number {
  return Math.round(n);
}

/**
 * Combine the standing pool and incident flow, then apply the funnel discount.
 *
 * We take the standing screening pool as a one-time contribution and add incident
 * flow across the window, then discount the whole thing to an enrollable estimate.
 * This is intentionally crude and labelled as such — the point is that the number
 * on screen is smaller and rate-aware, not that it is precise.
 */
export function estimateFeasibility(input: FeasibilityInput): FeasibilityEstimate {
  const rate = input.screenToEnroll ?? DEFAULT_SCREEN_TO_ENROLL;
  const screeningPool = input.definite + input.possible;
  const incidentOverWindow = roundPatients(input.monthlyIncidence * input.months);
  const enrollableEstimate = roundPatients((screeningPool + incidentOverWindow) * rate);
  return {
    screeningPool,
    incidentOverWindow,
    enrollableEstimate,
    screenToEnroll: rate,
    months: input.months,
  };
}
