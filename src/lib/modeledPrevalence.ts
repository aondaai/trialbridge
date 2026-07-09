/**
 * The modeled-prevalence funnel — a second, distinct axis of uncertainty from
 * `feasibility.ts`'s R1/R2 screen-to-enrol discount.
 *
 * The matcher's "possible" pool (screened but unresolved on a not-evaluable
 * criterion, e.g. KRAS G12C / PD-L1 status — see `nsclc-kras-protocol.ts`) is
 * an OBSERVED count from the site's own data. It is NOT the same thing as
 * "how many of these patients would actually qualify if tested" — that
 * requires applying published prevalence rates for the molecular subgroup
 * the trial selects for. This module keeps that distinction explicit: every
 * output is tagged `MODELED` and is never presented as a deliverable or
 * observed count — same discipline as feasibility.ts's "clearly-labelled
 * placeholder, never presented as deliverable", applied to molecular
 * prevalence instead of funnel/screen-fail attrition. Kept as its own file
 * on purpose rather than folded into feasibility.ts — these are two
 * independent sources of "the raw count overstates reality", and conflating
 * them would blur which discount is doing what.
 */

export interface PrevalenceAssumption {
  id: string;
  label: string;
  /** 0..1 */
  rate: number;
  citation: string;
}

export interface ModeledFunnelInput {
  /** The observed addressable pool this layer scales down from — typically the matcher's `possible + definite` (screeningPool). */
  addressablePool: number;
  /** Multiplied together to get the combined rate (independence assumed — a modeling simplification, stated as such). */
  assumptions: PrevalenceAssumption[];
}

export interface ModeledFunnelEstimate {
  addressablePool: number;
  assumptions: PrevalenceAssumption[];
  combinedRate: number;
  /** Rounded estimate. NOT an observed count — see module docstring. */
  modeledEligible: number;
  /** Constant, so the UI can never accidentally present this as observed. */
  label: "MODELED";
}

export function estimateModeledEligible(input: ModeledFunnelInput): ModeledFunnelEstimate {
  const combinedRate = input.assumptions.reduce((acc, a) => acc * a.rate, 1);
  return {
    addressablePool: input.addressablePool,
    assumptions: input.assumptions,
    combinedRate,
    modeledEligible: Math.round(input.addressablePool * combinedRate),
    label: "MODELED",
  };
}

const CITATION_GALFFY =
  "Gálffy et al., \"Targeting KRAS Mutant Lung Cancer\", Pathol Oncol Res 2024, DOI 10.3389/pore.2024.1611715";
const CITATION_REMON =
  "Remon et al., \"KRAS G12C-mutant NSCLC: first-line treatment strategies\", Cancer Treat Rev 2026, DOI 10.1016/j.ctrv.2026.103144";

/** KRAS G12C prevalence among NSCLC (PubMed-cited, see docs/citations.md). */
export const KRAS_G12C_PREVALENCE: PrevalenceAssumption = {
  id: "kras_g12c",
  label: "KRAS G12C prevalence in NSCLC (~13–15%)",
  rate: 0.14,
  citation: `${CITATION_GALFFY}; ${CITATION_REMON}`,
};

/** Beat 3 baseline — the trial's actual gate. */
export const PDL1_NEGATIVE_ONLY: PrevalenceAssumption = {
  id: "pdl1_negative_only",
  label: "PD-L1-negative only (TPS 0%)",
  rate: 0.3,
  citation: CITATION_REMON,
};

/** Beat 3 widened variant — Marcus's lever, ~2x the negative-only rate. */
export const PDL1_NEGATIVE_OR_LOW: PrevalenceAssumption = {
  id: "pdl1_negative_or_low",
  label: "PD-L1-negative or low (TPS 0–49%)",
  rate: 0.65,
  citation: CITATION_REMON,
};
