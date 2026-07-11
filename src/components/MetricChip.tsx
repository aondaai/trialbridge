/**
 * MetricChip — the UI mirror of the type-level provenance rule (eng spec §13.2).
 *
 * EVERY number a sponsor sees goes through this component, so every number carries
 * a provenance colour + a confidence dot + a source tooltip. It is a server
 * component (no client JS): the tooltip is a native `title`, so it works in print
 * and without hydration.
 */

import type { Metric } from "@/lib/metric";
import { SEAL_UI, Confidence, CONFIDENCE_GLYPH } from "@/lib/metric";

const CONFIDENCE_DOT: Record<Confidence, string> = {
  [Confidence.HIGH]: "var(--cl-success)",
  [Confidence.MEDIUM]: "var(--cl-warning)",
  [Confidence.LOW]: "var(--cl-text-muted)",
};

/** Units where the value string already encodes the unit → no separate suffix. */
const SELF_UNITS = new Set(["usd", "%", "patients/month", "score_0_100", "index_0_100"]);

function formatValue(m: Metric): string {
  if (m.value == null) return "—";
  if (typeof m.value === "string") return m.value;
  const n = m.value;
  const unit = m.unit ?? "";
  if (unit === "usd") return `$${Math.round(n).toLocaleString("en-US")}`;
  if (unit === "%") return `${round(n)}%`;
  if (unit === "score_0_100" || unit === "index_0_100") return `${round(n)}`;
  if (unit === "patients/month") return `${round(n)}/mo`;
  return `${round(n)}`; // plain unit is appended separately by unitSuffix
}

/** Prettified unit suffix for plain units (never for self-encoding units). */
function unitSuffixFor(m: Metric): string {
  if (m.value == null || typeof m.value === "string") return "";
  const unit = m.unit;
  if (!unit || SELF_UNITS.has(unit)) return "";
  return ` ${unit.replace(/_/g, " ")}`;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function tooltip(m: Metric): string {
  const seal = SEAL_UI[m.provenance].label;
  const parts = [`${seal} · ${m.confidence} confidence`];
  if (m.ci) parts.push(`95% CI [${round(m.ci[0])}, ${round(m.ci[1])}]`);
  if (m.asOf) parts.push(`as of ${m.asOf}`);
  const refs = (m.sourceRefs ?? []).map((r) => r.label).filter(Boolean);
  if (refs.length) parts.push(`Source: ${refs.join("; ")}`);
  if (m.note) parts.push(m.note);
  return parts.join("\n");
}

export function MetricChip({
  metric,
  strong = false,
  showUnit = true,
}: {
  metric: Metric;
  strong?: boolean;
  showUnit?: boolean;
}) {
  const seal = SEAL_UI[metric.provenance];
  const value = formatValue(metric);
  const unitSuffix = showUnit ? unitSuffixFor(metric) : "";
  return (
    <span
      className="metric-chip"
      title={tooltip(metric)}
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 5,
        whiteSpace: "nowrap",
        fontWeight: strong ? 600 : 400,
      }}
    >
      <span
        aria-hidden
        title={seal.label}
        style={{
          alignSelf: "center",
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: seal.color,
          flex: "0 0 auto",
        }}
      />
      <span>
        {value}
        {metric.value != null ? unitSuffix : ""}
      </span>
      <span
        aria-hidden
        style={{
          alignSelf: "center",
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: CONFIDENCE_DOT[metric.confidence],
          flex: "0 0 auto",
          opacity: 0.9,
        }}
      />
    </span>
  );
}

/**
 * SealPill — the design-system evidence seal: a subtle-tinted rounded pill carrying
 * an optional mono value, the seal label, and the confidence glyph (● ◐ ○). This is
 * the signature "every number shows its basis" treatment for headline + evidence
 * metrics; dense tables use plain tabular numbers instead.
 */
export function SealPill({
  metric,
  showValue = true,
}: {
  metric: Metric;
  showValue?: boolean;
}) {
  const seal = SEAL_UI[metric.provenance];
  const hasValue = showValue && metric.value != null;
  return (
    <span
      title={tooltip(metric)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1,
        padding: "3px 8px",
        borderRadius: 999,
        background: seal.subtle,
        color: seal.color,
        whiteSpace: "nowrap",
      }}
    >
      {hasValue && (
        <span style={{ fontFamily: "var(--cl-font-mono)", fontWeight: 600 }}>
          {formatValue(metric)}
          {unitSuffixFor(metric)}
        </span>
      )}
      <span>{seal.label}</span>
      <span aria-hidden style={{ fontSize: 8 }}>
        {CONFIDENCE_GLYPH[metric.confidence]}
      </span>
    </span>
  );
}

/** The provenance legend — maps each seal colour to its meaning (Appendix B). */
export function ProvenanceLegend() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, marginTop: 8 }} className="muted">
      {Object.values(SEAL_UI).map((s) => (
        <span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color, display: "inline-block" }} />
          {s.label}
        </span>
      ))}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--cl-text-muted)", display: "inline-block" }} />
        confidence: high / medium / low
      </span>
    </div>
  );
}
