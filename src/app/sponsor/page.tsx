import Link from "next/link";
import { buildSponsorView } from "@/lib/sponsor-view";
import { HERO_META } from "@/data/hero-protocol";
import { TopBar, PrivacyBanner, CohortBar, CriterionList } from "@/components/ui";
import { SofteningPanel } from "@/components/SofteningPanel";
import { ModeledFunnelPanel } from "@/components/ModeledFunnelPanel";
import { fetchNationalEstimate } from "@/lib/estimator/client";

// Always read the live store (a site may have just submitted).
export const dynamic = "force-dynamic";

function fmt(n: number | "<5"): string {
  return n === "<5" ? "<5" : String(n);
}

type NationalEstimateData = Awaited<ReturnType<typeof fetchNationalEstimate>>;

/** National feasibility card — fed by the Python estimator (DataSUS/OMOP). */
function NationalCard({ national }: { national: NationalEstimateData }) {
  return (
    <div className="card">
      <h2>National feasibility estimate — DataSUS via estimator</h2>
      {!national ? (
        <>
          <p className="sub">
            The national estimator service isn't reachable right now — the standardized DataSUS estimate will appear here once it's back online.
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
              <div className="stat" style={{ color: "var(--definite)" }}>
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
              <div className="muted" style={{ fontSize: 13 }}>Estimated eligible (national)</div>
              <div className="stat" style={{ color: "var(--brand)" }}>
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
              <div className="stat small" style={{ color: "var(--definite)" }}>
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
  const national = await fetchNationalEstimate();
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
            <Link href="/sponsor/new" className="btn no-print" style={{ flexShrink: 0 }}>
              + Post from protocol text
            </Link>
          </div>
          <PrivacyBanner variant="sponsor" />
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
          <Link href="/sponsor/new" className="btn no-print" style={{ flexShrink: 0 }}>
            + Post from protocol text
          </Link>
        </div>

        <PrivacyBanner variant="sponsor" />

        <NationalCard national={national} />

        {/* Aggregated responses */}
        <div className="card">
          <h2>Responding sites — aggregated candidate counts</h2>
          <p className="sub">
            {responded.length} site{responded.length === 1 ? "" : "s"} responded
            {waitingOn.length > 0 && ` · waiting on ${waitingOn.join(", ")}`}
          </p>
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
              <div className="stat small">{feasibility.screeningPool}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 13 }}>
                ≈ enrollable over {feasibility.months} months
              </div>
              <div className="stat" style={{ color: "var(--brand)" }}>~{feasibility.enrollableEstimate}</div>
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
