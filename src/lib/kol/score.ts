/**
 * KOL / reference-physician scoring (engineering spec §10, product spec §8).
 *
 * Combines four cited signals — trial experience (CT.gov), scientific production
 * (PubMed/ORCID), society roles (SBOC etc.), and institutional link (CNES) — into a
 * 0..100 KOL score, and assembles the report's §7 map. Pure: investigator signals
 * come in as typed inputs; the actual PubMed/ORCID/CT.gov ingestion is a connector
 * (R9). Every score exposes its contributing metrics with provenance, and the
 * confidence roll-up reflects how many independent sources backed the investigator.
 */

import { Confidence, Metric, SourceRef, modeled, rollUpConfidence } from "@/lib/metric";
import { normAbsolute, clampScore, Anchor } from "@/lib/scoring/normalize";
import type { KolMapSummary } from "@/lib/report/types";

/** Signal weights (sum to 1.0). Trial experience leads; institutional link is the tie-breaker. */
export const KOL_SIGNAL_WEIGHTS = { trials: 0.35, pubs: 0.3, society: 0.2, institution: 0.15 };

/** Curated society-role points per therapeutic area (spec §8 / §10.2). */
export const SOCIETY_POINTS: Record<string, number> = {
  SBOC: 30, // Sociedade Brasileira de Oncologia Clínica
  SBCO: 25, // cirurgia oncológica
  SBRT: 20, // radioterapia
  SOBOPE: 20, // onco-pediatria
  SBC: 25, // cardiologia
};
const GUIDELINE_AUTHOR_BONUS = 40;

export interface KolSignals {
  trialsCount: number; // CT.gov trial experience
  pubsCountTa: number; // PubMed/ORCID publications in the therapeutic area
  societyRoles: string[]; // e.g. ["SBOC"]
  guidelineAuthor: boolean;
  hasCnesLink: boolean; // joined to a site via CNES
}

export interface KolInvestigatorInput {
  name: string;
  regionCode: string;
  cnes?: string | null;
  affiliation?: string | null;
  therapeuticArea?: string | null;
  signals: KolSignals;
  /** Citations backing the researched signals (Parallel enrichment), if any. */
  enrichmentCitations?: SourceRef[];
}

export interface KolScore {
  name: string;
  regionCode: string;
  cnes: string | null;
  composite0100: number;
  scoreMetric: Metric;
  signalMetrics: Metric[];
  confidence: Confidence;
}

const TRIALS_ANCHORS: Anchor[] = [
  [0, 0],
  [2, 50],
  [5, 80],
  [10, 100],
];
const PUBS_ANCHORS: Anchor[] = [
  [0, 0],
  [5, 45],
  [20, 80],
  [50, 100],
];

/** Society-role score (0..100): curated points per role + a guideline-author bonus. */
export function societyScore(roles: string[], guidelineAuthor: boolean): number {
  const rolePoints = roles.reduce((s, r) => s + (SOCIETY_POINTS[r] ?? 0), 0);
  return clampScore(rolePoints + (guidelineAuthor ? GUIDELINE_AUTHOR_BONUS : 0));
}

/** Score one investigator. */
export function kolScore(inv: KolInvestigatorInput): KolScore {
  const sig = inv.signals;
  const sTrials = normAbsolute(sig.trialsCount, TRIALS_ANCHORS);
  const sPubs = normAbsolute(sig.pubsCountTa, PUBS_ANCHORS);
  const sSociety = societyScore(sig.societyRoles, sig.guidelineAuthor);
  const sInstitution = sig.hasCnesLink ? 100 : 40;

  const composite = clampScore(
    KOL_SIGNAL_WEIGHTS.trials * sTrials +
      KOL_SIGNAL_WEIGHTS.pubs * sPubs +
      KOL_SIGNAL_WEIGHTS.society * sSociety +
      KOL_SIGNAL_WEIGHTS.institution * sInstitution,
  );

  // Confidence: how many independent sources actually backed this investigator?
  const sources = [
    sig.trialsCount > 0, // CT.gov
    sig.pubsCountTa > 0, // PubMed/ORCID
    sig.societyRoles.length > 0, // curated society roster
    sig.hasCnesLink, // CNES
  ].filter(Boolean).length;
  const confidence =
    sources >= 3 ? Confidence.HIGH : sources === 2 ? Confidence.MEDIUM : Confidence.LOW;

  const signalMetrics: Metric[] = [
    modeled("kol.signal.trials", sig.trialsCount, Confidence.MEDIUM, { unit: "trials", sourceRefs: [{ label: "ClinicalTrials.gov overallOfficials" }] }),
    modeled("kol.signal.pubs", sig.pubsCountTa, Confidence.MEDIUM, { unit: "publications", sourceRefs: [{ label: "PubMed E-utilities / ORCID" }] }),
    modeled("kol.signal.society", Math.round(sSociety), Confidence.MEDIUM, { unit: "score_0_100", note: sig.societyRoles.join(", ") || "no curated society role" }),
  ];

  return {
    name: inv.name,
    regionCode: inv.regionCode,
    cnes: inv.cnes ?? null,
    composite0100: Math.round(composite * 10) / 10,
    scoreMetric: modeled("kol.composite", Math.round(composite * 10) / 10, confidence, { unit: "score_0_100" }),
    signalMetrics,
    confidence,
  };
}

/** Rank investigators by KOL score (desc), tie-broken by confidence. */
export function rankKols(scores: KolScore[]): KolScore[] {
  const confRank = { high: 2, medium: 1, low: 0 } as const;
  return [...scores].sort((a, b) =>
    b.composite0100 !== a.composite0100
      ? b.composite0100 - a.composite0100
      : confRank[b.confidence] - confRank[a.confidence],
  );
}

/** Per-region KOL density (count + mean score) — feeds the heatmap + tri-density. */
export interface RegionKolDensity {
  regionCode: string;
  count: number;
  meanScoreMetric: Metric;
}
export function regionKolDensity(scores: KolScore[]): RegionKolDensity[] {
  const byRegion = new Map<string, KolScore[]>();
  for (const s of scores) {
    (byRegion.get(s.regionCode) ?? byRegion.set(s.regionCode, []).get(s.regionCode)!).push(s);
  }
  return Array.from(byRegion.entries()).map(([regionCode, list]) => {
    const mean = list.reduce((sum, s) => sum + s.composite0100, 0) / list.length;
    return {
      regionCode,
      count: list.length,
      meanScoreMetric: modeled("kol.region.mean_score", Math.round(mean * 10) / 10, rollUpConfidence(list.map((s) => s.confidence)), {
        unit: "score_0_100",
      }),
    };
  });
}

/**
 * Tri-density sweet-spots (spec §10.3): regions with a strong KOL AND a high
 * supply/demand ratio (many patients, few trials). `ratioByRegion` comes from the
 * supply/demand engine. Returns region codes flagged as opportunities, best first.
 */
export function sweetSpotRegions(
  density: RegionKolDensity[],
  ratioByRegion: Record<string, number>,
  opts: { minKolScore?: number; minRatio?: number } = {},
): string[] {
  const minKol = opts.minKolScore ?? 60;
  const minRatio = opts.minRatio ?? 50;
  return density
    .filter((d) => (d.meanScoreMetric.value as number) >= minKol && (ratioByRegion[d.regionCode] ?? 0) >= minRatio)
    .sort((a, b) => (ratioByRegion[b.regionCode] ?? 0) - (ratioByRegion[a.regionCode] ?? 0))
    .map((d) => d.regionCode);
}

/** Assemble the report's §7 KOL map from scored investigators. */
export function buildKolMap(investigators: KolInvestigatorInput[]): KolMapSummary {
  const byName = new Map(investigators.map((i) => [i.name, i]));
  const scores = rankKols(investigators.map(kolScore));
  return {
    physicians: scores.map((s) => {
      const inv = byName.get(s.name);
      return {
        name: s.name,
        regionCode: s.regionCode,
        affiliation: inv?.affiliation ?? null,
        pubsCountTa: inv?.signals.pubsCountTa,
        societyRoles: inv?.signals.societyRoles,
        citations: inv?.enrichmentCitations,
        scoreMetric: s.scoreMetric,
      };
    }),
  };
}
