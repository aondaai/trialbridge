import { getConsultation, loadResponses } from "@/lib/store";
import { loadSite } from "@/lib/data/sites";
import { evaluateDataset } from "@/lib/service";
import { HERO_META } from "@/data/hero-protocol";
import { estimateFeasibility } from "@/lib/feasibility";
import { TopBar, PrivacyBanner, Chip, CohortLegend, CriterionResultList } from "@/components/ui";
import { submitCapacity, withdrawCapacity } from "./actions";
import type { Cohort } from "@/lib/matcher/types";

export const dynamic = "force-dynamic";

export default async function SitePage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; site?: string }>;
}) {
  const { c, site } = await searchParams;
  // This screen is Camila's site by default — same persona, any consultation.
  const SITE_ID = site || "site-a";
  const consultation = await getConsultation(c || HERO_META.id);
  if (!consultation) {
    return (
      <>
        <TopBar active="site" />
        <main className="wrap">
          <p>
            No open consultation yet. A sponsor needs to post a protocol first —
            head to the <a href="/sponsor/new">sponsor console</a>.
          </p>
        </main>
      </>
    );
  }

  const ds = await loadSite(SITE_ID);
  if (!ds) {
    return (
      <>
        <TopBar active="site" />
        <main className="wrap">
          <p>
            No site found for <code>{SITE_ID}</code>. A site needs to be listed
            (with its patient records uploaded) before it can respond —{" "}
            <a href="/site/new">List your site →</a>
          </p>
        </main>
      </>
    );
  }
  const evaluated = evaluateDataset(ds, consultation.criteria);
  const { counts } = evaluated;
  const responsesForConsultation = await loadResponses(consultation.id);
  const alreadySubmitted = responsesForConsultation.some((r) => r.siteId === SITE_ID);
  const feas = estimateFeasibility({
    definite: counts.definite,
    possible: counts.possible,
    monthlyIncidence: ds.site.monthlyIncidence,
    months: 6,
  });

  // A few example patients per cohort so a viewer can explain any verdict in 10s.
  const example = (cohort: Cohort) => evaluated.evals.find((e) => e.cohort === cohort);
  const examples = [example("definite"), example("possible"), example("excluded")].filter(Boolean);

  return (
    <>
      <TopBar active="site" />
      <main className="wrap">
        <h1 style={{ marginBottom: 2 }}>Open consultation for {ds.site.name}</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          {ds.site.city}, {ds.site.country}{ds.site.persona ? ` · ${ds.site.persona}` : ""}
        </p>

        <PrivacyBanner variant="site" />

        {/* The consultation Camila discovered */}
        <div className="card">
          <h2>{consultation.title}</h2>
          <p className="sub">
            Posted by {consultation.sponsorName} · ref {consultation.nct}
          </p>
        </div>

        {/* Private matcher run */}
        <div className="card">
          <h2>Matched against your patients ({counts.total} records)</h2>
          <p className="sub">
            Deterministic, criterion-by-criterion — no black box. Row-level detail
            below is visible to you only.
          </p>
          <div className="grid2" style={{ marginBottom: 8 }}>
            <div>
              <div className="muted" style={{ fontSize: 13 }}>Confirmed / possible / excluded</div>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginTop: 4 }}>
                <span className="tb-stat" style={{ color: "var(--definite)" }}>{counts.definite}</span>
                <span className="tb-stat tb-stat--sm" style={{ color: "var(--possible)" }}>{counts.possible}</span>
                <span className="tb-stat tb-stat--sm muted">{counts.excluded}</span>
              </div>
              <CohortLegend />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 13 }}>≈ enrollable over 6 months (funnel-discounted)</div>
              <div className="tb-stat" style={{ color: "var(--brand)" }}>~{feas.enrollableEstimate}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {counts.definite + counts.possible} screening pool · {ds.site.monthlyIncidence}/mo incident
              </div>
            </div>
          </div>
        </div>

        {/* Auditable per-patient breakdown */}
        <div className="card">
          <h2>Why each patient did or didn&apos;t match</h2>
          <p className="sub">One example per cohort. Every rule shows the source sentence and the observed value.</p>
          {examples.map((e) => (
            <div key={e!.patientId} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 4 }}>
                <Chip cohort={e!.cohort} />
                <span className="mono muted" style={{ fontSize: 13 }}>{e!.patientId}</span>
              </div>
              <CriterionResultList results={e!.results} />
            </div>
          ))}
        </div>

        {/* Submit / withdraw */}
        <div className="card">
          <h2>Proof of capacity</h2>
          {alreadySubmitted ? (
            <>
              <p>
                <Chip cohort="definite">submitted</Chip> Your aggregate counts are now
                visible to the sponsor — <strong>no patient rows left this site</strong>.
              </p>
              <form action={withdrawCapacity}>
                <input type="hidden" name="consultationId" value={consultation.id} />
                <input type="hidden" name="siteId" value={SITE_ID} />
                <button className="btn soft no-print" type="submit">Withdraw (reset demo)</button>
              </form>
            </>
          ) : (
            <>
              <p className="sub">
                Submits only counts + your bottleneck criterion — same-day, one click.
              </p>
              <form action={submitCapacity}>
                <input type="hidden" name="consultationId" value={consultation.id} />
                <input type="hidden" name="siteId" value={SITE_ID} />
                <button className="cl-btn cl-btn--primary" type="submit">Submit proof of capacity →</button>
              </form>
            </>
          )}
        </div>
      </main>
    </>
  );
}
