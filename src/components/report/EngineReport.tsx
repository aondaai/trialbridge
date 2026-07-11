/**
 * EngineReport — renders the assembled 8-section Report (eng spec §13).
 *
 * Server component. Every number goes through MetricChip, so provenance + confidence
 * are visible everywhere. Sections whose upstream engines are still MODELED
 * placeholders (site infra/competition/KOL) are honestly badged low-confidence.
 */

import type { Report } from "@/lib/report/types";
import type { CountryScorecard, SiteScore } from "@/lib/scoring/types";
import { MetricChip, ProvenanceLegend } from "@/components/MetricChip";
import { Provenance, SEAL_UI } from "@/lib/metric";

const REC_STYLE: Record<Report["decisionSnapshot"]["recommendation"], { label: string; bg: string; fg: string }> = {
  go: { label: "GO", bg: "var(--cl-success-subtle)", fg: "var(--cl-success)" },
  conditional_go: { label: "CONDITIONAL GO", bg: "var(--cl-warning-subtle)", fg: "var(--cl-warning)" },
  no_go: { label: "NO-GO", bg: "var(--cl-danger-subtle)", fg: "var(--cl-danger)" },
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
  infrastructure_fit: "Infra fit",
  kol_strength: "KOL strength",
  startup_fpi: "Startup / FPI",
  data_quality: "Data quality",
  staff_capacity: "Staff capacity",
};

function ScoreBar({ score }: { score: number }) {
  return (
    <div style={{ background: "var(--cl-surface-2)", borderRadius: 4, height: 8, width: 120, overflow: "hidden" }}>
      <span
        style={{
          display: "block",
          height: "100%",
          width: `${Math.max(0, Math.min(100, score))}%`,
          background: score >= 70 ? "var(--cl-success)" : score >= 50 ? "var(--cl-warning)" : "var(--cl-danger)",
        }}
      />
    </div>
  );
}

export function EngineReport({ report }: { report: Report }) {
  const { decisionSnapshot: snap, country, siteRankings, riskRegister, softening } = report;
  const rec = REC_STYLE[snap.recommendation];

  return (
    <div>
      {/* §1 Decision Snapshot */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Decision snapshot</h2>
          <span
            style={{
              background: rec.bg,
              color: rec.fg,
              fontWeight: 700,
              fontSize: 14,
              padding: "4px 12px",
              borderRadius: 999,
              letterSpacing: 0.5,
            }}
          >
            {rec.label}
          </span>
        </div>
        <p className="sub" style={{ marginTop: 4 }}>
          Brazil country score <MetricChip metric={snap.countryScoreMetric} strong /> · {report.context.protocolTitle}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 12 }}>
          <HeadlineTile label="Projected enrollment" metric={snap.headlineMetrics.projectedPatientsPerMonthMetric} />
          <HeadlineTile label="Time to FPI" metric={snap.headlineMetrics.timeToFpiMetric} />
          <HeadlineTile label="Cost / patient" metric={snap.headlineMetrics.costPerPatientMetric} />
          <HeadlineTile label="Execution risk index" metric={snap.headlineMetrics.riskIndexMetric} />
        </div>
        {snap.topSites.length > 0 && (
          <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
            Top sites:{" "}
            {snap.topSites.map((s, i) => (
              <span key={s.cnes}>
                {i > 0 ? " · " : ""}
                <strong>{s.name}</strong> ({s.city}) <MetricChip metric={s.compositeMetric} />
              </span>
            ))}
          </p>
        )}
        <ProvenanceLegend />
      </div>

      {/* §3 Country Case */}
      <CountryCard country={country} />

      {/* §4 Supply vs. Demand */}
      {report.supplyDemand && report.supplyDemand.regions.length > 0 && (
        <SupplyDemandCard report={report} />
      )}

      {/* §2 Softening */}
      {softening.scenarios.length > 0 && (
        <div className="card">
          <h2>Protocol softening — biggest lever</h2>
          {softening.scenarios.map((sc) => (
            <p key={sc.label} style={{ marginTop: 8 }}>
              <strong>{sc.label}</strong> would add <MetricChip metric={sc.deltaEligiblePoolMetric} strong /> to the
              eligible pool and avoid an amendment costing <MetricChip metric={sc.amendmentCostAvoidedMetric} /> if done
              pre-startup.
              {sc.scientificRiskNote && <span className="muted" style={{ display: "block", fontSize: 12, marginTop: 4 }}>{sc.scientificRiskNote}</span>}
            </p>
          ))}
        </div>
      )}

      {/* §5 Site Rankings */}
      <SiteRankings sites={siteRankings} />

      {/* §7 KOL / reference-physician map */}
      <KolMapCard report={report} />

      {/* §8 Risk Register */}
      <RiskRegisterCard report={report} />
    </div>
  );
}

function HeadlineTile({ label, metric }: { label: string; metric: import("@/lib/metric").Metric }) {
  return (
    <div style={{ background: "var(--cl-surface-2)", borderRadius: 10, padding: 12 }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 20, marginTop: 4 }}>
        <MetricChip metric={metric} strong />
      </div>
    </div>
  );
}

function CountryCard({ country }: { country: CountryScorecard }) {
  return (
    <div className="card">
      <h2>Country case — Brazil</h2>
      <p className="sub">
        Composite <MetricChip metric={country.compositeMetric} strong /> across 7 weighted dimensions.
      </p>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Dimension</th>
              <th className="num">Weight</th>
              <th>Score</th>
              <th className="num" style={{ width: 130 }}></th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {country.dimensions.map((d) => (
              <tr key={d.key}>
                <td>{DIM_LABEL[d.key] ?? d.key}</td>
                <td className="num">{Math.round(d.weight * 100)}%</td>
                <td><MetricChip metric={d.scoreMetric} strong /></td>
                <td><ScoreBar score={d.score0100} /></td>
                <td style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {d.contributingMetrics.slice(0, 2).map((m) => (
                    <MetricChip key={m.key} metric={m} />
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SupplyDemandCard({ report }: { report: Report }) {
  const sd = report.supplyDemand!;
  return (
    <div className="card">
      <h2>Patient supply vs. trial demand</h2>
      <p className="sub">Eligible patients per competing trial, by region — higher = idle patients, low cannibalization.</p>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Region</th>
              <th>Eligible pool</th>
              <th>Competing trials</th>
              <th>Supply / demand ratio</th>
            </tr>
          </thead>
          <tbody>
            {sd.regions.map((r) => (
              <tr key={r.regionCode}>
                <td>{r.regionCode}</td>
                <td><MetricChip metric={r.eligiblePoolMetric} /></td>
                <td><MetricChip metric={r.competingTrialsMetric} /></td>
                <td><MetricChip metric={r.ratioMetric} strong /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SiteRankings({ sites }: { sites: SiteScore[] }) {
  return (
    <div className="card">
      <h2>Site rankings</h2>
      {sites.length === 0 ? (
        <p className="muted">
          No sites online yet. As sites declare capacity (or public CNES/CT.gov data is wired), the ranked master
          table appears here.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Site</th>
                <th>City / UF</th>
                <th>Score</th>
                <th>Confidence</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s, i) => (
                <tr key={s.cnes}>
                  <td>{i + 1}</td>
                  <td><strong>{s.name}</strong></td>
                  <td>{s.city}{s.uf ? ` / ${s.uf}` : ""}</td>
                  <td><MetricChip metric={s.compositeMetric} strong /></td>
                  <td style={{ textTransform: "capitalize" }}>{s.confidence}</td>
                  <td>
                    {s.hardFlags.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      s.hardFlags.map((f) => (
                        <span
                          key={f.key}
                          title={f.detailMetric?.note ?? f.label}
                          style={{
                            display: "inline-block",
                            background: "var(--cl-danger-subtle)",
                            color: "var(--cl-danger)",
                            fontSize: 11,
                            padding: "1px 6px",
                            borderRadius: 6,
                            marginRight: 4,
                          }}
                        >
                          {f.label}
                        </span>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KolMapCard({ report }: { report: Report }) {
  const physicians = report.kolMap?.physicians ?? [];
  return (
    <div className="card">
      <h2>Reference physicians / KOL map</h2>
      {physicians.length === 0 ? (
        <p className="muted">
          KOL scoring is live (trial experience · publications · society roles · CNES link), but the map
          populates once the investigator connector (CT.gov <code>overallOfficials</code> + PubMed/ORCID) is
          wired — R9. No physicians are shown rather than fabricated.
        </p>
      ) : (
        <>
          <p className="sub">
            Investigators on recruiting trials with Brazil sites (CT.gov). Trial-experience signal only —
            publications + society roles activate once PubMed/ORCID is wired.
          </p>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Physician</th>
                  <th>Affiliation</th>
                  <th>KOL score</th>
                </tr>
              </thead>
              <tbody>
                {physicians.map((p, i) => (
                  <tr key={`${p.name}-${i}`}>
                    <td>{i + 1}</td>
                    <td><strong>{p.name}</strong></td>
                    <td>{p.affiliation ?? <span className="muted">—</span>}</td>
                    <td><MetricChip metric={p.scoreMetric} strong /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function RiskRegisterCard({ report }: { report: Report }) {
  const idx = report.riskRegister.provenanceIndex;
  return (
    <div className="card">
      <h2>Risk register & provenance</h2>
      <p className="sub">Every number on this page carries a provenance seal — here is the mix.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "10px 0" }}>
        {Object.values(Provenance).map((seal) => (
          <span
            key={seal}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "var(--cl-surface-2)",
              borderRadius: 999,
              padding: "3px 10px",
              fontSize: 13,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: SEAL_UI[seal].color, display: "inline-block" }} />
            {SEAL_UI[seal].label}: <strong>{idx.bySeal[seal]}</strong>
          </span>
        ))}
        <span className="muted" style={{ fontSize: 13, alignSelf: "center" }}>({idx.total} metrics total)</span>
      </div>

      {report.riskRegister.hardFlags.length > 0 && (
        <>
          <h3 style={{ fontSize: 15, marginBottom: 4 }}>Active hard flags</h3>
          <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
            {report.riskRegister.hardFlags.map((f, i) => (
              <li key={`${f.key}-${i}`}>
                <strong>{f.label}</strong>
                {f.detailMetric?.note ? <span className="muted"> — {f.detailMetric.note}</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 style={{ fontSize: 15, marginBottom: 4 }}>Model assumptions</h3>
      <ul style={{ margin: "0 0 12px", paddingLeft: 18 }} className="muted">
        {report.riskRegister.assumptions.map((a, i) => (
          <li key={i} style={{ fontSize: 13 }}>{a}</li>
        ))}
      </ul>

      <h3 style={{ fontSize: 15, marginBottom: 4 }}>Live risks to re-check</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }} className="muted">
        {report.riskRegister.liveRisksToRecheck.map((a, i) => (
          <li key={i} style={{ fontSize: 13 }}>{a}</li>
        ))}
      </ul>
    </div>
  );
}
