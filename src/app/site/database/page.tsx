import Link from "next/link";
import { loadSite } from "@/lib/data/sites";
import { patientToOmop } from "@/lib/omop/patientOmop";
import { TopBar, PrivacyBanner } from "@/components/ui";

export const dynamic = "force-dynamic";

const SITE_ID_DEFAULT = "site-a";

// Structured columns we surface as the "clinical-trial-ready" schema.
const STRUCTURED_COLUMNS = [
  "id", "diagnosis", "stage", "her2_status", "er_status", "pr_status",
  "ecog", "priorLines", "age", "sex",
] as const;

function cell(v: unknown): string {
  if (v == null || v === "") return "—";
  return String(v);
}

export default async function SiteDatabasePage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const { site } = await searchParams;
  const SITE_ID = site || SITE_ID_DEFAULT;
  const ds = await loadSite(SITE_ID).catch(() => null);

  if (!ds || ds.patients.length === 0) {
    return (
      <>
        <TopBar active="site" />
        <main className="wrap">
          <p style={{ marginBottom: 12 }}><Link href="/site">← Back to your site</Link></p>
          <div className="card">
            <h2>No structured data yet</h2>
            <p className="sub">
              Upload an EHR export first — we structure it, then code it to OMOP here.
            </p>
            <Link href="/site/new" className="cl-btn cl-btn--primary no-print">Upload data →</Link>
          </div>
        </main>
      </>
    );
  }

  const patients = ds.patients;
  const omop = patientToOmop(patients);
  const sample = patients.slice(0, 8);
  const tableOrder = ["person", "condition_occurrence", "measurement", "observation", "drug_exposure"];

  return (
    <>
      <TopBar active="site" />
      <main className="wrap">
        <p style={{ marginBottom: 12 }}><Link href="/site">← Back to your site</Link></p>
        <h1 style={{ marginBottom: 2 }}>Structured database + OMOP — {ds.site.name}</h1>
        <p className="muted" style={{ marginTop: 0, maxWidth: 680 }}>
          Your uploaded records, structured into a clinical-trial-ready schema and coded to the
          OMOP Common Data Model. Everything below stays on your server.
        </p>

        <PrivacyBanner variant="site" />

        {/* ---- Deliverable A: structured clinical database ---- */}
        <div className="card">
          <h2>1 · Structured clinical database</h2>
          <p className="sub">
            {patients.length} patient records normalized into {STRUCTURED_COLUMNS.length} standard
            fields — the messy EHR export becomes a clean, queryable table. Showing the first {sample.length}.
          </p>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>{STRUCTURED_COLUMNS.map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {sample.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.id}</td>
                    <td>{cell(p.diagnosis)}</td>
                    <td>{cell(p.stage)}</td>
                    <td>{cell(p.biomarkers?.her2_status)}</td>
                    <td>{cell(p.biomarkers?.er_status)}</td>
                    <td>{cell(p.biomarkers?.pr_status)}</td>
                    <td>{cell(p.ecog)}</td>
                    <td>{cell(p.priorLines)}</td>
                    <td>{cell(p.age)}</td>
                    <td>{cell(p.sex)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ---- Deliverable B: OMOP CDM coding ---- */}
        <div className="card">
          <h2>2 · OMOP Common Data Model</h2>
          <p className="sub">
            Each source field is mapped to an OMOP domain, CDM table, and vocabulary concept.
            Fields backed by the Athena vocabulary bundle resolve to a real{" "}
            <span className="mono">concept_id</span>; the rest are honestly flagged{" "}
            <em>needs mapping</em> rather than assigned a fabricated code.
          </p>

          <div className="grid2" style={{ margin: "8px 0 14px" }}>
            <div>
              <div className="muted" style={{ fontSize: 13 }}>OMOP CDM rows generated</div>
              <div className="tb-stat" style={{ color: "var(--brand)" }}>{omop.totalRows.toLocaleString()}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                across {omop.personCount} persons · {Object.keys(omop.rowCountsByTable).length} CDM tables
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 13 }}>Fields coded</div>
              <div className="tb-stat" style={{ color: "var(--definite)" }}>
                {omop.mappedFieldCount}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {omop.verifiedFieldCount} with a verified concept_id
              </div>
            </div>
          </div>

          {/* Row counts by CDM table */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {tableOrder
              .filter((t) => omop.rowCountsByTable[t])
              .map((t) => (
                <span key={t} className="chip" style={{ fontSize: 12 }}>
                  <span className="mono">{t}</span> · {omop.rowCountsByTable[t].toLocaleString()}
                </span>
              ))}
          </div>

          {/* Per-field concept coding table */}
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Source field</th>
                  <th>Domain</th>
                  <th>CDM table</th>
                  <th>Vocabulary</th>
                  <th>concept_id</th>
                  <th>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {omop.fields.map((f) => (
                  <tr key={f.sourceField}>
                    <td>{f.label}</td>
                    <td>{f.domain}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{f.table}</td>
                    <td>{f.vocabularyId}</td>
                    <td className="mono">
                      {f.verified ? (
                        <span style={{ color: "var(--definite)" }}>{f.conceptId}</span>
                      ) : (
                        <span className="badge-low">needs mapping</span>
                      )}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {f.patientsWithValue}/{patients.length} ({f.coveragePct}%)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* A few concrete CDM rows */}
          <h3 style={{ margin: "18px 0 6px", fontSize: 15 }}>Sample OMOP CDM rows</h3>
          <p className="sub" style={{ marginTop: 0 }}>
            The first few patients expanded into CDM rows — this is the shape a downstream OMOP tool consumes.
          </p>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>person_id</th>
                  <th>CDM table</th>
                  <th>concept_name</th>
                  <th>vocabulary</th>
                  <th>concept_id</th>
                  <th>value</th>
                </tr>
              </thead>
              <tbody>
                {omop.sampleRows.map((r, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ fontSize: 12 }}>{r.personId}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{r.table}</td>
                    <td style={{ fontSize: 13 }}>{r.conceptName}</td>
                    <td>{r.vocabularyId}</td>
                    <td className="mono">
                      {r.conceptId !== 0 ? (
                        <span style={{ color: "var(--definite)" }}>{r.conceptId}</span>
                      ) : (
                        <span className="muted">0</span>
                      )}
                    </td>
                    <td className="mono muted" style={{ fontSize: 12 }}>{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  );
}
