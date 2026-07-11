/**
 * Shared scoring output types (engineering spec §6.3–6.7).
 *
 * A scorecard is a weighted mean of sub-scores, each of which must carry the
 * Metrics that produced it (so the UI can show provenance per line) plus a
 * narrative key for i18n copy. Country and site share this shape.
 */

import type { Metric, Confidence } from "@/lib/metric";
import type { CountryDimension, SiteComponent, TrialProfile } from "@/lib/scoring/weights";

/** A hard flag that overrides the composite (spec §6.7 / scorecard §10.3). */
export interface HardFlag {
  key: string;
  label: string;
  /** Severity: "demote" pushes the entity down the ranking; "block" makes it a no-go. */
  severity: "demote" | "block";
  detailMetric?: Metric | null;
}

/** One country dimension's contribution. */
export interface DimensionScore {
  key: CountryDimension;
  score0100: number;
  weight: number;
  /** The score itself, as a Metric (modeled). Named `scoreMetric` so the gate walks it. */
  scoreMetric: Metric;
  /** The cited inputs behind the score. Named `*Metrics` so the gate walks each. */
  contributingMetrics: Metric[];
  narrativeKey: string;
}

export type Recommendation = "go" | "conditional_go" | "no_go";

export interface CountryScorecard {
  country: string; // "BR"
  dimensions: DimensionScore[]; // 7
  composite: number;
  compositeMetric: Metric;
  recommendation: Recommendation;
  hardFlags: HardFlag[];
  asOf: string | null;
}

/** One site component's contribution. */
export interface ComponentScore {
  key: SiteComponent;
  score0100: number;
  weight: number;
  scoreMetric: Metric;
  metrics: Metric[];
  narrativeKey: string;
}

export interface SiteScore {
  cnes: string;
  name: string;
  city: string;
  uf: string;
  profile: TrialProfile;
  components: ComponentScore[]; // 9
  composite: number;
  compositeMetric: Metric;
  /** OneStudyTeam trio, surfaced when known. */
  headlineMetrics: {
    enrollmentRateMetric: Metric;
    screenFailMetric: Metric;
    retentionMetric: Metric;
  };
  confidence: Confidence;
  hardFlags: HardFlag[];
  /** 9 sub-scores for the UI radar. */
  radar: Record<SiteComponent, number>;
}
