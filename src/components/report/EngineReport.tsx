/**
 * EngineReport — the assembled 8-section decision report, rendered in the
 * TrialBridge Design System's feasibility-report language: section eyebrows,
 * serif headings, evidence-sealed pills, KPI + dimension cards, and geographic
 * Brazil tile-maps for supply/demand and the KOL layer.
 *
 * Server component, no client JS — every number flows through a SealPill or a
 * tabular figure, so provenance + confidence stay visible (and it prints clean).
 */

import type { Report, UfPool, UfKolCount } from "@/lib/report/types";
import type { CountryScorecard, SiteScore } from "@/lib/scoring/types";
import type { Metric } from "@/lib/metric";
import { SealPill, ProvenanceLegend } from "@/components/MetricChip";
import { Provenance, SEAL_UI } from "@/lib/metric";
import { BrazilTileMap, TileDatum } from "@/components/report/BrazilTileMap";

// ── shared style atoms (mirror the design templates) ─────────────────────────────
const card: React.CSSProperties = {
  background: "var(--cl-surface)",
  border: "1px solid var(--cl-border)",
  borderRadius: 14,
  boxShadow: "var(--cl-shadow-sm)",
  padding: "22px 24px",
};
const serifTitle: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--cl-font-display)",
  fontWeight: 500,
  fontSize: 28,
  letterSpacing: "-0.01em",
};
const eyebrow: React.CSSProperties = {
  margin: "0 0 6px",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--cl-text-muted)",
  fontWeight: 600,
};
const mono: React.CSSProperties = { fontFamily: "var(--cl-font-mono)", fontVariantNumeric: "tabular-nums" };

const REC_STYLE: Record<Report["decisionSnapshot"]["recommendation"], { label: string; bg: string; fg: string }> = {
  go: { label: "Go", bg: "var(--cl-success-subtle)", fg: "var(--cl-success)" },
  conditional_go: { label: "Conditional go", bg: "var(--cl-warning-subtle)", fg: "var(--cl-warning)" },
  no_go: { label: "No-go", bg: "var(--cl-danger-subtle)", fg: "var(--cl-danger)" },
};

const DIM_LABEL: Record<string, string> = {
  regulatory: "Regulatory speed & predictability",
  patient_supply: "Patient supply & enrollment upside",
  competition: "Competitive saturation",
  cost: "Cost",
  infrastructure: "Infrastructure & site depth",
  data_quality: "Data quality & acceptance",
  logistics: "Operational friction / logistics",
};

const COMP_LABEL: Record<string, string> = {
  eligible_pool: "Eligible pool",
  predicted_enrollment: "Predicted enrollment",
  enrollment_history: "Enrollment history",
  competition: "Local competition",
  infrastructure_fit: "Infrastructure fit",
  kol_strength: "KOL strength",
  startup_fpi: "Startup / FPI",
  data_quality: "Data quality",
  staff_capacity: "Staff capacity",
};

function locationOf(s: { city?: string | null; uf?: string | null }): string {
  return [s.city, s.uf].filter(Boolean).join(", ");
}

function scoreColor(score: number): string {
  return score >= 70 ? "var(--cl-success)" : score >= 55 ? "var(--cl-warning)" : "var(--cl-danger)";
}

/** Format a metric's numeric value for a headline figure (no seal). */
function bigValue(m: Metric): string {
  if (m.value == null) return "—";
  if (typeof m.value === "string") return m.value;
  if (m.unit === "usd") return `$${Math.round(m.value).toLocaleString("en-US")}`;
  if (m.unit === "%" || m.unit === "score_0_100") return `${Math.round(m.value)}`;
  if (m.unit === "patients/month") return `${Math.round(m.value * 10) / 10}`;
  return Math.round(m.value).toLocaleString("en-US");
}

function SectionHead({ no, kicker, title, sub, right }: {
  no: string; kicker: string; title: string; sub?: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div>
        <p style={eyebrow}>Section {no} · {kicker}</p>
        <h2 style={serifTitle}>{title}</h2>
        {sub && <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--cl-text-secondary)", maxWidth: 680, lineHeight: 1.55 }}>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function EngineReport({ report }: { report: Report }) {
  const { decisionSnapshot: snap, country, siteRankings, softening } = report;
  const rec = REC_STYLE[snap.recommendation];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 44, fontFamily: "var(--cl-font-body)", color: "var(--cl-text)" }}>
      {/* ── §1 Decision snapshot ─────────────────────────────── */}
      <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <SectionHead
          no="01" kicker="Decision" title="Decision snapshot"
          right={<span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 600, padding: "8px 16px", borderRadius: 999, background: rec.bg, color: rec.fg }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "currentColor" }} />{rec.label}
          </span>}
        />
        {/* Recommendation banner */}
        <div style={{ ...card, display: "grid", gridTemplateColumns: "auto 1fr", gap: 28, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontFamily: "var(--cl-font-display)", fontSize: 46, fontWeight: 500, lineHeight: 1, color: scoreColor(country.composite) }}>
                {bigValue(snap.countryScoreMetric)}
              </span>
              <span style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>/ 100 country score</span>
            </div>
            <SealPill metric={snap.countryScoreMetric} showValue={false} />
          </div>
          <div>
            <p style={{ margin: "0 0 6px", fontSize: 15, lineHeight: 1.6, maxWidth: 640 }}>
              {report.context.protocolTitle}
            </p>
            <p style={{ margin: 0, fontSize: 13, color: "var(--cl-text-muted)" }}>
              Sponsor {report.context.sponsor} · {report.context.phase && `Phase ${report.context.phase}`} · every figure carries an evidence seal — hover any chip for its source.
            </p>
          </div>
        </div>

        {/* KPI tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          <KpiTile label="Projected enrollment" metric={snap.headlineMetrics.projectedPatientsPerMonthMetric} unit="pt / mo" />
          <KpiTile label="Time to first patient" metric={snap.headlineMetrics.timeToFpiMetric} />
          <KpiTile label="Cost per patient" metric={snap.headlineMetrics.costPerPatientMetric} />
          <KpiTile label="Execution risk index" metric={snap.headlineMetrics.riskIndexMetric} />
        </div>

        {/* Top-3 sites */}
        {snap.topSites.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(3, snap.topSites.length)}, 1fr)`, gap: 14 }}>
            {snap.topSites.slice(0, 3).map((s, i) => (
              <div key={s.cnes} style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <p style={{ ...eyebrow, margin: 0 }}>Rank {i + 1}</p>
                  <span style={{ ...mono, fontSize: 20, fontWeight: 600, color: "var(--cl-accent-active)" }}>{bigValue(s.compositeMetric)}</span>
                </div>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{s.name}</p>
                <p style={{ margin: 0, fontSize: 12.5, color: "var(--cl-text-secondary)" }}>{locationOf(s) || "—"}</p>
                <SealPill metric={s.compositeMetric} showValue={false} />
              </div>
            ))}
          </div>
        )}
        <ProvenanceLegend />
      </section>

      {/* ── §2 Eligibility funnel ─────────────────────────────── */}
      <FunnelSection report={report} />

      {/* ── Protocol softening ────────────────────────────────── */}
      {softening.scenarios.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <SectionHead no="02b" kicker="Levers" title="Protocol softening — biggest levers"
            sub="How many eligible patients each criterion currently excludes. Relaxing pre-startup avoids a mid-study amendment." />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {softening.scenarios.map((sc) => (
              <div key={sc.label} style={{ ...card, display: "grid", gridTemplateColumns: "1fr auto", gap: "6px 20px", alignItems: "center" }}>
                <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>{sc.label}</p>
                <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                  <span style={{ fontFamily: "var(--cl-font-display)", fontSize: 22, fontWeight: 500, color: "var(--cl-warning)", ...mono }}>
                    +{bigValue(sc.deltaEligiblePoolMetric)}
                  </span>
                  <SealPill metric={sc.amendmentCostAvoidedMetric} />
                </div>
                {sc.scientificRiskNote && (
                  <p style={{ gridColumn: "1 / 3", margin: 0, fontSize: 12, color: "var(--cl-text-secondary)", borderTop: "1px solid var(--cl-border)", paddingTop: 10 }}>
                    {sc.scientificRiskNote}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── §3 Country case ───────────────────────────────────── */}
      <CountrySection country={country} />

      {/* ── §4 Supply vs demand ───────────────────────────────── */}
      {report.supplyDemand && report.supplyDemand.regions.length > 0 && <SupplySection report={report} />}

      {/* ── §5 Site rankings ──────────────────────────────────── */}
      <RankingsSection sites={siteRankings} />

      {/* ── §6 Site deep-dive ─────────────────────────────────── */}
      <DeepDiveSection sites={report.siteDeepDives} />

      {/* ── §7 KOL map ────────────────────────────────────────── */}
      <KolSection report={report} />

      {/* ── §8 Risk register ──────────────────────────────────── */}
      <RiskSection report={report} />
    </div>
  );
}

function KpiTile({ label, metric, unit }: { label: string; metric: Metric; unit?: string }) {
  return (
    <div style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={{ margin: 0, fontSize: 12, color: "var(--cl-text-secondary)", fontWeight: 500 }}>{label}</p>
      <p style={{ margin: 0, fontFamily: "var(--cl-font-display)", fontSize: 30, fontWeight: 500, lineHeight: 1, ...mono }}>
        {bigValue(metric)}
        {unit && metric.value != null && <span style={{ fontSize: 13, color: "var(--cl-text-muted)", fontFamily: "var(--cl-font-body)", fontVariantNumeric: "normal" }}> {unit}</span>}
      </p>
      <SealPill metric={metric} showValue={false} />
    </div>
  );
}

function FunnelSection({ report }: { report: Report }) {
  const f = report.funnel;
  const base = typeof f.basePopulationMetric.value === "number" ? f.basePopulationMetric.value : 0;
  const eligible = typeof f.eligiblePoolMetric.value === "number" ? f.eligiblePoolMetric.value : 0;
  const pct = base > 0 ? Math.max(2, Math.round((100 * eligible) / base)) : 100;
  const ci = f.eligiblePoolMetric.ci;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SectionHead no="02" kicker="Eligibility" title="Eligibility funnel"
        sub="The base cohort narrowing to a protocol-eligible estimate — the patient-pool spine the whole report rests on." />
      <div style={{ ...card, background: "linear-gradient(180deg, var(--cl-info-subtle), transparent 62%)" }}>
        <FunnelRow label="Base cohort" sub="row-level records" widthPct={100} value={bigValue(f.basePopulationMetric)} metric={f.basePopulationMetric} tone="var(--cl-info)" />
        <FunnelRow label="Estimated eligible" sub={ci ? `95% CI ${Math.round(ci[0]).toLocaleString("en-US")}–${Math.round(ci[1]).toLocaleString("en-US")}` : "protocol-eligible"} widthPct={pct} value={bigValue(f.eligiblePoolMetric)} metric={f.eligiblePoolMetric} tone="var(--cl-warning)" />
        <div style={{ display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid var(--cl-border)", paddingTop: 12, marginTop: 4, fontSize: 13, color: "var(--cl-text-secondary)" }}>
          <span>Projected enrollment</span>
          <SealPill metric={f.projectedPatientsPerMonthMetric} />
        </div>
      </div>
    </section>
  );
}

function FunnelRow({ label, sub, widthPct, value, metric, tone }: {
  label: string; sub: string; widthPct: number; value: string; metric: Metric; tone: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 0" }}>
      <div style={{ width: 180 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
        <div style={{ ...mono, fontSize: 11, color: "var(--cl-text-muted)" }}>{sub}</div>
      </div>
      <div style={{ flex: 1, height: 34, borderRadius: 7, background: "var(--cl-surface-2)", overflow: "hidden" }}>
        <div style={{ width: `${widthPct}%`, height: "100%", borderRadius: 7, background: tone, opacity: 0.85 }} />
      </div>
      <div style={{ width: 160, textAlign: "right" }}>
        <div style={{ fontFamily: "var(--cl-font-display)", fontSize: 20, fontWeight: 600, ...mono }}>{value}</div>
        <div style={{ marginTop: 4 }}><SealPill metric={metric} showValue={false} /></div>
      </div>
    </div>
  );
}

function CountrySection({ country }: { country: CountryScorecard }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SectionHead no="03" kicker="Country layer" title="Country case: Brazil"
        sub="Seven weighted dimensions roll up to the composite. Seals mark the evidence class of each contributing signal."
        right={<SealPill metric={country.compositeMetric} />}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {country.dimensions.map((d) => (
          <div key={d.key} style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 9 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{DIM_LABEL[d.key] ?? d.key}</p>
              <span style={{ ...mono, fontSize: 11, color: "var(--cl-text-muted)" }}>w {Math.round(d.weight * 100)}%</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "var(--cl-font-display)", fontSize: 26, fontWeight: 500, minWidth: 40, ...mono }}>{Math.round(d.score0100)}</span>
              <div style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--cl-surface-2)", overflow: "hidden" }}>
                <div style={{ width: `${Math.max(0, Math.min(100, d.score0100))}%`, height: "100%", borderRadius: 999, background: scoreColor(d.score0100) }} />
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {d.contributingMetrics.slice(0, 2).map((m) => <SealPill key={m.key} metric={m} />)}
            </div>
          </div>
        ))}
        <div style={{ background: "var(--cl-surface-2)", borderRadius: 14, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8, justifyContent: "center" }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--cl-text-secondary)" }}>How to read these scores</p>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--cl-text-secondary)", lineHeight: 1.55 }}>
            0–100 per dimension. Anything under 55 carries a registered risk in the register below. Seals mark each contributing metric's evidence class.
          </p>
        </div>
      </div>
    </section>
  );
}

function SupplySection({ report }: { report: Report }) {
  const sd = report.supplyDemand!;
  const ufPools = sd.ufPools ?? [];
  const tiles: Record<string, TileDatum> = {};
  if (ufPools.length > 0) {
    const top = [...ufPools].sort((a, b) => b.eligible - a.eligible).slice(0, 3).map((p) => p.uf);
    for (const p of ufPools) {
      tiles[p.uf] = {
        value: p.eligible,
        display: p.eligible >= 1000 ? `${(p.eligible / 1000).toFixed(1)}k` : String(p.eligible),
        sweet: top.includes(p.uf),
        tip: `${p.eligible.toLocaleString("en-US")} eligible (DataSUS)`,
      };
    }
  }
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SectionHead no="04" kicker="Geography" title="Patient supply vs trial demand"
        sub="Where eligible patients are, against where competing trials already recruit. Outlined states hold the deepest pools." />
      <div style={{ ...card, display: "flex", flexWrap: "wrap", gap: 32, alignItems: "flex-start" }}>
        {ufPools.length > 0 && (
          <BrazilTileMap
            data={tiles}
            rgb="31,157,107"
            legend="Darker = more protocol-eligible patients (DataSUS estimate) · outlined = deepest three pools"
            caption={<SealPill metric={sd.regions[0].eligiblePoolMetric} showValue={false} />}
          />
        )}
        <div style={{ flex: 1, minWidth: 320, display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Regional rollup — eligible pool vs competing trials</p>
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--cl-border)", fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--cl-text-muted)", fontWeight: 600 }}>
              <span>Region</span><span style={{ textAlign: "right" }}>Eligible</span><span style={{ textAlign: "right" }}>Competing</span><span style={{ textAlign: "right" }}>Pt / trial</span>
            </div>
            {sd.regions.map((r) => (
              <div key={r.regionCode} style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr", gap: 10, padding: "10px 12px", borderBottom: "1px dashed var(--cl-border)", fontSize: 13, alignItems: "center" }}>
                <span style={{ fontWeight: 600 }}>{r.regionCode}</span>
                <span style={{ ...mono, textAlign: "right" }}>{bigValue(r.eligiblePoolMetric)}</span>
                <span style={{ ...mono, textAlign: "right" }}>{bigValue(r.competingTrialsMetric)}</span>
                <span style={{ ...mono, textAlign: "right", fontWeight: 700, color: "var(--cl-accent-active)" }}>{bigValue(r.ratioMetric)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <SealPill metric={sd.regions[0].eligiblePoolMetric} showValue={false} />
            <SealPill metric={sd.regions[0].competingTrialsMetric} showValue={false} />
          </div>
        </div>
      </div>
    </section>
  );
}

function RankingsSection({ sites }: { sites: SiteScore[] }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SectionHead no="05" kicker="Sites" title="Site rankings"
        sub={sites.length > 0 ? "Ranked real oncology centres, scored on nine components. Confidence lifts as declared + public data arrives." : undefined} />
      <div style={card}>
        {sites.length === 0 ? (
          <p style={{ margin: 0, color: "var(--cl-text-secondary)", fontSize: 13.5 }}>
            No sites online yet. As sites declare capacity (or public CNES/CT.gov data is wired), the ranked master table appears here.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--cl-text-muted)" }}>
                  {["#", "Site", "UF", "Score", "Infra-fit", "Confidence", "Flags"].map((h, i) => (
                    <th key={h} style={{ textAlign: i >= 3 && i <= 4 ? "right" : "left", padding: "8px 12px", borderBottom: "1px solid var(--cl-border)", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sites.map((s, i) => {
                  const infra = s.components.find((c) => c.key === "infrastructure_fit");
                  return (
                    <tr key={s.cnes} style={{ borderBottom: "1px dashed var(--cl-border)" }}>
                      <td style={{ ...mono, color: "var(--cl-text-muted)", padding: "9px 12px" }}>{i + 1}</td>
                      <td style={{ padding: "9px 12px", fontWeight: 600 }}>{s.name}</td>
                      <td style={{ padding: "9px 12px" }}><span style={{ ...mono, fontSize: 11, color: "var(--cl-text-secondary)", background: "var(--cl-surface-2)", padding: "1px 6px", borderRadius: 4 }}>{s.uf || "—"}</span></td>
                      <td style={{ ...mono, padding: "9px 12px", textAlign: "right", fontWeight: 700, color: "var(--cl-accent-active)" }}>{Math.round(s.composite * 10) / 10}</td>
                      <td style={{ ...mono, padding: "9px 12px", textAlign: "right", color: "var(--cl-text-secondary)" }}>{infra ? `${Math.round(infra.score0100)}%` : "—"}</td>
                      <td style={{ padding: "9px 12px" }}><ConfidencePill conf={s.confidence} /></td>
                      <td style={{ padding: "9px 12px" }}>
                        {s.hardFlags.length === 0 ? <span style={{ color: "var(--cl-text-muted)" }}>—</span> : s.hardFlags.map((f) => (
                          <span key={f.key} title={f.detailMetric?.note ?? f.label} style={{ display: "inline-block", background: "var(--cl-danger-subtle)", color: "var(--cl-danger)", fontSize: 11, padding: "1px 6px", borderRadius: 6, marginRight: 4 }}>{f.label}</span>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function ConfidencePill({ conf }: { conf: "high" | "medium" | "low" }) {
  const map = {
    high: { bg: "var(--cl-success-subtle)", fg: "var(--cl-success)" },
    medium: { bg: "var(--cl-info-subtle)", fg: "var(--cl-info)" },
    low: { bg: "var(--cl-surface-2)", fg: "var(--cl-text-muted)" },
  }[conf];
  return <span style={{ ...mono, fontSize: 11, padding: "2px 8px", borderRadius: 5, background: map.bg, color: map.fg }}>{conf}</span>;
}

// ── §6 Site deep-dive ────────────────────────────────────────────────────────────
const DEEPDIVE_AXES: { key: string; label: string }[] = [
  { key: "eligible_pool", label: "Pool" },
  { key: "predicted_enrollment", label: "Enroll" },
  { key: "enrollment_history", label: "History" },
  { key: "competition", label: "Compet." },
  { key: "infrastructure_fit", label: "Infra" },
  { key: "kol_strength", label: "KOL" },
  { key: "startup_fpi", label: "Startup" },
  { key: "data_quality", label: "Data" },
  { key: "staff_capacity", label: "Staff" },
];

/** Nine-axis radar of a site's component scores (design template §6). Pure SVG. */
function SiteRadar({ radar }: { radar: Record<string, number> }) {
  const cx = 170, cy = 138, R = 100, n = DEEPDIVE_AXES.length;
  const pt = (i: number, r: number): [number, number] => {
    const ang = (-90 + (360 / n) * i) * (Math.PI / 180);
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  };
  const poly = DEEPDIVE_AXES.map((a, i) => {
    const v = Math.max(0, Math.min(100, radar[a.key] ?? 0));
    const [x, y] = pt(i, (v / 100) * R);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 340 290" style={{ width: "100%", height: "auto" }} role="img" aria-label="Nine-component site score radar">
      {[25, 50, 75, 100].map((r) => (
        <circle key={r} cx={cx} cy={cy} r={r} fill="none" stroke="var(--cl-border)" strokeDasharray="3 3" />
      ))}
      {DEEPDIVE_AXES.map((a, i) => {
        const [x, y] = pt(i, R);
        return <line key={a.key} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--cl-border)" />;
      })}
      <polygon points={poly} fill="rgba(217,119,87,0.22)" stroke="var(--cl-accent)" strokeWidth={1.5} />
      {DEEPDIVE_AXES.map((a, i) => {
        const [lx, ly] = pt(i, R + 20);
        const anchor = Math.abs(lx - cx) < 8 ? "middle" : lx > cx ? "start" : "end";
        return (
          <text key={a.key} x={lx.toFixed(0)} y={(ly + 3).toFixed(0)} textAnchor={anchor} fontSize={10} fill="var(--cl-text-secondary)">
            {a.label} {Math.round(radar[a.key] ?? 0)}
          </text>
        );
      })}
    </svg>
  );
}

function DeepDiveSection({ sites }: { sites: SiteScore[] }) {
  if (!sites || sites.length === 0) return null;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SectionHead no="06" kicker="Site layer" title="Site deep-dive"
        sub="The nine-component breakdown behind the top-ranked sites — the same scores that drive §5, opened up with each component's evidence seal." />
      {sites.slice(0, 2).map((s, i) => <DeepDiveCard key={s.cnes} site={s} rank={i + 1} />)}
    </section>
  );
}

function DeepDiveCard({ site, rank }: { site: SiteScore; rank: number }) {
  const weakest = [...site.components].sort((a, b) => a.score0100 - b.score0100)[0];
  const loc = [site.city, site.uf].filter(Boolean).join(", ");
  return (
    <div style={{ ...card, padding: "24px 26px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p style={{ ...eyebrow, margin: "0 0 4px" }}>Rank {rank}</p>
          <h3 style={{ margin: 0, fontFamily: "var(--cl-font-display)", fontWeight: 500, fontSize: 21 }}>{site.name}</h3>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--cl-text-secondary)" }}>
            {loc || "—"}{site.cnes && <span style={{ ...mono, fontSize: 12 }}> · CNES {site.cnes}</span>}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ConfidencePill conf={site.confidence} />
          <span style={{ ...mono, fontSize: 26, fontWeight: 700, color: "var(--cl-accent-active)" }}>{Math.round(site.composite * 10) / 10}</span>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 26, alignItems: "flex-start" }}>
        {/* Radar */}
        <div style={{ width: 300, maxWidth: "100%" }}>
          <SiteRadar radar={site.radar} />
          <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--cl-text-muted)", lineHeight: 1.5 }}>
            Weakest component: <strong style={{ color: "var(--cl-text)" }}>{COMP_LABEL[weakest.key] ?? weakest.key}</strong> ({Math.round(weakest.score0100)}/100).
          </p>
        </div>

        {/* Component breakdown + headline metrics */}
        <div style={{ flex: 1, minWidth: 300, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <p style={{ ...eyebrow, margin: "0 0 10px" }}>Component scores</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {site.components.map((c) => (
                <div key={c.key} style={{ display: "grid", gridTemplateColumns: "1fr 34px 90px", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 12.5 }}>{COMP_LABEL[c.key] ?? c.key}</span>
                  <span style={{ ...mono, fontSize: 12.5, textAlign: "right", fontWeight: 600 }}>{Math.round(c.score0100)}</span>
                  <div style={{ height: 6, borderRadius: 999, background: "var(--cl-surface-2)", overflow: "hidden" }}>
                    <div style={{ width: `${Math.max(0, Math.min(100, c.score0100))}%`, height: "100%", borderRadius: 999, background: scoreColor(c.score0100) }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p style={{ ...eyebrow, margin: "0 0 10px" }}>Headline metrics</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <LabeledSeal label="Enrollment" metric={site.headlineMetrics.enrollmentRateMetric} />
              <LabeledSeal label="Screen-fail" metric={site.headlineMetrics.screenFailMetric} />
              <LabeledSeal label="Retention" metric={site.headlineMetrics.retentionMetric} />
            </div>
          </div>
          {site.hardFlags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {site.hardFlags.map((f) => (
                <span key={f.key} title={f.detailMetric?.note ?? f.label} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "var(--cl-danger-subtle)", color: "var(--cl-danger)" }}>{f.label}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LabeledSeal({ label, metric }: { label: string; metric: Metric }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
      <span style={{ color: "var(--cl-text-muted)" }}>{label}</span>
      <SealPill metric={metric} />
    </span>
  );
}

function KolSection({ report }: { report: Report }) {
  const physicians = report.kolMap?.physicians ?? [];
  const ufCounts: UfKolCount[] = report.kolMap?.ufCounts ?? [];

  const tiles: Record<string, TileDatum> = {};
  if (ufCounts.length > 0) {
    const top = ufCounts.slice(0, 3).map((c) => c.uf);
    for (const c of ufCounts) {
      tiles[c.uf] = { value: c.count, sweet: top.includes(c.uf), tip: `${c.count} active investigator${c.count === 1 ? "" : "s"}` };
    }
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SectionHead no="07" kicker="People" title="Reference physicians — KOL map"
        sub="Opinion-leader density by state, and the ranked investigators behind the shortlist. Outlined states carry the deepest KOL benches." />
      {physicians.length === 0 && ufCounts.length === 0 ? (
        <div style={card}>
          <p style={{ margin: 0, color: "var(--cl-text-secondary)", fontSize: 13.5 }}>
            KOL scoring is live (trial experience · publications · society roles · CNES link), but the map populates once the
            investigator connector (CT.gov + PubMed/ORCID) is wired. No physicians are shown rather than fabricated.
          </p>
        </div>
      ) : (
        <div style={{ ...card, display: "flex", flexWrap: "wrap", gap: 32, alignItems: "flex-start" }}>
          {ufCounts.length > 0 && (
            <BrazilTileMap
              data={tiles}
              rgb="124,94,153"
              legend="Darker = more active investigators matched to a site in that state · value = investigator count · outlined = deepest benches"
              caption={<span title="Investigator counts from ClinicalTrials.gov site records, matched to the ABRACRO/ACESSE directory." style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 500, padding: "3px 8px", borderRadius: 999, background: "var(--tb-prov-registry-subtle)", color: "var(--tb-prov-registry)" }}>Registry / gov <span style={{ fontSize: 8 }}>●</span></span>}
            />
          )}
          {physicians.length > 0 && (
            <div style={{ flex: 1, minWidth: 340, display: "flex", flexDirection: "column", gap: 4 }}>
              <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600 }}>Ranked investigators</p>
              <div style={{ display: "grid", gridTemplateColumns: "26px 1.5fr 1.2fr 64px 60px", gap: 10, padding: "8px 4px", borderBottom: "1px solid var(--cl-border)", fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--cl-text-muted)", fontWeight: 600 }}>
                <span>#</span><span>Investigator</span><span>Affiliation</span><span style={{ textAlign: "right" }}>Pubs</span><span style={{ textAlign: "right" }}>KOL</span>
              </div>
              {physicians.slice(0, 8).map((p, i) => {
                const cited = (p.citations ?? []).filter((c) => c.url);
                return (
                  <div key={`${p.name}-${i}`} style={{ display: "grid", gridTemplateColumns: "26px 1.5fr 1.2fr 64px 60px", gap: 10, padding: "9px 4px", borderBottom: "1px dashed var(--cl-border)", fontSize: 12.5, alignItems: "center" }}>
                    <span style={{ ...mono, color: "var(--cl-text-muted)" }}>{i + 1}</span>
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
                    <span style={{ color: "var(--cl-text-secondary)", fontSize: 12 }}>
                      {p.affiliation ?? "—"}{p.cnes && <span style={{ ...mono, color: "var(--cl-info)", fontSize: 11 }}> · {p.cnes}</span>}
                    </span>
                    <span style={{ ...mono, textAlign: "right" }}>
                      {p.pubsCountTa ? p.pubsCountTa : "—"}
                      {cited.length > 0 && <a href={cited[0].url!} target="_blank" rel="noopener noreferrer" title={`${cited.length} sources`} style={{ fontSize: 10, color: "var(--cl-accent-active)" }}> [{cited.length}]</a>}
                    </span>
                    <span style={{ ...mono, textAlign: "right", fontWeight: 700, color: "var(--cl-accent-active)" }}>{bigValue(p.scoreMetric)}</span>
                  </div>
                );
              })}
              <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--cl-text-secondary)", lineHeight: 1.55 }}>
                KOL score = trial leadership × publication activity × society/network reach. Production reports link each name to its registry profile.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RiskSection({ report }: { report: Report }) {
  const idx = report.riskRegister.provenanceIndex;
  const total = idx.total || 1;
  const order: Provenance[] = [Provenance.PEER_REVIEWED, Provenance.REGISTRY_GOV, Provenance.SITE_DECLARED, Provenance.MODELED, Provenance.VENDOR];
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SectionHead no="08" kicker="Assurance" title="Risk register & provenance"
        sub={`Every number on this page carries a provenance seal — here is the mix across ${idx.total} metrics.`} />
      <div style={card}>
        {/* Provenance mix stacked bar */}
        <div style={{ display: "flex", height: 40, borderRadius: 9, overflow: "hidden", border: "1px solid var(--cl-border)", marginBottom: 14 }}>
          {order.map((seal) => {
            const n = idx.bySeal[seal];
            if (n === 0) return null;
            return (
              <div key={seal} title={`${SEAL_UI[seal].label}: ${n}`} style={{ width: `${(100 * n) / total}%`, background: SEAL_UI[seal].colorHex, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 600, ...mono, minWidth: n > 0 ? 3 : 0 }}>
                {(100 * n) / total > 12 ? `${n} ${SEAL_UI[seal].label.split(" ")[0].toLowerCase()}` : ""}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", fontSize: 12.5, color: "var(--cl-text-secondary)", marginBottom: 22 }}>
          {order.map((seal) => (
            <span key={seal} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: SEAL_UI[seal].colorHex }} />
              {SEAL_UI[seal].label} <strong style={{ color: "var(--cl-text)", ...mono }}>{idx.bySeal[seal]}</strong>
            </span>
          ))}
        </div>

        {report.riskRegister.hardFlags.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 11.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--cl-text-muted)", fontWeight: 700 }}>Active hard flags</h3>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
              {report.riskRegister.hardFlags.map((f, i) => (
                <li key={`${f.key}-${i}`} style={{ fontSize: 13, color: "var(--cl-text-secondary)" }}>
                  <strong style={{ color: "var(--cl-danger)" }}>{f.label}</strong>{f.detailMetric?.note ? ` — ${f.detailMetric.note}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
          <RiskCol title="Model assumptions" items={report.riskRegister.assumptions} accent="var(--cl-info)" />
          <RiskCol title="Live risks to re-check" items={report.riskRegister.liveRisksToRecheck} accent="var(--cl-warning)" square />
        </div>
      </div>
    </section>
  );
}

function RiskCol({ title, items, accent, square }: { title: string; items: string[]; accent: string; square?: boolean }) {
  return (
    <div>
      <h3 style={{ margin: "0 0 12px", fontSize: 11.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--cl-text-muted)", fontWeight: 700 }}>{title}</h3>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 11 }}>
        {items.map((a, i) => (
          <li key={i} style={{ fontSize: 13, color: "var(--cl-text-secondary)", paddingLeft: 18, position: "relative", lineHeight: 1.5 }}>
            <span style={{ position: "absolute", left: 0, top: 7, width: 6, height: 6, borderRadius: square ? 1 : "50%", background: accent }} />
            {a}
          </li>
        ))}
      </ul>
    </div>
  );
}
