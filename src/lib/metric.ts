/**
 * The `Metric` value object — the credibility discipline made a type.
 *
 * Engineering spec §2.4 rule 2 + §4.4: *every* quantitative fact surfaced to a
 * sponsor is a `Metric`, never a bare number. A Metric carries not just a value
 * but where it came from (`provenance`), how firm it is (`confidence`), when it
 * was true (`asOf`), and a citation trail (`sourceRefs`). This is the type-level
 * mirror of the product spec's editorial rule: a sponsor trusts a scorecard only
 * when measured fact is visibly separated from marketing estimate.
 *
 * Two provenance vocabularies exist in this system, at different layers, and must
 * not be confused (see docs/reconciliation-plan.md):
 *   - The Python estimator's `observed | imputed` — is this number a real patient
 *     fact or a model estimate? (a fact about DATA ORIGIN).
 *   - This module's 5 seals — how CREDIBLE is the source of a displayed metric?
 *     When the report consumes estimator output, `observed` maps to
 *     `registry_gov`/`site_declared` and `imputed` maps to `modeled` (carrying the
 *     estimator's CI + model_version through `ci`/`note`/`sourceRefs`).
 *
 * Everything here is pure and deterministic — no clock, no I/O. `asOf` is an
 * injected ISO string, never `new Date()`, so a report is reproducible from its
 * inputs (the repo-wide timestamp-free rule).
 */

/**
 * Source-credibility seal (engineering spec Appendix B). Ordered strongest →
 * most directional; `SEAL_RANK` encodes that order for sorting/aggregation.
 */
export enum Provenance {
  /** Peer-reviewed literature — strongest. */
  PEER_REVIEWED = "peer_reviewed",
  /** Official registry / government data (CT.gov, IBGE, CNES, INCA, ANVISA…). */
  REGISTRY_GOV = "registry_gov",
  /** Declared by the site itself — the marketplace-unique asset. */
  SITE_DECLARED = "site_declared",
  /** Computed by TrialBridge (funnel, scores, estimates). */
  MODELED = "modeled",
  /** Vendor / CRO benchmark — directional, never dressed up as peer-reviewed. */
  VENDOR = "vendor_benchmark",
}

/** How firm the number is, independent of its source's credibility. */
export enum Confidence {
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
}

/**
 * Appendix B: seal → UI treatment. Shared with the frontend MetricChip / sealed pill.
 * Colours are the TrialBridge Design System's *muted* provenance palette (warm-paper
 * calm, not saturated), exposed as CSS custom properties so the seals track light/dark
 * theme; `color`/`subtle` also carry raw hex fallbacks for print + non-token contexts.
 * `glyph` encodes confidence class visually on the seal (● firm · ◐ directional · ○ soft).
 */
export const SEAL_UI: Record<
  Provenance,
  { color: string; colorHex: string; subtle: string; label: string }
> = {
  [Provenance.PEER_REVIEWED]: {
    color: "var(--tb-prov-peer, #5E7350)",
    colorHex: "#5E7350",
    subtle: "var(--tb-prov-peer-subtle, #E8EDDF)",
    label: "Peer-reviewed",
  },
  [Provenance.REGISTRY_GOV]: {
    color: "var(--tb-prov-registry, #4C6E91)",
    colorHex: "#4C6E91",
    subtle: "var(--tb-prov-registry-subtle, #E1E9F0)",
    label: "Registry / gov",
  },
  [Provenance.SITE_DECLARED]: {
    color: "var(--tb-prov-declared, #7C5E99)",
    colorHex: "#7C5E99",
    subtle: "var(--tb-prov-declared-subtle, #ECE4F2)",
    label: "Site-declared",
  },
  [Provenance.MODELED]: {
    color: "var(--tb-prov-modeled, #B58019)",
    colorHex: "#B58019",
    subtle: "var(--tb-prov-modeled-subtle, #F6ECD4)",
    label: "Modeled",
  },
  [Provenance.VENDOR]: {
    color: "var(--tb-prov-vendor, #6E6D66)",
    colorHex: "#6E6D66",
    subtle: "var(--tb-prov-vendor-subtle, #F0EEE6)",
    label: "Vendor benchmark",
  },
};

/** Confidence → seal glyph (design system): filled = firm, half = directional, hollow = soft. */
export const CONFIDENCE_GLYPH: Record<Confidence, string> = {
  [Confidence.HIGH]: "●",
  [Confidence.MEDIUM]: "◐",
  [Confidence.LOW]: "○",
};

/** Strength order for sorting a provenance index (0 = strongest). */
export const SEAL_RANK: Record<Provenance, number> = {
  [Provenance.PEER_REVIEWED]: 0,
  [Provenance.REGISTRY_GOV]: 1,
  [Provenance.SITE_DECLARED]: 2,
  [Provenance.MODELED]: 3,
  [Provenance.VENDOR]: 4,
};

/** A single citation backing a metric. */
export interface SourceRef {
  /** Human label, e.g. "Tufts CSDD / Getz, Applied Clinical Trials". */
  label: string;
  url?: string | null;
  /** Dataset date / release tag / etag of the underlying source. */
  sourceVersion?: string | null;
}

/**
 * The value object. `value` is nullable so a hard-down source degrades to
 * `value: null` + `Confidence.LOW` rather than a silently-fabricated zero
 * (engineering spec §7.11 — never zero a missing metric).
 */
export interface Metric<V extends number | string | null = number | string | null> {
  /** Stable id, e.g. "site.predicted_enrollment_rate". */
  key: string;
  value: V;
  /** "patients/month", "usd", "days", "%", "ratio", … */
  unit?: string | null;
  provenance: Provenance;
  confidence: Confidence;
  /** ISO-8601 date the value was true; injected, never read from the clock. */
  asOf?: string | null;
  sourceRefs?: SourceRef[];
  /** Optional [low, high] interval — carries the estimator's Wilson/transportability band. */
  ci?: [number, number] | null;
  note?: string | null;
}

/** Options bag for the `metric()` constructor (everything past value is optional). */
export interface MetricOptions {
  unit?: string | null;
  asOf?: string | null;
  sourceRefs?: SourceRef[];
  ci?: [number, number] | null;
  note?: string | null;
}

/**
 * Canonical constructor. Prefer this (or the seal-specific helpers below) over
 * building a Metric literal, so the mandatory fields are never forgotten.
 */
export function metric<V extends number | string | null>(
  key: string,
  value: V,
  provenance: Provenance,
  confidence: Confidence,
  opts: MetricOptions = {},
): Metric<V> {
  return {
    key,
    value,
    provenance,
    confidence,
    unit: opts.unit ?? null,
    asOf: opts.asOf ?? null,
    sourceRefs: opts.sourceRefs ?? [],
    ci: opts.ci ?? null,
    note: opts.note ?? null,
  };
}

/** A TrialBridge-computed number (funnel, score, estimate). Defaults to MEDIUM confidence. */
export function modeled<V extends number | string | null>(
  key: string,
  value: V,
  confidence: Confidence = Confidence.MEDIUM,
  opts: MetricOptions = {},
): Metric<V> {
  return metric(key, value, Provenance.MODELED, confidence, opts);
}

/** An official registry/government fact. Defaults to HIGH confidence. */
export function registry<V extends number | string | null>(
  key: string,
  value: V,
  confidence: Confidence = Confidence.HIGH,
  opts: MetricOptions = {},
): Metric<V> {
  return metric(key, value, Provenance.REGISTRY_GOV, confidence, opts);
}

/** A peer-reviewed constant. Defaults to HIGH confidence. */
export function peerReviewed<V extends number | string | null>(
  key: string,
  value: V,
  confidence: Confidence = Confidence.HIGH,
  opts: MetricOptions = {},
): Metric<V> {
  return metric(key, value, Provenance.PEER_REVIEWED, confidence, opts);
}

/** A site-declared value (the marketplace-unique data). Defaults to MEDIUM. */
export function siteDeclared<V extends number | string | null>(
  key: string,
  value: V,
  confidence: Confidence = Confidence.MEDIUM,
  opts: MetricOptions = {},
): Metric<V> {
  return metric(key, value, Provenance.SITE_DECLARED, confidence, opts);
}

/** A vendor/CRO benchmark — directional. Defaults to LOW confidence. */
export function vendor<V extends number | string | null>(
  key: string,
  value: V,
  confidence: Confidence = Confidence.LOW,
  opts: MetricOptions = {},
): Metric<V> {
  return metric(key, value, Provenance.VENDOR, confidence, opts);
}

/** A metric whose source was unavailable at run time: null value, LOW confidence, note preserved (§7.11). */
export function unavailable(
  key: string,
  provenance: Provenance,
  note: string,
  opts: Omit<MetricOptions, "note"> = {},
): Metric<null> {
  return metric(key, null, provenance, Confidence.LOW, { ...opts, note });
}

/**
 * Structural type-guard: is `x` a well-formed Metric carrying BOTH provenance and
 * confidence? This is the predicate the report assembler's provenance gate runs
 * over every surfaced value (engineering spec §8, §14.4).
 */
export function isMetric(x: unknown): x is Metric {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Record<string, unknown>;
  return (
    typeof m.key === "string" &&
    "value" in m &&
    typeof m.provenance === "string" &&
    (Object.values(Provenance) as string[]).includes(m.provenance) &&
    typeof m.confidence === "string" &&
    (Object.values(Confidence) as string[]).includes(m.confidence)
  );
}

/** Confidence weakest → strongest, for roll-ups and tie-breaks (LOW < MEDIUM < HIGH). */
export const CONFIDENCE_RANK: Record<Confidence, number> = {
  [Confidence.LOW]: 0,
  [Confidence.MEDIUM]: 1,
  [Confidence.HIGH]: 2,
};

/** Roll several confidences up to the WEAKEST present (a chain is only as firm as its weakest link). */
export function rollUpConfidence(confidences: Confidence[]): Confidence {
  if (confidences.length === 0) return Confidence.LOW;
  return confidences.reduce((weakest, c) =>
    CONFIDENCE_RANK[c] < CONFIDENCE_RANK[weakest] ? c : weakest,
  );
}

/** Thrown by `assertProvenanced` when a surfaced value lacks provenance/confidence. */
export class ProvenanceGateError extends Error {
  constructor(public readonly path: string, public readonly offending: unknown) {
    super(
      `Provenance gate: value at "${path}" is surfaced to the sponsor without provenance+confidence. ` +
        `Wrap it in a Metric (see src/lib/metric.ts). Got: ${JSON.stringify(offending)?.slice(0, 120)}`,
    );
    this.name = "ProvenanceGateError";
  }
}

/**
 * The provenance gate (engineering spec §8 "validation gate", §14.4 credibility test).
 * Walks an assembled report structure and throws `ProvenanceGateError` on the first
 * value that lives in a metric slot but is not a well-formed `Metric`.
 *
 * A "metric slot" is identified structurally: any object node whose key is (or ends
 * with) `metric`/`Metric`, or any element of an array whose key is (or ends with)
 * `metrics`/`Metrics`, must be a `Metric`. This lets the assembler keep plain
 * structural fields (labels, ids, geometry) as bare values while guaranteeing every
 * number a sponsor reads is provenanced. Returns the count of validated metrics.
 */
export function assertProvenanced(node: unknown, path = "$"): number {
  let validated = 0;

  const isMetricSlotKey = (key: string) => /metric$/i.test(key);
  const isMetricArrayKey = (key: string) => /metrics$/i.test(key);

  const walk = (value: unknown, p: string, inMetricSlot: boolean): void => {
    if (inMetricSlot) {
      // An optional metric slot may be intentionally absent (null/undefined) — that
      // renders as "—", not as a mis-labelled number, so it passes the gate. What the
      // gate forbids is a BARE value (number/string/plain object) in a metric slot.
      if (value == null) return;
      if (!isMetric(value)) throw new ProvenanceGateError(p, value);
      validated += 1;
      return; // a Metric's own internals aren't re-walked
    }
    if (Array.isArray(value)) {
      value.forEach((el, i) => walk(el, `${p}[${i}]`, false));
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const childPath = `${p}.${k}`;
        if (isMetricSlotKey(k)) {
          walk(v, childPath, true);
        } else if (isMetricArrayKey(k) && Array.isArray(v)) {
          v.forEach((el, i) => walk(el, `${childPath}[${i}]`, true));
        } else {
          walk(v, childPath, false);
        }
      }
    }
  };

  walk(node, path, false);
  return validated;
}

/**
 * Provenance index (engineering spec §8): count every Metric in a structure by
 * seal, so the Risk Register can render "X peer-reviewed, Y site-declared, Z modeled".
 * Collects Metrics wherever they appear (does not require the strict slot naming).
 */
export interface ProvenanceIndex {
  total: number;
  bySeal: Record<Provenance, number>;
  byConfidence: Record<Confidence, number>;
}

export function buildProvenanceIndex(node: unknown): ProvenanceIndex {
  const bySeal: Record<Provenance, number> = {
    [Provenance.PEER_REVIEWED]: 0,
    [Provenance.REGISTRY_GOV]: 0,
    [Provenance.SITE_DECLARED]: 0,
    [Provenance.MODELED]: 0,
    [Provenance.VENDOR]: 0,
  };
  const byConfidence: Record<Confidence, number> = {
    [Confidence.HIGH]: 0,
    [Confidence.MEDIUM]: 0,
    [Confidence.LOW]: 0,
  };
  let total = 0;
  // Count each Metric ONCE by object identity. The report graph deliberately shares
  // Metric references (e.g. the decision snapshot re-points at the country composite
  // and the top sites' scores), so a positional walk would double-count them and
  // inflate the "mix" shown to the sponsor.
  const seen = new Set<object>();

  const walk = (value: unknown): void => {
    if (isMetric(value)) {
      if (seen.has(value)) return;
      seen.add(value);
      total += 1;
      bySeal[value.provenance] += 1;
      byConfidence[value.confidence] += 1;
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === "object") {
      if (seen.has(value)) return; // guard against shared/cyclic non-metric nodes too
      seen.add(value);
      Object.values(value as Record<string, unknown>).forEach(walk);
    }
  };

  walk(node);
  return { total, bySeal, byConfidence };
}
