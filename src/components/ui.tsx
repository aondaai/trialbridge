/**
 * Shared presentational components used across both role views. Server-safe
 * (no client hooks). The privacy banner and cohort visuals are what make the
 * privacy boundary and tri-state model visually self-evident (a spec requirement).
 */
import Link from "next/link";
import type { Criterion, CriterionResult, Cohort } from "@/lib/matcher/types";
import { Provenance, Confidence, type Metric } from "@/lib/metric";

export function TopBar({ active }: { active?: "home" | "sponsor" | "site" }) {
  return (
    <div className="topbar no-print">
      <Link href="/" className="brand">
        <span className="tb-mark">TB</span> Trial<span className="brand-accent">Bridge</span>{" "}
        <small>· Elegível</small>
      </Link>
      <nav className="navlinks">
        <Link href="/sponsor" className={active === "sponsor" ? "active" : ""}>
          Sponsor (Marcus)
        </Link>
        <Link href="/site" className={active === "site" ? "active" : ""}>
          Site (Camila)
        </Link>
      </nav>
    </div>
  );
}

export function PrivacyBanner({ variant }: { variant: "sponsor" | "site" }) {
  return (
    <div className="tb-privacy">
      <span className="tb-privacy__lock">🔒</span>
      <div>
        {variant === "sponsor" ? (
          <>
            <strong>You see counts, never patients.</strong> Every responding site
            sends aggregate candidate counts and its bottleneck criterion — no
            row-level patient data crosses this boundary. Cells of 1–4 are shown as{" "}
            <span className="mono">&lt;5</span> so a small subgroup can&apos;t be
            re-identified.{" "}
            <span className="muted">
              (Structural counts-not-rows + small-cell suppression — not full
              differential privacy; that&apos;s v2.)
            </span>
          </>
        ) : (
          <>
            <strong>Patient details stay here, at your site.</strong> The matcher
            runs locally over your records; only aggregate counts and your
            bottleneck criterion are submitted to the sponsor.
          </>
        )}
      </div>
    </div>
  );
}

export function Chip({ cohort, children }: { cohort: Cohort; children?: React.ReactNode }) {
  return (
    <span className={`tb-chip tb-chip--${cohort}`}>
      <span className="tb-chip__dot" />
      {children ?? cohort}
    </span>
  );
}

export function CohortBar({
  definite,
  possible,
  excluded,
}: {
  definite: number;
  possible: number;
  excluded: number;
}) {
  const total = Math.max(1, definite + possible + excluded);
  const pct = (n: number) => `${(100 * n) / total}%`;
  return (
    <div className="tb-cohortbar" title={`definite ${definite} · possible ${possible} · excluded ${excluded}`}>
      <span className="tb-cohortbar__definite" style={{ width: pct(definite) }} />
      <span className="tb-cohortbar__possible" style={{ width: pct(possible) }} />
      <span className="tb-cohortbar__excluded" style={{ width: pct(excluded) }} />
    </div>
  );
}

export function CohortLegend() {
  return (
    <div className="tb-cohort-legend">
      <span><i style={{ background: "var(--tb-definite, #1F9D6B)" }} /> definite — passes all criteria</span>
      <span><i style={{ background: "var(--tb-possible, #D98A2B)" }} /> possible — eligible but has unknowns</span>
      <span><i style={{ background: "var(--tb-excluded, #B8B7B0)" }} /> excluded</span>
    </div>
  );
}

/** Read-back of parsed criteria (the "verify the parse" surface). */
export function CriterionList({ criteria }: { criteria: Criterion[] }) {
  return (
    <div>
      {criteria.map((c) => (
        <div className="crit" key={c.id}>
          <span className="kind">{c.kind}</span>
          <span style={{ flex: 1 }}>
            {c.rawText}
            {c.confidence < 0.75 && <span className="badge-low">low-confidence · verify</span>}
            {c.evaluability === "not_evaluable" && (
              <span className="badge-low" style={{ background: "var(--excluded)" }}>not evaluable in this data source</span>
            )}
            {c.evaluability === "partial" && (
              <span className="badge-low" style={{ background: "var(--possible)" }}>partial data coverage</span>
            )}
          </span>
          {c.groupLabel && c.groupId && (
            <span className="muted" style={{ fontSize: 12 }}>
              group: {c.groupId}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Per-criterion pass/fail/unknown breakdown for a single patient (auditability). */
export function CriterionResultList({ results }: { results: CriterionResult[] }) {
  return (
    <div>
      {results.map((r) => (
        <div className="crit" key={r.criterionId}>
          <span className={`dot ${r.status}`} />
          <span style={{ width: 74 }} className="muted mono" data-status={r.status}>
            {r.status}
          </span>
          <span style={{ flex: 1 }}>{r.rawText}</span>
          <span className="muted mono" style={{ fontSize: 12 }}>
            {r.observed === undefined ? "no data" : `observed: ${String(r.observed)}`}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * MetricChip — the evidence-provenance seal (TrialBridge design system). Every quantitative
 * value a sponsor/coordinator sees renders through one, so hard fact (site-declared / registry)
 * reads apart from estimate (modeled) at a glance. Maps the metric.ts Provenance enum onto the
 * design system's provenance classes + tokens.
 */
const PROV_CLASS: Record<Provenance, string> = {
  [Provenance.PEER_REVIEWED]: "peer",
  [Provenance.REGISTRY_GOV]: "registry",
  [Provenance.SITE_DECLARED]: "declared",
  [Provenance.MODELED]: "modeled",
  [Provenance.VENDOR]: "vendor",
};
const PROV_LABEL: Record<Provenance, string> = {
  [Provenance.PEER_REVIEWED]: "Peer-reviewed",
  [Provenance.REGISTRY_GOV]: "Registry / gov",
  [Provenance.SITE_DECLARED]: "Site-declared",
  [Provenance.MODELED]: "Modeled",
  [Provenance.VENDOR]: "Vendor benchmark",
};
const CONF_GLYPH: Record<Confidence, string> = {
  [Confidence.HIGH]: "●",
  [Confidence.MEDIUM]: "◐",
  [Confidence.LOW]: "○",
};

export function MetricChip({
  metric,
  showValue = true,
  size = "sm",
}: {
  metric: Metric;
  showValue?: boolean;
  size?: "sm" | "md";
}) {
  const cls = PROV_CLASS[metric.provenance];
  const tip = [metric.note, metric.asOf ? `as of ${metric.asOf}` : null].filter(Boolean).join(" · ");
  // Stable id derived from the metric key so the tooltip can be linked for screen readers.
  const tipId = tip ? `mc-tip-${metric.key.replace(/[^\w.-]+/g, "-")}` : undefined;
  return (
    <span
      className={`tb-chip tb-chip--${cls}${size === "md" ? " tb-chip--md" : ""}`}
      tabIndex={tip ? 0 : undefined}
      aria-describedby={tipId}
    >
      {showValue && metric.value != null && (
        <span className="tb-chip__value">{String(metric.value)}</span>
      )}
      <span className="tb-chip__seal">{PROV_LABEL[metric.provenance]}</span>
      <span className="tb-chip__conf" aria-label={`confidence ${metric.confidence}`}>
        {CONF_GLYPH[metric.confidence]}
      </span>
      {tip && (
        <span id={tipId} className="tb-chip__tip" role="tooltip">
          {tip}
        </span>
      )}
    </span>
  );
}

/** ArchetypeTag — the A/B/C/D routing lane. Colour encodes deterministic (A/B/C) vs LLM (D). */
export function ArchetypeTag({ archetype }: { archetype: "A" | "B" | "C" | "D" }) {
  return (
    <span className={`tb-arch tb-arch--${archetype}`} title={`Arquétipo ${archetype}`}>
      {archetype}
    </span>
  );
}

/** DQBadge — the worst-of-three Kahn flag (conformance/completeness/plausibility). */
const DQ_UI: Record<"pass" | "warn" | "fail", { cls: string; label: string }> = {
  pass: { cls: "success", label: "DQ ok" },
  warn: { cls: "warning", label: "DQ atenção" },
  fail: { cls: "danger", label: "DQ falha" },
};
export function DQBadge({ worst, title }: { worst: "pass" | "warn" | "fail"; title?: string }) {
  const ui = DQ_UI[worst];
  return (
    <span className={`cl-badge cl-badge--${ui.cls}`} title={title}>
      <span className="cl-badge__dot" />
      {ui.label}
    </span>
  );
}

/** StatusBadge — HITL state of an answer. */
const STATUS_UI: Record<string, { cls: string; label: string }> = {
  proposed: { cls: "neutral", label: "Proposto" },
  approved: { cls: "success", label: "Aprovado" },
  edited: { cls: "warning", label: "Editado" },
  rejected: { cls: "danger", label: "Rejeitado" },
};
export function StatusBadge({ status }: { status: string }) {
  const ui = STATUS_UI[status] ?? STATUS_UI.proposed;
  return <span className={`cl-badge cl-badge--${ui.cls}`}>{ui.label}</span>;
}
