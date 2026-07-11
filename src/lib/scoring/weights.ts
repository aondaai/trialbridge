/**
 * Scoring weights & trial profiles (engineering spec §6.2, Appendix D).
 *
 * The defaults below MUST match the scorecard spec (§5 country, §6 site). Each trial
 * profile is expressed as a set of MULTIPLIERS on the defaults (1.0 = unchanged),
 * which are then renormalized to sum to 1.0. Expressing profiles as multipliers +
 * renormalization means every resolved vector sums to 1.0 by construction — the CI
 * invariant can never be violated by an arithmetic slip in a hand-written vector.
 *
 * A run persists the exact resolved vector it used (spec §4.3 runs.weight_profile),
 * so a report is reproducible even if these defaults later change.
 */

export type CountryDimension =
  | "regulatory"
  | "patient_supply"
  | "competition"
  | "cost"
  | "infrastructure"
  | "data_quality"
  | "logistics";

export type SiteComponent =
  | "eligible_pool"
  | "predicted_enrollment"
  | "enrollment_history"
  | "competition"
  | "infrastructure_fit"
  | "kol_strength"
  | "startup_fpi"
  | "data_quality"
  | "staff_capacity";

export type CountryWeights = Record<CountryDimension, number>;
export type SiteWeights = Record<SiteComponent, number>;

/** Country defaults — scorecard spec §5. Sum = 1.0. */
export const COUNTRY_WEIGHTS_DEFAULT: CountryWeights = {
  regulatory: 0.2,
  patient_supply: 0.22,
  competition: 0.12,
  cost: 0.16,
  infrastructure: 0.14,
  data_quality: 0.1,
  logistics: 0.06,
};

/** Site defaults — scorecard spec §6. Sum = 1.0. */
export const SITE_WEIGHTS_DEFAULT: SiteWeights = {
  eligible_pool: 0.18,
  predicted_enrollment: 0.18,
  enrollment_history: 0.12,
  competition: 0.1,
  infrastructure_fit: 0.12,
  kol_strength: 0.1,
  startup_fpi: 0.08,
  data_quality: 0.07,
  staff_capacity: 0.05,
};

export type TrialProfile =
  | "default"
  | "onc_early"
  | "onc_ph3"
  | "rare_disease"
  | "vaccine_id"
  | "cardiology";

export const TRIAL_PROFILES: TrialProfile[] = [
  "default",
  "onc_early",
  "onc_ph3",
  "rare_disease",
  "vaccine_id",
  "cardiology",
];

interface ProfileSpec {
  rationale: string;
  country: Partial<Record<CountryDimension, number>>; // multipliers, default 1.0
  site: Partial<Record<SiteComponent, number>>;
}

/**
 * Profile multipliers (on the defaults). Rationale per Appendix D. Values >1 bump a
 * weight, <1 cut it; the vector is renormalized after applying.
 */
const PROFILE_SPECS: Record<TrialProfile, ProfileSpec> = {
  default: { rationale: "Balanced defaults.", country: {}, site: {} },
  onc_early: {
    rationale:
      "Early-phase oncology: patient supply + KOL depth dominate; regulatory speed matters; competition still relevant.",
    country: { patient_supply: 1.25, regulatory: 1.1, cost: 0.9 },
    site: { eligible_pool: 1.2, kol_strength: 1.4, predicted_enrollment: 1.1, staff_capacity: 1.1 },
  },
  onc_ph3: {
    rationale:
      "Phase III oncology: enrollment throughput + startup speed + data acceptance dominate; large multi-site pull.",
    country: { patient_supply: 1.2, data_quality: 1.2, regulatory: 1.1 },
    site: { predicted_enrollment: 1.3, enrollment_history: 1.3, startup_fpi: 1.2, competition: 1.2 },
  },
  rare_disease: {
    rationale:
      "Rare disease: pool scarcity + KOL concentration dominate; competition matters far less (few competing trials).",
    country: { patient_supply: 1.3, infrastructure: 1.1, competition: 0.5 },
    site: { eligible_pool: 1.4, kol_strength: 1.4, competition: 0.4, predicted_enrollment: 1.1 },
  },
  vaccine_id: {
    rationale:
      "Vaccine / infectious disease: speed + population supply dominate; molecular-pool depth matters less.",
    country: { patient_supply: 1.25, regulatory: 1.25, logistics: 1.2, cost: 0.9 },
    site: { predicted_enrollment: 1.3, startup_fpi: 1.3, staff_capacity: 1.2, kol_strength: 0.8 },
  },
  cardiology: {
    rationale:
      "Cardiology: broad prevalence + infrastructure (imaging, cath, ICU) + retention; molecular gating minimal.",
    country: { patient_supply: 1.15, infrastructure: 1.2, cost: 1.1 },
    site: { infrastructure_fit: 1.3, enrollment_history: 1.2, eligible_pool: 1.1 },
  },
};

/** Renormalize any positive weight map to sum exactly 1.0. */
function renormalize<K extends string>(w: Record<K, number>): Record<K, number> {
  const total = (Object.values(w) as number[]).reduce((s, v) => s + v, 0);
  if (total <= 0) throw new Error("weights must be positive and sum to a positive total");
  const out = {} as Record<K, number>;
  for (const k of Object.keys(w) as K[]) out[k] = (w[k] as number) / total;
  return out;
}

function applyMultipliers<K extends string>(
  base: Record<K, number>,
  mult: Partial<Record<K, number>>,
): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of Object.keys(base) as K[]) out[k] = (base[k] as number) * (mult[k] ?? 1);
  return renormalize(out);
}

/** Resolve the country weight vector for a profile (renormalized, sums to 1.0). */
export function resolveCountryWeights(profile: TrialProfile = "default"): CountryWeights {
  return applyMultipliers(COUNTRY_WEIGHTS_DEFAULT, PROFILE_SPECS[profile].country) as CountryWeights;
}

/** Resolve the site weight vector for a profile (renormalized, sums to 1.0). */
export function resolveSiteWeights(profile: TrialProfile = "default"): SiteWeights {
  return applyMultipliers(SITE_WEIGHTS_DEFAULT, PROFILE_SPECS[profile].site) as SiteWeights;
}

export function profileRationale(profile: TrialProfile): string {
  return PROFILE_SPECS[profile].rationale;
}

/** True if a weight vector sums to 1.0 within tolerance (the CI invariant). */
export function sumsToOne(w: Record<string, number>, tol = 1e-9): boolean {
  const total = (Object.values(w) as number[]).reduce((s, v) => s + v, 0);
  return Math.abs(total - 1) <= tol;
}

/**
 * Validate a sponsor-supplied weight override (spec §12.2: /runs rejects overrides
 * that don't sum to 1.0). Returns the vector unchanged if valid; throws otherwise.
 */
export function validateOverride<K extends string>(w: Record<K, number>, tol = 1e-9): Record<K, number> {
  if ((Object.values(w) as number[]).some((v) => v < 0)) throw new Error("weights must be non-negative");
  if (!sumsToOne(w, tol)) {
    const total = (Object.values(w) as number[]).reduce((s, v) => s + v, 0);
    throw new Error(`weights must sum to 1.0 (got ${total})`);
  }
  return w;
}
