/**
 * Cited constants library (engineering spec Appendix C).
 *
 * The scoring engine leans on published benchmark figures — Tufts enrolment stats,
 * cost ratios, amendment costs, regulatory timelines. Rather than sprinkle bare
 * numbers through the scorers, every such figure lives here as a `Metric` with its
 * citation and an HONEST seal. Changing a constant is a reviewed change with a
 * source (the CLAUDE.md rule). This is the typed, auditable promotion of the prose
 * in docs/citations.md — and where citations.md flags a number as vendor-sourced or
 * shaky, the seal here reflects that (e.g. the L.E.K. "65% cheaper" is VENDOR/LOW,
 * NOT peer-reviewed).
 *
 * `asOf` values are the source's publication/measurement year as a stable string —
 * injected data, not a runtime clock read.
 */

import {
  Confidence,
  Metric,
  metric,
  modeled,
  peerReviewed,
  registry,
  vendor,
  Provenance,
} from "@/lib/metric";

// ── Enrollment reality (Tufts CSDD / Getz) — the "problem we solve" header ──────

/** Sites activated that recruit ZERO patients — global. */
export const ZERO_ENROLLERS_GLOBAL = peerReviewed("bench.zero_enrollers_global", 11, Confidence.HIGH, {
  unit: "%",
  asOf: "2013",
  sourceRefs: [{ label: "Tufts CSDD / Getz, Applied Clinical Trials", url: "https://csdd.tufts.edu/" }],
  note: 'Historic "folk stat" was 20%; the measured figure is ~11%.',
});

/** Zero-enrollers in Latin America — the worst region, and the crux of the TrialBridge thesis. */
export const ZERO_ENROLLERS_LATAM = peerReviewed("bench.zero_enrollers_latam", 20, Confidence.HIGH, {
  unit: "%",
  asOf: "2013",
  sourceRefs: [{ label: "Tufts CSDD / Getz", url: "https://csdd.tufts.edu/" }],
  note: "vs. 7% Western Europe, 13% North America — LatAm upside is real but execution risk is highest.",
});

/** Sites that miss their enrollment target. */
export const SITES_MISS_TARGET = peerReviewed("bench.sites_miss_target", 41, Confidence.MEDIUM, {
  unit: "%",
  asOf: "2013",
  sourceRefs: [{ label: "Tufts CSDD / Getz" }],
  note: "Up to 48% if the denominator is all selected sites.",
});

/** Studies that complete enrollment on time. */
export const STUDIES_ENROLL_ON_TIME = peerReviewed("bench.studies_enroll_on_time", 47, Confidence.HIGH, {
  unit: "%",
  asOf: "2013",
  sourceRefs: [{ label: "Tufts CSDD / Getz" }],
  note: "53% overrun; 1 in 6 take >2x the planned time.",
});

/** Patient dropout. */
export const PATIENT_DROPOUT = peerReviewed("bench.patient_dropout", 17, Confidence.MEDIUM, {
  unit: "%",
  asOf: "2013",
  sourceRefs: [{ label: "Tufts CSDD / Getz" }],
});

// ── Regulatory startup timelines ────────────────────────────────────────────────

/** Startup (CTA execution) with a CENTRAL IRB. */
export const STARTUP_CENTRAL_IRB_DAYS = peerReviewed("bench.startup_central_irb_days", 45, Confidence.MEDIUM, {
  unit: "days",
  sourceRefs: [{ label: "Tufts CSDD; Applied Clinical Trials" }],
});

/** Startup with LOCAL IRBs — the contrast that motivates central review. */
export const STARTUP_LOCAL_IRB_DAYS = peerReviewed("bench.startup_local_irb_days", 145, Confidence.MEDIUM, {
  unit: "days",
  sourceRefs: [{ label: "Tufts CSDD; Applied Clinical Trials" }],
});

/**
 * Brazil statutory timelines under Lei 14.874/2024 (business days). Registry/gov,
 * high confidence as WRITTEN LAW — but the country scorecard applies an
 * implementation-maturity penalty because steady-state realisation is unverified
 * (young INAEP, ANVISA backlog, ADI 7875 at the STF). See scorecard spec §5.1 D1.
 */
export const BR_CEP_ETHICS_DAYS = registry("const.br_cep_ethics_days", 30, Confidence.HIGH, {
  unit: "business_days",
  asOf: "2024",
  sourceRefs: [{ label: "Lei 14.874/2024; Decreto 12.651/2025" }],
});
export const BR_ANVISA_DAYS = registry("const.br_anvisa_days", 90, Confidence.HIGH, {
  unit: "business_days",
  asOf: "2024",
  sourceRefs: [{ label: "Lei 14.874/2024; ANVISA RDC 945/2024" }],
  note: "Tacit approval on lapse; 15 business days for SUS-strategic/emergency studies.",
});
export const BR_SUS_STRATEGIC_DAYS = registry("const.br_sus_strategic_days", 15, Confidence.HIGH, {
  unit: "business_days",
  asOf: "2024",
  sourceRefs: [{ label: "Lei 14.874/2024" }],
});

/** Historic serial CEP+CONEP+ANVISA baseline, for contrast (measured, pre-reform). */
export const BR_ANVISA_HISTORIC_DAYS = vendor("const.br_anvisa_historic_days", 215, Confidence.MEDIUM, {
  unit: "days",
  asOf: "2022",
  sourceRefs: [{ label: "Interfarma/IQVIA (2020–2022 measured mean)" }],
  note: "Pre-Lei-14.874 serial process; used only as a before/after contrast, not a forward estimate.",
});

// ── Cost anchors ────────────────────────────────────────────────────────────────

/** Peer-reviewed cost anchor: LatAm cost per site = 59% of North America (≈41% cheaper). */
export const COST_LATAM_PCT_OF_NA = peerReviewed("const.cost_latam_pct_of_na", 59, Confidence.HIGH, {
  unit: "%",
  asOf: "2019",
  sourceRefs: [
    { label: "Qiao et al., Clinical Trials 2019 (IQVIA CostPro)", url: "https://doi.org/10.1177/1740774519871387" },
  ],
  note: "Western Europe = 78% of NA; Brazil is cheaper than Western Europe too.",
});

/**
 * Vendor oncology-specific figure: ~65% cheaper. Per docs/citations.md this is a
 * SINGLE unsourced L.E.K. 2025 article — labelled VENDOR/LOW, never peer-reviewed.
 * The defensible headline the report shows is ~25–45% (Qiao anchor minus Brazil adds).
 */
export const COST_ONC_SAVING_VENDOR = vendor("const.cost_onc_saving_vendor", 65, Confidence.LOW, {
  unit: "%",
  asOf: "2025",
  sourceRefs: [
    { label: "L.E.K. Consulting 2025 (single, unsourced)", url: "https://www.lek.com/insights/life-sciences-pharma/unlocking-brazils-clinical-trial-opportunity-strategic-roadmap" },
  ],
  note: "Directional only; A.T. Kearney implies ~39% all-trials. Always attribute; do not present as measured.",
});

/** Median cost per patient, US pivotal (for benchmark-relative normalisation when the sponsor gives none). */
export const COST_PER_PATIENT_US = peerReviewed("const.cost_per_patient_us", 41413, Confidence.HIGH, {
  unit: "usd",
  asOf: "2018",
  sourceRefs: [{ label: "JAMA Intern Med / PMC7295430", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7295430/" }],
  note: "IQR $29,894–$75,047.",
});

/**
 * Brazil-specific cost adds the model SUBTRACTS from the saving. These are
 * TrialBridge-modeled midpoints of published ranges, not registry facts — so they
 * are sealed MODELED (honest) rather than dressed up as official figures.
 */
const TB_COST_MODEL_REF = { label: "TrialBridge cost model — directional midpoint of published import/insurance/translation ranges" };
export const BR_IMP_IMPORT_COST = modeled("const.br_imp_import_cost", 10000, Confidence.LOW, {
  unit: "usd",
  sourceRefs: [TB_COST_MODEL_REF],
  note: "IMP import ~$5–15k midpoint; directional.",
});
export const BR_TRIAL_INSURANCE_COST = modeled("const.br_trial_insurance_cost", 16500, Confidence.LOW, {
  unit: "usd",
  sourceRefs: [TB_COST_MODEL_REF],
  note: "Trial insurance ~$8–25k midpoint.",
});
export const BR_TRANSLATION_COST = modeled("const.br_translation_cost", 5500, Confidence.LOW, {
  unit: "usd",
  sourceRefs: [TB_COST_MODEL_REF],
  note: "Certified translation ~$3–8k midpoint.",
});

// ── Amendment costs (the softening simulator monetises avoided amendments) ───────

/** Substantial protocol amendment cost — Phase II. */
export const AMENDMENT_COST_PH2 = peerReviewed("const.amendment_cost_ph2", 141000, Confidence.HIGH, {
  unit: "usd",
  sourceRefs: [{ label: "Tufts CSDD; Springer TIRS" }],
  note: "~45% of substantial amendments are avoidable; #1 cause is eligibility changes.",
});

/** Substantial protocol amendment cost — Phase III. */
export const AMENDMENT_COST_PH3 = peerReviewed("const.amendment_cost_ph3", 535000, Confidence.HIGH, {
  unit: "usd",
  sourceRefs: [{ label: "Tufts CSDD; Springer TIRS" }],
});

/** Look up the cited amendment cost for a trial phase (feeds softening.amendment_cost_avoided). */
export function amendmentCost(phase: "II" | "III" | number): Metric<number> {
  const isPh3 = phase === "III" || phase === 3;
  return isPh3 ? AMENDMENT_COST_PH3 : AMENDMENT_COST_PH2;
}

// ── Data quality (FDA GCP inspections, ex-US incl. LatAm) ────────────────────────

/** OAI (grave) rate in FDA GCP inspections — low OAI = the data is accepted. */
export const FDA_GCP_OAI_RATE = peerReviewed("const.fda_gcp_oai_rate", 4.1, Confidence.HIGH, {
  unit: "%",
  sourceRefs: [{ label: "FDA GCP inspection analysis (ex-US, 7 years)" }],
  note: "NAI 38.6%, VAI 56.6% — comparable to global norms.",
});

// ── Competitive saturation anchors (trials per million inhabitants) ──────────────

export const TRIALS_PER_MILLION_BR = registry("const.trials_per_million_br", 54, Confidence.MEDIUM, {
  unit: "trials/million",
  asOf: "2026",
  sourceRefs: [{ label: "ClinicalTrials.gov Jul/2026 ÷ IBGE population" }],
  note: 'CT.gov counts ">=1 site per country", which overstates unique-trial share — declared metric.',
});
export const TRIALS_PER_MILLION_US = registry("const.trials_per_million_us", 566, Confidence.MEDIUM, {
  unit: "trials/million",
  asOf: "2026",
  sourceRefs: [{ label: "ClinicalTrials.gov ÷ population" }],
});
export const TRIALS_PER_MILLION_UK = registry("const.trials_per_million_uk", 420, Confidence.MEDIUM, {
  unit: "trials/million",
  asOf: "2026",
  sourceRefs: [{ label: "ClinicalTrials.gov ÷ population" }],
});
export const TRIALS_PER_MILLION_DE = registry("const.trials_per_million_de", 337, Confidence.MEDIUM, {
  unit: "trials/million",
  asOf: "2026",
  sourceRefs: [{ label: "ClinicalTrials.gov ÷ population" }],
});

// ── Physician density (Demografia Médica no Brasil 2023) ─────────────────────────

export const MD_DENSITY_BR = peerReviewed("const.md_density_br", 2.69, Confidence.HIGH, {
  unit: "per_1000",
  asOf: "2023",
  sourceRefs: [{ label: "Demografia Médica no Brasil 2023 (AMB/FMUSP)" }],
  note: "Concentrated SE/DF (DF 5.53, RJ 3.77, SP 3.50) vs. N/NE (PA 1.18, MA 1.22).",
});

// ── Eligibility upside (the softening thesis) ────────────────────────────────────

/** Widening 3 NSCLC eligibility criteria roughly DOUBLES the eligible pool. */
export const NSCLC_SOFTEN_POOL_MULTIPLIER = peerReviewed("const.nsclc_soften_multiplier", 2.0, Confidence.MEDIUM, {
  unit: "x",
  sourceRefs: [
    { label: "ASCO–Friends of Cancer Research; Liu et al., Nature 2021", url: "https://pubmed.ncbi.nlm.nih.gov/" },
  ],
  note: "≈ doubles the eligible population — the canonical softening result the simulator must reproduce.",
});

/**
 * Adult cancer patients participating in trials — from NCODA, an advocacy/vendor
 * source, so sealed VENDOR (not peer-reviewed) despite wide quotation.
 */
export const CANCER_TRIAL_PARTICIPATION = vendor("const.cancer_trial_participation", 5, Confidence.LOW, {
  unit: "%",
  sourceRefs: [{ label: "NCODA (advocacy)" }],
  note: "<5%; widely quoted but not primary-sourced.",
});

/** All constants, for the auditor view and a completeness test. */
export const ALL_CONSTANTS: Metric[] = [
  ZERO_ENROLLERS_GLOBAL,
  ZERO_ENROLLERS_LATAM,
  SITES_MISS_TARGET,
  STUDIES_ENROLL_ON_TIME,
  PATIENT_DROPOUT,
  STARTUP_CENTRAL_IRB_DAYS,
  STARTUP_LOCAL_IRB_DAYS,
  BR_CEP_ETHICS_DAYS,
  BR_ANVISA_DAYS,
  BR_SUS_STRATEGIC_DAYS,
  BR_ANVISA_HISTORIC_DAYS,
  COST_LATAM_PCT_OF_NA,
  COST_ONC_SAVING_VENDOR,
  COST_PER_PATIENT_US,
  BR_IMP_IMPORT_COST,
  BR_TRIAL_INSURANCE_COST,
  BR_TRANSLATION_COST,
  AMENDMENT_COST_PH2,
  AMENDMENT_COST_PH3,
  FDA_GCP_OAI_RATE,
  TRIALS_PER_MILLION_BR,
  TRIALS_PER_MILLION_US,
  TRIALS_PER_MILLION_UK,
  TRIALS_PER_MILLION_DE,
  MD_DENSITY_BR,
  NSCLC_SOFTEN_POOL_MULTIPLIER,
  CANCER_TRIAL_PARTICIPATION,
];

/** Total Brazil-specific per-patient cost add the cost model subtracts from the saving. */
export function brazilCostAddsUsd(): number {
  return (
    (BR_IMP_IMPORT_COST.value as number) +
    (BR_TRIAL_INSURANCE_COST.value as number) +
    (BR_TRANSLATION_COST.value as number)
  );
}

/** Guard used by the constants test: no vendor figure may masquerade as peer-reviewed. */
export function vendorConstantsAreNotPeerReviewed(): boolean {
  const vendorKeys = new Set(["const.cost_onc_saving_vendor", "const.cancer_trial_participation", "const.br_anvisa_historic_days"]);
  return ALL_CONSTANTS.filter((m) => vendorKeys.has(m.key)).every(
    (m) => m.provenance !== Provenance.PEER_REVIEWED,
  );
}
