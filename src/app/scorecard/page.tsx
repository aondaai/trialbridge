import Link from "next/link";
import { loadSite, loadAllSites } from "@/lib/data/sites";
import { getConsultation } from "@/lib/store";
import { evaluateDataset, regionBreakdown } from "@/lib/service";
import { rankBottlenecks } from "@/lib/matcher/soften";
import { estimateFeasibility } from "@/lib/feasibility";
import { HERO_META } from "@/data/hero-protocol";
import { TopBar, CohortBar, CohortLegend } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { buildReport, ctgovToKolInputs } from "@/lib/report/buildReport";
import { EngineReport } from "@/components/report/EngineReport";
import { fetchCompetition } from "@/lib/ctgov/competition";
import { applyEnrichment } from "@/lib/kol/enrich";
import { enrichmentsForNames } from "@/lib/kol/enrichmentStore";
import { loadDirectory } from "@/lib/sites/loadDirectory";
import { crossReferenceInvestigators } from "@/lib/sites/crossref";
import { infraForCnes } from "@/lib/sites/infraStore";

export const dynamic = "force-dynamic";

function fmt(n: number | "<5"): string {
  return n === "<5" ? "<5" : String(n);
}

/** Derive a CT.gov condition search from a protocol title (free-text query.cond). */
function conditionQuery(title: string): string {
  const t = title.toLowerCase();
  if (/breast/.test(t)) return "breast cancer";
  if (/nsclc|lung/.test(t)) return "non-small cell lung cancer";
  if (/melanoma/.test(t)) return "melanoma";
  if (/colorectal|\bcrc\b/.test(t)) return "colorectal cancer";
  // Fallback: strip a leading "Phase … —" and any parenthetical, else the raw title.
  return title.replace(/^phase\s+[ivx]+\s*[—-]\s*/i, "").replace(/\([^)]*\)/g, "").trim() || title;
}

function protocolPhase(title: string): string {
  const t=title.toLowerCase();
  if(/phase\s*1\s*\/\s*1b|phase\s*i\s*\/\s*ib/.test(t)) return "I/Ib";
  if(/phase\s*1\s*\/\s*2|phase\s*i\s*\/\s*ii/.test(t)) return "I/II";
  if(/phase\s*3|phase\s*iii/.test(t)) return "III";
  if(/phase\s*2|phase\s*ii/.test(t)) return "II";
  if(/phase\s*1b|phase\s*ib/.test(t)) return "Ib";
  if(/phase\s*1|phase\s*i/.test(t)) return "I";
  return "Not specified";
}

/** Build a `/scorecard` query string, dropping empty params. */
function scorecardHref(params: { c?: string; view?: string; site?: string }): string {
  const sp = new URLSearchParams();
  if (params.c) sp.set("c", params.c);
  if (params.view) sp.set("view", params.view);
  if (params.site) sp.set("site", params.site);
  const qs = sp.toString();
  return qs ? `/scorecard?${qs}` : "/scorecard";
}

export default async function ScorecardPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; view?: string; c?: string }>;
}) {
  const { site, view, c } = await searchParams;
  const consultation = await getConsultation(c ?? HERO_META.id);

  if (!consultation) {
    return (
      <>
        <TopBar active="reports" />
        <main className="wrap">
          <p>
            {c
              ? <>No consultation found for id <code>{c}</code>.</>
              : <>No open consultation yet. Post a protocol from the <a href="/sponsor/new">sponsor console</a>.</>}
          </p>
        </main>
      </>
    );
  }

  if (view === "engine") {
    const nationalEstimate = consultation.estimateResult ?? null;
    if (!nationalEstimate || nationalEstimate.protocolId !== consultation.id) {
      const coverage = consultation.estimateProtocol?.coverage;
      return (
        <><TopBar active="reports"/><main className="wrap">
          <h1>Feasibility report — quantitative layer not ready</h1>
          <div className="card">
            <h2>Decision and ranking are withheld</h2>
            <p className="sub">TrialBridge does not convert unavailable supply into a measured zero. A validated diagnosis/CID cohort is required before proprietary finding and statistical transport to DataSUS can support scores, forecasts or a go/no-go recommendation.</p>
            <p><strong>Status:</strong> {consultation.estimateStatus ?? "pending"}</p>
            {consultation.estimateError && <p className="badge-low">{consultation.estimateError}</p>}
            {coverage && <p className="muted">Coverage: {coverage.applied} of {coverage.total} criteria compiled · {coverage.nlpPending} NLP pending · {coverage.manualReview} require review.</p>}
            <p className="no-print"><Link className="cl-btn cl-btn--secondary" href={`/sponsor?c=${consultation.id}`}>Return to consultation →</Link></p>
          </div>
        </main></>
      );
    }
    const allSites = await loadAllSites();
    const evaluatedSites = allSites.map((ds) => evaluateDataset(ds, consultation.criteria));
    // Web/registry grounding runs only after the first-party quantitative spine is valid.
    const condition = conditionQuery(consultation.title);
    const competition = await fetchCompetition(condition);

    // Deep-web KOL enrichment (publications, society roles, guideline authorship) is
    // PRECOMPUTED by `npm run enrich-kols` (the Parallel Task API takes ~1 min/physician,
    // too slow to block a render). The page reads that store instantly; investigators
    // without a precomputed entry stay trial-experience-only.
    const directory = loadDirectory();
    let kolInvestigators = competition.source === "live" ? ctgovToKolInputs(competition) : [];
    if (kolInvestigators.length > 0) {
      // Cross-reference affiliations against the ABRACRO/ACESSE directory → real CNES,
      // accurate region, and a confirmed institutional link (lifts the KOL score).
      kolInvestigators = crossReferenceInvestigators(kolInvestigators, directory).investigators;
      // Apply precomputed deep-web enrichment (pubs/society/guideline), if present.
      const enrichments = enrichmentsForNames(kolInvestigators.map((k) => k.name));
      kolInvestigators = applyEnrichment(kolInvestigators, enrichments);
    }

    const report = buildReport(
      {
        id: consultation.id,
        title: consultation.title,
        sponsorName: consultation.sponsorName,
        nct: consultation.nct,
        criteria: consultation.criteria,
      },
      evaluatedSites,
      {
        runId: consultation.id,
        displayPhase: protocolPhase(consultation.title),
        competition,
        nationalEstimate,
        kolInvestigators,
        directorySites: directory,
        // Real infra (Part B) for the oncology sites, from the precomputed store.
        siteInfraByCnes: infraForCnes(directory.filter((s) => s.oncology).map((s) => s.cnes)),
      },
    );

    return (
      <>
        <TopBar active="reports" />
        <main className="wrap">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <h1 style={{ margin: 0 }}>Feasibility & site scorecard</h1>
            <PrintButton />
          </div>
          <p className="muted" style={{ marginTop: 4 }}>
            Country + site decision report ·{" "}
            <Link href={scorecardHref({ c })} className="no-print">per-site scorecard →</Link>{" "}
            <Link href={scorecardHref({ view: "brasil", c })} className="no-print">· regional breakdown →</Link>
          </p>
          {nationalEstimate && (
            <div className="card">
              <h2>Three-view first-party supply</h2>
              <div className="grid2">
                <div><div className="muted">Coorte Proprietária Observada</div><div className="tb-stat tb-stat--sm">{(nationalEstimate.proprietaryFindingTotal??0).toLocaleString("en-US")}</div><div className="muted">across {nationalEstimate.proprietaryFindingBySite?.length??0} hospitals · aggregate, localizable supply</div></div>
                <div><div className="muted">População DataSUS Estatisticamente Caracterizada</div><div className="tb-stat">{Math.round(nationalEstimate.estimatedN).toLocaleString("en-US")}</div><div className="muted">transported aggregate estimate · 95% CI {Math.round(nationalEstimate.ciLo).toLocaleString("en-US")}–{Math.round(nationalEstimate.ciHi).toLocaleString("en-US")}</div></div>
              </div>
              <div className="table-scroll" style={{marginTop:12}}><table className="data"><thead><tr><th>Hospital code</th><th className="num">With diagnosis</th><th className="num">Checkable match</th></tr></thead><tbody>{(nationalEstimate.proprietaryFindingBySite??[]).map(s=><tr key={s.site}><td><strong className="mono">{s.site}</strong></td><td className="num">{s.withDiagnosis.toLocaleString("en-US")}</td><td className="num"><strong>{s.findingN.toLocaleString("en-US")}</strong></td></tr>)}</tbody></table></div>
              <p className="muted" style={{fontSize:12}}>Hospitals remain pseudonymized by their proprietary source codes. CNES resolution is intentionally deferred and is not required for this production release.</p>
              <p className="muted" style={{fontSize:12}}>No individual linkage is performed. The proprietary SUS slice calibrates aggregate characteristics transported to the observed DataSUS population; it is not added to the DataSUS total.</p>
            </div>
          )}
          <EngineReport report={report} />
          <p className="muted" style={{ fontSize: 12 }}>
            Generated by TrialBridge (Elegível). Counts only — no patient rows.
            {nationalEstimate ? " Proprietary observed aggregates + statistically characterized DataSUS population; " : " Synthetic/de-identified fallback; "}{consultation.sourceNote}
          </p>
        </main>
      </>
    );
  }

  if (view === "brasil") {
    const allSites = await loadAllSites();
    const evaluatedSites = allSites.map((ds) => evaluateDataset(ds, consultation.criteria));
    const regions = regionBreakdown(evaluatedSites);
    const totalDefinite = evaluatedSites.reduce((s, e) => s + e.counts.definite, 0);
    const totalPossible = evaluatedSites.reduce((s, e) => s + e.counts.possible, 0);

    return (
      <>
        <TopBar active="reports" />
        <main className="wrap">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <h1 style={{ margin: 0 }}>Feasibility scorecard — Brazil, by region</h1>
            <PrintButton />
          </div>
          <p className="muted" style={{ marginTop: 4 }}>
            {allSites.length} site{allSites.length === 1 ? "" : "s"} across{" "}
            {regions.length} region{regions.length === 1 ? "" : "s"} ·{" "}
            <Link href={scorecardHref({ c })} className="no-print">per-site scorecard →</Link>
          </p>

          <div className="card">
            <h2>{consultation.title}</h2>
            <p className="sub">
              Sponsor {consultation.sponsorName} · ref {consultation.nct}
            </p>
            <div style={{ margin: "12px 0" }}>
              <CohortBar
                definite={totalDefinite}
                possible={totalPossible}
                excluded={evaluatedSites.reduce((s, e) => s + e.counts.excluded, 0)}
              />
              <CohortLegend />
            </div>
          </div>

          <div className="card">
            <h2>Candidate pool by region</h2>
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
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Each region here is currently a single site — the breakdown becomes
              a real multi-site rollup as more sites per region come online.
            </p>
          </div>

          <p className="muted" style={{ fontSize: 12 }}>
            Generated by TrialBridge (Elegível). Counts only — no patient rows.
            Synthetic/de-identified data; {consultation.sourceNote}
          </p>
        </main>
      </>
    );
  }

  const allSites = await loadAllSites();
  const siteId = site ?? allSites[0]?.site.id;
  const ds = siteId ? await loadSite(siteId) : null;
  if (!ds) {
    return (
      <>
        <TopBar active="reports" />
        <main className="wrap">
          <p>
            No site data available yet.{" "}
            <a href="/site/new">List a site</a> and upload its patient
            records to generate a scorecard.
          </p>
        </main>
      </>
    );
  }
  const evaluated = evaluateDataset(ds, consultation.criteria);
  const { counts } = evaluated;
  const bottleneck = rankBottlenecks(ds.patients, consultation.criteria)[0];
  const feas = estimateFeasibility({
    definite: counts.definite,
    possible: counts.possible,
    monthlyIncidence: ds.site.monthlyIncidence,
    months: 6,
  });

  return (
    <>
      <TopBar active="reports" />
      <main className="wrap">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0 }}>Feasibility scorecard</h1>
          <PrintButton />
        </div>
        <p className="muted" style={{ marginTop: 4 }}>
          {ds.site.name} — {ds.site.city}, {ds.site.region} ·{" "}
          <Link href={scorecardHref({ view: "brasil", c })} className="no-print">national breakdown →</Link>{" "}
          <Link href={scorecardHref({ view: "engine", c })} className="no-print">· full country + site report →</Link>
        </p>

        <div className="card">
          <h2>{consultation.title}</h2>
          <p className="sub">
            Sponsor {consultation.sponsorName} · ref {consultation.nct}
          </p>
          <div style={{ margin: "12px 0" }}>
            <CohortBar definite={counts.definite} possible={counts.possible} excluded={counts.excluded} />
            <CohortLegend />
          </div>
        </div>

        <div className="grid2">
          <div className="card">
            <h2>Candidate pool</h2>
            <table className="data">
              <tbody>
                <tr><td>Confirmed-eligible (definite)</td><td className="num"><strong>{counts.definite}</strong></td></tr>
                <tr><td>Possible (needs a test/confirmation)</td><td className="num"><strong>{counts.possible}</strong></td></tr>
                <tr><td>Screening pool</td><td className="num">{counts.definite + counts.possible}</td></tr>
                <tr><td>Records reviewed</td><td className="num">{counts.total}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <h2>Deliverable estimate</h2>
            <table className="data">
              <tbody>
                <tr><td>Monthly incidence (rate)</td><td className="num">{ds.site.monthlyIncidence}/mo</td></tr>
                <tr><td>Incident over 6 months</td><td className="num">{feas.incidentOverWindow}</td></tr>
                <tr><td>Screen-to-enrol funnel</td><td className="num">×{feas.screenToEnroll}</td></tr>
                <tr><td>≈ enrollable over 6 months</td><td className="num"><strong>~{feas.enrollableEstimate}</strong></td></tr>
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              A chart match is an upper bound — this is discounted and rate-aware.
            </p>
          </div>
        </div>

        <div className="card">
          <h2>Biggest bottleneck</h2>
          <p>
            The criterion limiting this site most is{" "}
            <strong>{bottleneck?.label}</strong> — relaxing it would add{" "}
            {bottleneck ? bottleneck.newlyDefinite + bottleneck.newlyPossible : 0} candidates
            ({bottleneck?.newlyDefiniteFromUnknown ?? 0} of them only because the field is currently unknown).
          </p>
        </div>

        <p className="muted" style={{ fontSize: 12 }}>
          Generated by TrialBridge (Elegível). Counts only — no patient rows.
          Synthetic/de-identified data; {consultation.sourceNote}
        </p>
      </main>
    </>
  );
}
