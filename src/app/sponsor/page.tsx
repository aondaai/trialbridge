import Link from "next/link";
import { buildSponsorView } from "@/lib/sponsor-view";
import { loadConsultations, loadResponses, type StoredConsultation, type StoredResponse } from "@/lib/store";
import { HERO_META } from "@/data/hero-protocol";
import { TopBar, PrivacyBanner, CohortBar, CriterionList } from "@/components/ui";
import { SofteningPanel } from "@/components/SofteningPanel";
import { ModeledFunnelPanel } from "@/components/ModeledFunnelPanel";
import { fetchNationalEstimate } from "@/lib/estimator/client";
import { EstimateRunner } from "@/components/EstimateRunner";
import type { CompiledProtocol } from "@/lib/estimator/protocol";

// Always read the live store (a site may have just submitted).
export const dynamic = "force-dynamic";

function fmt(n: number | "<5"): string {
  return n === "<5" ? "<5" : String(n);
}

type NationalEstimateData = Awaited<ReturnType<typeof fetchNationalEstimate>>;

/** National feasibility card — fed by the Python estimator (DataSUS/OMOP). */
function NationalCard({ national,status,protocol,error,consultationId }: { national: NationalEstimateData;status?:string;protocol?:CompiledProtocol;error?:string;consultationId?:string }) {
  const coverage=protocol?.coverage;
  return (
    <div className="card">
      <h2>First-party supply — observed and statistically characterized</h2>
      {status==="pending"||status==="running" ? <p className="sub">Searching the proprietary base, qualifying depth features, and expanding through DataSUS…</p> : !national ? (
        <>
          <p className="sub">
            {error??"The estimator service isn't reachable right now."}
          </p>
          {process.env.NODE_ENV !== "production" && (
            <p className="muted" style={{ fontSize: 12 }}>
              Start it (<code>uvicorn api:app</code> on port 8421, see <code>.claude/launch.json</code>).
            </p>
          )}
        </>
      ) : national.baseCohort === 0 ? (
        <>
          <p className="sub">
            Standardized estimate over the national DataSUS base for protocol{" "}
            <strong>{national.protocolId}</strong> — source: {national.dataSource}.
          </p>
          <div className="grid2">
            <div>
              <div className="muted" style={{ fontSize: 13 }}>No matching cohort in the connected sample</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 13 }}>
                Observed (direct count, {national.sitesWithData} sites with real data)
              </div>
              <div className="tb-stat" style={{ color: "var(--definite)" }}>
                {national.observedTotal.toLocaleString("en-US")}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Base cohort (DataSUS): {national.baseCohort.toLocaleString("en-US")}
                {national.monthsToFill != null && ` · ≈ ${national.monthsToFill} mo to fill`}
              </div>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            The shipped <code>omop_sample</code> subset has no matching cohort here — connect
            <code> TB_DATASUS_DIR=…/omop_full</code> for the full national figure (~4,588 for the
            HER2+ hero protocol, per the estimator README). Number shown is real, not fabricated.
          </p>
        </>
      ) : (
        <>
          <p className="sub">
            Standardized estimate over the national DataSUS base for protocol{" "}
            <strong>{national.protocolId}</strong> — source: {national.dataSource}.
          </p>
          <div className="grid2">
            <div>
              <div className="muted" style={{ fontSize: 13 }}>Statistically characterized DataSUS population</div>
              <div className="tb-stat" style={{ color: "var(--brand)" }}>
                {Math.round(national.estimatedN).toLocaleString("en-US")}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                95% CI {Math.round(national.ciLo).toLocaleString("en-US")}–
                {Math.round(national.ciHi).toLocaleString("en-US")}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 13 }}>
                Observed (direct count, {national.sitesWithData} sites with real data)
              </div>
              <div className="tb-stat tb-stat--sm" style={{ color: "var(--definite)" }}>
                {national.observedTotal.toLocaleString("en-US")}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Base cohort (DataSUS): {national.baseCohort.toLocaleString("en-US")}
                {national.monthsToFill != null && ` · ≈ ${national.monthsToFill} mo to fill`}
              </div>
            </div>
          </div>
        </>
      )}
      {national && <div style={{marginTop:14}}><div className="muted" style={{fontSize:13}}>Observed proprietary finding — full 6.68M base</div><div className="tb-stat tb-stat--sm" style={{color:"var(--definite)"}}>{(national.proprietaryFindingTotal??0).toLocaleString("en-US")}</div><div className="muted" style={{fontSize:12}}>{national.proprietaryFindingBySite?.length??0} hospitals with matching aggregate cells · checkable criteria only</div></div>}
      {coverage&&<p className="muted" style={{fontSize:12}}>Coverage: {coverage.applied} of {coverage.total} criteria applied{coverage.applied<coverage.total?" · partial estimate":""}</p>}
      {consultationId&&national&&<p className="no-print"><Link className="cl-btn cl-btn--primary" href={`/scorecard?view=engine&c=${consultationId}`}>Open feasibility report →</Link></p>}
    </div>
  );
}

/**
 * The search database — every consultation Marcus has posted, newest first,
 * with how many sites have responded to each. The active one is highlighted;
 * clicking a row re-opens that search (?c=id).
 */
function ConsultationsCard({
  consultations,
  responses,
  activeId,
}: {
  consultations: StoredConsultation[];
  responses: StoredResponse[];
  activeId?: string;
}) {
  if (consultations.length === 0) return null;
  const respondedCount = (id: string) => responses.filter((r) => r.consultationId === id).length;
  const sorted = [...consultations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="card">
      <h2>Your posted protocols — search database</h2>
      <p className="sub">
        Every consultation you have posted, newest first. Open one to see its responses and softening.
      </p>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Posted</th>
              <th>Protocol</th>
              <th>NCT</th>
              <th className="num">Criteria</th>
              <th className="num">Sites responded</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((k) => {
              const active = k.id === activeId;
              return (
                <tr key={k.id} style={active ? { background: "rgba(217,119,87,0.08)" } : undefined}>
                  <td className="mono muted" style={{ whiteSpace: "nowrap" }}>{k.createdAt.slice(0, 10)}</td>
                  <td>
                    {k.title}
                    {active && <span className="badge-low" style={{ marginLeft: 6 }}>viewing</span>}
                  </td>
                  <td className="mono muted">{k.nct || "—"}</td>
                  <td className="num">{k.criteria.length}</td>
                  <td className="num">{respondedCount(k.id)}</td>
                  <td className="num">
                    {!active && (
                      <Link href={`/sponsor?c=${k.id}`} className="no-print">
                        open →
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function SponsorPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const view = (await buildSponsorView(c || HERO_META.id)) ?? (await buildSponsorView(HERO_META.id));
  // National feasibility from the Python estimator (DataSUS/OMOP). Null when the
  // estimator service is offline — the card renders an honest offline state.
  const national = view
    ? (view.consultation.estimateResult?.protocolId===view.consultation.id?view.consultation.estimateResult:null)
    : await fetchNationalEstimate();
  // The full search database — every posted consultation + all responses (counts only).
  const [allConsultations, allResponses] = await Promise.all([loadConsultations(), loadResponses()]);
  if (!view) {
    return (
      <>
        <TopBar active="sponsor" />
        <main className="wrap">
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <h1 style={{ marginBottom: 2 }}>Sponsor console</h1>
              <p className="muted" style={{ marginTop: 0 }}>
                No protocol posted yet — post one to see site responses and softening.
              </p>
            </div>
            <Link href="/sponsor/new" className="cl-btn cl-btn--secondary no-print" style={{ flexShrink: 0 }}>
              + Post from protocol text
            </Link>
          </div>
          <PrivacyBanner variant="sponsor" />
          <ConsultationsCard consultations={allConsultations} responses={allResponses} />
          <NationalCard national={national} />
        </main>
      </>
    );
  }

  const { consultation, responded, waitingOn, totals, feasibility, softening, modeledFunnel, regions } = view;

  return (
    <>
      <TopBar active="sponsor" />
      <main className="wrap">
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h1 style={{ marginBottom: 2 }}>{consultation.title}</h1>
            <p className="muted" style={{ marginTop: 0 }}>
              Posted by {consultation.sponsorName}
              {consultation.nct ? ` · ref ${consultation.nct}` : ""}
            </p>
          </div>
          <Link href="/sponsor/new" className="cl-btn cl-btn--secondary no-print" style={{ flexShrink: 0 }}>
            + Post from protocol text
          </Link>
        </div>

        <PrivacyBanner variant="sponsor" />

        <ConsultationsCard consultations={allConsultations} responses={allResponses} activeId={consultation.id} />

        <EstimateRunner consultationId={consultation.id} status={consultation.estimateResult?.protocolId===consultation.id?consultation.estimateStatus:"pending"}/>
        <NationalCard national={national} status={consultation.estimateStatus} protocol={consultation.estimateProtocol} error={consultation.estimateError} consultationId={consultation.id}/>

        {/* Aggregated responses */}
        <div className="card">
          <h2>Responding sites — aggregated candidate counts</h2>
          <p className="sub">
            {responded.length} site{responded.length === 1 ? "" : "s"} responded
            {waitingOn.length > 0 && ` · waiting on ${waitingOn.join(", ")}`}
          </p>
          {responded.some(r=>!r.live)&&<p className="muted" style={{fontSize:12}}>Rows marked demo come from the local seeded matcher and are not used for the proprietary finding or DataSUS national estimate above.</p>}
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Mix</th>
                  <th className="num">Definite</th>
                  <th className="num">Possible</th>
                  <th className="num">Candidates</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {responded.map((r) => (
                  <tr key={r.siteId}>
                    <td>
                      {r.siteName}
                      {r.live && <span className="badge-low" style={{ background: "var(--definite)", color: "#062" }}>live</span>}
                      {!r.live && <span className="badge-low" style={{marginLeft:6}}>demo</span>}
                    </td>
                    <td style={{ width: 160 }}>
                      <CohortBar
                        definite={typeof r.definite === "number" ? r.definite : 3}
                        possible={typeof r.possible === "number" ? r.possible : 3}
                        excluded={1}
                      />
                    </td>
                    <td className="num">{fmt(r.definite)}</td>
                    <td className="num">{fmt(r.possible)}</td>
                    <td className="num">
                      <strong>{fmt(r.candidates)}</strong>
                    </td>
                    <td className="num">
                      <Link href={`/scorecard?site=${r.siteId}&c=${consultation.id}`} className="no-print">
                        scorecard →
                      </Link>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td></td>
                  <td className="num">
                    <strong>{fmt(totals.definite)}</strong>
                  </td>
                  <td className="num">
                    <strong>{fmt(totals.possible)}</strong>
                  </td>
                  <td className="num">
                    <strong>{fmt(totals.candidates)}</strong>
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Softening — hero moment */}
        <div className="card">
          <h2>Protocol softening — what loosening a criterion would do</h2>
          <SofteningPanel softening={softening} heroHandle={consultation.heroBottleneckHandle} />
        </div>

        {/* Deliverable estimate — funnel + rate */}
        <div className="card">
          <h2>Deliverable estimate — not the raw count</h2>
          <p className="sub">
            A chart match is an upper bound. Discounted for the screen-to-enrol
            funnel (×{feasibility.screenToEnroll}) and projected over an incident
            enrolment window, capacity reads as a rate.
          </p>
          <div className="grid2">
            <div>
              <div className="muted" style={{ fontSize: 13 }}>Screening pool now (match ≠ enrollable)</div>
              <div className="tb-stat tb-stat--sm">{feasibility.screeningPool}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 13 }}>
                ≈ enrollable over {feasibility.months} months
              </div>
              <div className="tb-stat" style={{ color: "var(--brand)" }}>~{feasibility.enrollableEstimate}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                incl. ~{feasibility.incidentOverWindow} incident patients across the window
              </div>
            </div>
          </div>
        </div>

        {/* Regional breakdown — responding sites grouped by Brazilian macro-region */}
        <div className="card">
          <h2>Breakdown by region (Brazil)</h2>
          <p className="sub">
            Same candidate pool, grouped by macro-region instead of by site —
            {" "}<Link href={`/scorecard?view=brasil&c=${consultation.id}`} className="no-print">open as a national scorecard →</Link>
          </p>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Region</th>
                  <th className="num">Sites</th>
                  <th className="num">Definite</th>
                  <th className="num">Possible</th>
                  <th className="num">Candidates</th>
                  <th className="num">Monthly incidence</th>
                  <th className="num">≈ enrollable / 6mo</th>
                </tr>
              </thead>
              <tbody>
                {regions.map((r) => (
                  <tr key={r.region}>
                    <td>{r.region}</td>
                    <td className="num">{r.siteCount}</td>
                    <td className="num">{fmt(r.definite)}</td>
                    <td className="num">{fmt(r.possible)}</td>
                    <td className="num">
                      <strong>{fmt(r.candidates)}</strong>
                    </td>
                    <td className="num">{r.monthlyIncidence}/mo</td>
                    <td className="num">
                      <strong>~{r.feasibility.enrollableEstimate}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {regions.length <= 1 && (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Only one region responding so far — this table becomes useful once sites
              from more than one macro-region are live.
            </p>
          )}
        </div>

        {/* Modeled-prevalence funnel — only for protocols with not-evaluable gating criteria */}
        {modeledFunnel && (
          <div className="card">
            <h2>Addressable vs. biomarker-eligible — what the data can and can&apos;t prove</h2>
            <ModeledFunnelPanel view={modeledFunnel} />
          </div>
        )}

        {/* Parsed criteria read-back */}
        <div className="card">
          <h2>Protocol criteria (parsed &amp; verified)</h2>
          <p className="sub">The deterministic matcher scores every patient against exactly these rules.</p>
          <CriterionList criteria={consultation.criteria} />
        </div>
      </main>
    </>
  );
}
