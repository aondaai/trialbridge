import Link from "next/link";
import { buildSponsorView } from "@/lib/sponsor-view";
import { HERO_META } from "@/data/hero-protocol";
import { TopBar, PrivacyBanner, CohortBar, CriterionList } from "@/components/ui";
import { SofteningPanel } from "@/components/SofteningPanel";

// Always read the live store (a site may have just submitted).
export const dynamic = "force-dynamic";

function fmt(n: number | "<5"): string {
  return n === "<5" ? "<5" : String(n);
}

export default async function SponsorPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const view = buildSponsorView(c || HERO_META.id) ?? buildSponsorView(HERO_META.id);
  if (!view) {
    return (
      <>
        <TopBar active="sponsor" />
        <main className="wrap">
          <p>No consultation seeded. Run <code>npm run db:seed</code>.</p>
        </main>
      </>
    );
  }

  const { consultation, responded, waitingOn, totals, feasibility, softening } = view;

  return (
    <>
      <TopBar active="sponsor" />
      <main className="wrap">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
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
                      <Link href={`/scorecard?site=${r.siteId}`} className="no-print">
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

        {/* Softening — hero moment */}
        <div className="card">
          <h2>Protocol softening — what loosening a criterion would do</h2>
          <SofteningPanel softening={softening} heroHandle={consultation.heroBottleneckHandle} />
        </div>

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
