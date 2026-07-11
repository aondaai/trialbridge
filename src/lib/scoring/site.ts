/**
 * Site scorecard (engineering spec §6.4–6.7, scorecard §6).
 *
 * Nine components, normalized, weighted, and combined — then guard-rails demote a
 * site with a showstopper. Half the components come from public data + the funnel;
 * half from the site's own capacity declaration (the TrialBridge-unique asset), so
 * the confidence roll-up reflects how firm each site's number really is. Pure.
 */

import { Confidence, Metric, modeled, rollUpConfidence } from "@/lib/metric";
import {
  normAbsolute,
  normChecklist,
  clampScore,
  Anchor,
} from "@/lib/scoring/normalize";
import {
  SiteWeights,
  SiteComponent,
  resolveSiteWeights,
  TrialProfile,
} from "@/lib/scoring/weights";
import { ComponentScore, SiteScore } from "@/lib/scoring/types";
import { detectHardFlags, applyDemotion, GuardrailContext } from "@/lib/scoring/guardrails";

/** Typed, already-resolved signals for one site. */
export interface SiteInput {
  cnes: string;
  name: string;
  city: string;
  uf: string;
  profile: TrialProfile;

  // S1 eligible pool
  eligiblePool: number; // modeled site funnel output
  declaredPool?: number | null; // site-declared, if provided
  poolVerifiablePublicly: boolean;

  // S2 predicted enrollment
  projectedPatientsPerMonth: number;
  declaredCommitmentPerMonth?: number | null;

  // S3 enrollment history
  priorTrials: number;
  historicalEnrollmentRate?: number | null; // patients/month historically
  zeroEnroller: boolean;
  hasPIHistory: boolean;

  // S4 competition
  competingTrialsInCatchment: number;

  // S5 infrastructure fit
  requiredEquipment: number;
  presentEquipment: number;

  // S6 KOL strength (from the KOL service; default modeled midpoint if absent)
  kolScore0100?: number | null;

  // S7 startup / FPI
  projectedFpiDays: number;

  // S8 data quality
  inspectionOk: boolean;
  declaredQueryRate?: number | null; // queries per CRF, lower is better

  // S9 staff capacity
  crcCount?: number | null;
  crcExperienceYears?: number | null;
  emrEsource: boolean;

  // declaration / confidence
  hasDeclaration: boolean;
  hasDigitalSfq: boolean;

  // guardrail context
  minInfraFit: number; // 0..100
  cepAccreditedForRisk: boolean;
  impLeadTimeDays: number;
  daysToFpiBudget: number;

  // headline trio (surfaced when known)
  screenFailRate?: number | null;
  retentionRate?: number | null;
}

const POOL_ANCHORS: Anchor[] = [
  [0, 0],
  [50, 50],
  [200, 82],
  [500, 100],
];
const PPM_ANCHORS: Anchor[] = [
  [0, 0],
  [1, 40],
  [2, 62],
  [4, 85],
  [6, 100],
];
const HISTORY_RATE_ANCHORS: Anchor[] = [
  [0, 10],
  [0.5, 45],
  [1.5, 75],
  [3, 100],
];
const COMPETITION_ANCHORS: Anchor[] = [
  [0, 100],
  [3, 70],
  [8, 45],
  [15, 15],
];
const FPI_ANCHORS: Anchor[] = [
  [60, 100],
  [120, 75],
  [180, 50],
  [300, 15],
];
const QUERY_RATE_ANCHORS: Anchor[] = [
  [0.1, 100],
  [0.5, 75],
  [1, 50],
  [2, 20],
];

function comp(
  key: SiteComponent,
  score: number,
  weight: number,
  metrics: Metric[],
): ComponentScore {
  const score0100 = clampScore(score);
  return {
    key,
    score0100,
    weight,
    scoreMetric: modeled(`site.${key}.score`, Math.round(score0100), Confidence.MEDIUM, {
      unit: "score_0_100",
    }),
    metrics,
    narrativeKey: `site.${key}.narrative`,
  };
}

/** Score a single site. */
export function scoreSite(input: SiteInput, weights?: SiteWeights): SiteScore {
  const w = weights ?? resolveSiteWeights(input.profile);

  // S1 eligible pool: modeled pool, cross-checked with declared (small agreement bump).
  const poolBase = normAbsolute(input.eligiblePool, POOL_ANCHORS);
  const crossCheckBump =
    input.declaredPool != null && input.eligiblePool > 0
      ? agreementBump(input.eligiblePool, input.declaredPool)
      : 0;
  const s1Metrics: Metric[] = [
    modeled("site.eligible_pool.modeled", Math.round(input.eligiblePool), Confidence.MEDIUM, { unit: "patients" }),
  ];
  if (input.declaredPool != null) {
    s1Metrics.push(
      modeled("site.eligible_pool.declared", input.declaredPool, Confidence.MEDIUM, {
        unit: "patients",
        note: "Site-declared pool (cross-checked against the modeled funnel).",
      }),
    );
  }
  const s1 = comp("eligible_pool", poolBase + crossCheckBump, w.eligible_pool, s1Metrics);

  // S2 predicted enrollment: projected ppm, capped by the site's own commitment.
  const cappedPpm =
    input.declaredCommitmentPerMonth != null
      ? Math.min(input.projectedPatientsPerMonth, input.declaredCommitmentPerMonth)
      : input.projectedPatientsPerMonth;
  const s2 = comp("predicted_enrollment", normAbsolute(cappedPpm, PPM_ANCHORS), w.predicted_enrollment, [
    modeled("site.predicted_enrollment_rate", round1(cappedPpm), Confidence.MEDIUM, { unit: "patients/month" }),
  ]);

  // S3 enrollment history: zero-enroller floors it; else historical rate (fallback: prior-trial count).
  const historyScore = input.zeroEnroller
    ? 5
    : input.historicalEnrollmentRate != null
      ? normAbsolute(input.historicalEnrollmentRate, HISTORY_RATE_ANCHORS)
      : normAbsolute(Math.min(input.priorTrials, 6), [
          [0, 20],
          [2, 55],
          [6, 90],
        ]);
  const s3 = comp("enrollment_history", historyScore, w.enrollment_history, [
    modeled("site.enrollment_history.prior_trials", input.priorTrials, Confidence.MEDIUM, { unit: "trials" }),
  ]);

  // S4 competition in catchment: fewer competing trials = higher.
  const s4 = comp("competition", normAbsolute(input.competingTrialsInCatchment, COMPETITION_ANCHORS), w.competition, [
    modeled("site.competition.trials_in_catchment", input.competingTrialsInCatchment, Confidence.MEDIUM, { unit: "trials" }),
  ]);

  // S5 infrastructure fit: checklist of protocol requirements ∩ CNES infra.
  const infraFitPct = normChecklist(input.presentEquipment, input.requiredEquipment);
  const s5 = comp("infrastructure_fit", infraFitPct, w.infrastructure_fit, [
    modeled("site.infrastructure_fit.pct", Math.round(infraFitPct), Confidence.HIGH, {
      unit: "%",
      note: `${input.presentEquipment}/${input.requiredEquipment} required items present (CNES).`,
    }),
  ]);

  // S6 KOL strength: from the KOL service, or a modeled midpoint if not yet computed.
  const kol = input.kolScore0100 ?? 55;
  const s6 = comp("kol_strength", kol, w.kol_strength, [
    modeled("site.kol_strength.score", Math.round(kol), input.kolScore0100 == null ? Confidence.LOW : Confidence.MEDIUM, {
      unit: "score_0_100",
      note: input.kolScore0100 == null ? "Placeholder midpoint; KOL service not yet run for this site." : null,
    }),
  ]);

  // S7 startup / FPI.
  const s7 = comp("startup_fpi", normAbsolute(input.projectedFpiDays, FPI_ANCHORS), w.startup_fpi, [
    modeled("site.startup_fpi.days", input.projectedFpiDays, Confidence.MEDIUM, { unit: "days" }),
  ]);

  // S8 data quality: inspection history + declared query rate.
  const dqBase = input.inspectionOk ? 85 : 40;
  const dqScore =
    input.declaredQueryRate != null ? (dqBase + normAbsolute(input.declaredQueryRate, QUERY_RATE_ANCHORS)) / 2 : dqBase;
  const s8 = comp("data_quality", dqScore, w.data_quality, [
    modeled("site.data_quality.inspection_ok", input.inspectionOk ? 1 : 0, Confidence.MEDIUM),
  ]);

  // S9 staff capacity: declared CRC bench + EMR/e-source.
  const staffScore = staffCapacityScore(input);
  const s9 = comp("staff_capacity", staffScore, w.staff_capacity, [
    modeled("site.staff_capacity.crc_count", input.crcCount ?? 0, input.hasDeclaration ? Confidence.MEDIUM : Confidence.LOW, {
      unit: "crcs",
    }),
  ]);

  const components = [s1, s2, s3, s4, s5, s6, s7, s8, s9];
  const rawComposite = clampScore(components.reduce((s, c) => s + c.score0100 * c.weight, 0));

  // Guard-rails.
  const guardCtx: GuardrailContext = {
    zeroEnroller: input.zeroEnroller,
    infraFitPct,
    minInfraFit: input.minInfraFit,
    cepAccreditedForRisk: input.cepAccreditedForRisk,
    impLeadTimeDays: input.impLeadTimeDays,
    daysToFpiBudget: input.daysToFpiBudget,
  };
  const hardFlags = detectHardFlags(guardCtx);
  const composite = applyDemotion(rawComposite, hardFlags);

  // Confidence roll-up (§6.6): declared+SFQ, PI history, publicly-verifiable pool.
  const confidence = siteConfidence(input);

  const radar = Object.fromEntries(components.map((c) => [c.key, c.score0100])) as Record<SiteComponent, number>;

  return {
    cnes: input.cnes,
    name: input.name,
    city: input.city,
    uf: input.uf,
    profile: input.profile,
    components,
    composite: Math.round(composite * 10) / 10,
    compositeMetric: modeled("site.composite", Math.round(composite * 10) / 10, confidence, { unit: "score_0_100" }),
    headlineMetrics: {
      enrollmentRateMetric: modeled("site.headline.enrollment_rate", round1(cappedPpm), confidence, {
        unit: "patients/month",
      }),
      screenFailMetric:
        input.screenFailRate != null
          ? modeled("site.headline.screen_fail", input.screenFailRate, Confidence.MEDIUM, { unit: "%" })
          : modeled("site.headline.screen_fail", null, Confidence.LOW, { unit: "%", note: "Not declared." }),
      retentionMetric:
        input.retentionRate != null
          ? modeled("site.headline.retention", input.retentionRate, Confidence.MEDIUM, { unit: "%" })
          : modeled("site.headline.retention", null, Confidence.LOW, { unit: "%", note: "Not declared." }),
    },
    confidence,
    hardFlags,
    radar,
  };
}

/** Confidence roll-up: 3 signals present → HIGH, 2 → MEDIUM, ≤1 → LOW (§6.6). */
export function siteConfidence(input: SiteInput): Confidence {
  const signals = [input.hasDeclaration && input.hasDigitalSfq, input.hasPIHistory, input.poolVerifiablePublicly];
  const present = signals.filter(Boolean).length;
  if (present >= 3) return Confidence.HIGH;
  if (present === 2) return Confidence.MEDIUM;
  return Confidence.LOW;
}

/**
 * Rank sites: composite desc, tie-broken by confidence (a low-confidence site never
 * out-ranks a high-confidence one at equal composite — §6.6).
 */
export function rankSites(sites: SiteScore[]): SiteScore[] {
  const confRank = { high: 2, medium: 1, low: 0 } as const;
  return [...sites].sort((a, b) => {
    if (b.composite !== a.composite) return b.composite - a.composite;
    return confRank[b.confidence] - confRank[a.confidence];
  });
}

function agreementBump(modeledPool: number, declaredPool: number): number {
  const ratio = Math.min(modeledPool, declaredPool) / Math.max(modeledPool, declaredPool);
  return ratio > 0.7 ? 5 : 0; // agree within 30% → small confidence bump
}

function staffCapacityScore(input: SiteInput): number {
  if (!input.hasDeclaration) return 30; // undeclared → conservative
  const crc = normAbsolute(input.crcCount ?? 0, [
    [0, 20],
    [2, 55],
    [4, 80],
    [8, 100],
  ]);
  const exp = normAbsolute(input.crcExperienceYears ?? 0, [
    [0, 20],
    [3, 60],
    [8, 100],
  ]);
  const emr = input.emrEsource ? 100 : 50;
  return clampScore(0.5 * crc + 0.3 * exp + 0.2 * emr);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
