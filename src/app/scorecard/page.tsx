import Link from "next/link";
import { loadSite, loadAllSites } from "@/lib/data/sites";
import { getConsultation } from "@/lib/store";
import type { ReportPipelineKey, ReportPipelineProgress, StoredConsultation } from "@/lib/store";
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
import { buildSiteRegistryLandscape, siteFeasibilityQueryFromProtocol } from "@/lib/site-feasibility";
import { hasCandidateValidationCohort } from "@/lib/report/release";

export const dynamic = "force-dynamic";

function fmt(n: number | "<5"): string {
  return n === "<5" ? "<5" : String(n);
}

function englishRegion(region: string): string {
  return ({ Norte: "North", Nordeste: "Northeast", "Centro-Oeste": "Central-West", Sudeste: "Southeast", Sul: "South" } as Record<string, string>)[region] ?? region;
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

const PIPELINE_LABELS: Partial<Record<ReportPipelineKey, string>> = {
  regulatory: "Regulatory",
  "competitive-intensity": "Competitive intensity",
  "site-kol-discovery": "Site and KOL discovery",
  "standard-of-care": "Standard of care",
  representativeness: "Representativeness",
  "eligibility-realism": "Eligibility realism",
};

function PartialEvidencePipeline({ pipeline }: { pipeline: ReportPipelineProgress }) {
  const label = PIPELINE_LABELS[pipeline.key] ?? pipeline.key;
  return (
    <article style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <h3 style={{ margin: 0 }}>{label}</h3>
        <span className="mono muted" style={{ fontSize: 12 }}>{pipeline.status}</span>
      </div>
      {pipeline.summary
        ? <p style={{ fontSize: 13.5, lineHeight: 1.55 }}>{pipeline.summary}</p>
        : <p className="muted" style={{ fontSize: 13 }}>{pipeline.status === "queued" || pipeline.status === "running" ? "Evidence collection is still in progress." : "No usable evidence was returned."}</p>}
      {!!pipeline.citations?.length && (
        <details>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>{pipeline.citations.length} source{pipeline.citations.length === 1 ? "" : "s"}</summary>
          <ul style={{ fontSize: 12, paddingLeft: 18 }}>
            {pipeline.citations.map((citation, index) => (
              <li key={`${citation.url}-${index}`}><a href={citation.url} target="_blank" rel="noreferrer">{citation.title}</a></li>
            ))}
          </ul>
        </details>
      )}
      {pipeline.error && <p className="badge-low" style={{ fontSize: 12 }}>{pipeline.error}</p>}
    </article>
  );
}

function PartialFeasibilityReport({ consultation }: { consultation: StoredConsultation }) {
  const estimate = consultation.estimateResult!;
  const coverage = consultation.estimateProtocol?.coverage;
  const evidencePipelines = (consultation.reportRun?.pipelines ?? [])
    .filter((pipeline) => pipeline.key !== "first-party-supply");
  const finishedPipelines = evidencePipelines.filter((pipeline) => ["complete", "partial", "failed"].includes(pipeline.status)).length;
  const usablePipelines = evidencePipelines.filter((pipeline) => ["complete", "partial"].includes(pipeline.status)).length;
  return (
    <><TopBar active="reports"/><main className="wrap">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <p className="muted" style={{ margin: "0 0 4px", fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>Full evidence review · quantitative validation pending</p>
          <h1 style={{ margin: 0 }}>Feasibility &amp; site scorecard</h1>
        </div>
        <PrintButton />
      </div>
      <p className="muted">{consultation.title}{consultation.nct ? ` · ${consultation.nct}` : ""} · evidence available as of {estimate.asOf ?? consultation.estimatedAt ?? "the latest run"}</p>

      <section className="card">
        <p className="muted" style={{ margin: "0 0 4px", fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>01 · Decision snapshot</p>
        <h2>Proceed to clinical candidate validation</h2>
        <p className="sub"><strong>Conditional operational recommendation:</strong> proceed with source-site clinical validation of the proprietary candidate cohort.</p>
        <p>This report can support evidence review and validation planning. It must not be used as a country go/no-go decision.</p>
        <div style={{ padding: 12, borderRadius: 8, background: "var(--cl-warning-subtle, #fff7e6)", border: "1px solid var(--border)" }}>
          <strong>Withheld pending validation:</strong> eligible-patient forecast, uncertainty interval, composite country score, site ranking and final recommendation.
        </div>
      </section>

      <section className="card">
        <p className="muted" style={{ margin: "0 0 4px", fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>02 · Patient supply</p>
        <h2>Observed first-party evidence</h2>
        <div className="grid2">
          <div><div className="muted">DataSUS diagnosis cohort</div><div className="tb-stat tb-stat--sm">{estimate.baseCohort.toLocaleString("en-US")}</div><p className="muted" style={{ fontSize: 12 }}>{estimate.dataSource}</p></div>
          <div><div className="muted">Proprietary candidates for review</div><div className="tb-stat tb-stat--sm">{(estimate.proprietaryFindingTotal ?? 0).toLocaleString("en-US")}</div><p className="muted" style={{ fontSize: 12 }}>{estimate.proprietaryFindingSource ?? "Aggregate proprietary signal"}</p></div>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>These are separate observed signals. No eligibility rate is calculated by dividing one by the other because their denominators are not comparable.</p>
        {estimate.coverageCaveat && <p className="muted" style={{ fontSize: 12 }}>{estimate.coverageCaveat}</p>}
      </section>

      <section className="card">
        <p className="muted" style={{ margin: "0 0 4px", fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>03–08 · Feasibility dimensions</p>
        <h2>Evidence workstreams</h2>
        <p className="sub">{finishedPipelines}/{evidencePipelines.length} workstreams finished · {usablePipelines} usable. Findings and their cited sources are shown below; unavailable evidence is never converted to zero.</p>
        {evidencePipelines.length > 0
          ? <div className="grid2">{evidencePipelines.map((pipeline) => <PartialEvidencePipeline key={pipeline.key} pipeline={pipeline}/>)}</div>
          : <p className="muted">No additional evidence workstreams are attached to this run yet.</p>}
      </section>

      <section className="card">
        <p className="muted" style={{ margin: "0 0 4px", fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>Validation boundary</p>
        <h2>What remains before a scored recommendation</h2>
        {coverage && <p>Protocol coverage: <strong>{coverage.applied} of {coverage.total}</strong> criteria compiled · {coverage.nlpPending} NLP pending · {coverage.manualReview} require clinical review.</p>}
        <p className="muted" style={{ fontSize: 13 }}>After source-site review supplies comparable pass/fail counts and a validated eligibility fraction, this scorecard can release the eligible-patient forecast, uncertainty interval, composite country score, protocol-specific site ranking and final recommendation.</p>
      </section>

      <p className="no-print"><Link className="cl-btn cl-btn--secondary" href={`/sponsor?c=${consultation.id}`}>Return to consultation →</Link></p>
    </main></>
  );
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
    // Older/partial estimator payloads omitted eligibilityFractionApplied. A
    // positive proprietary review cohort is the durable signal that the full
    // evidence report can be released while quantitative scoring stays gated.
    const canReleasePartial = hasCandidateValidationCohort(nationalEstimate);
    if (canReleasePartial) {
      return <PartialFeasibilityReport consultation={consultation}/>;
    }
    if (!nationalEstimate || nationalEstimate.protocolId !== consultation.id || nationalEstimate.eligibilityFractionApplied===false) {
      const coverage = consultation.estimateProtocol?.coverage;
      return (
        <><TopBar active="reports"/><main className="wrap">
          <h1>Feasibility evidence review</h1>
          <div className="card">
            <h2>{nationalEstimate&&!nationalEstimate.eligibilityFractionApplied&&(nationalEstimate.proprietaryFindingTotal??0)>0?"Proceed to clinical candidate validation":"Quantitative layer not ready"}</h2>
            {nationalEstimate&&!nationalEstimate.eligibilityFractionApplied&&(nationalEstimate.proprietaryFindingTotal??0)>0?<>
              <p className="sub"><strong>Conditional operational recommendation:</strong> advance the preselected proprietary cohort to source-site clinical review. This recommendation confirms the next validation step; it is not a country go/no-go score.</p>
              <div className="grid2">
                <div><div className="muted">Observed DataSUS diagnosis cohort</div><div className="tb-stat tb-stat--sm">{nationalEstimate.baseCohort.toLocaleString("en-US")}</div></div>
                <div><div className="muted">Candidates requiring review</div><div className="tb-stat tb-stat--sm">{(nationalEstimate.proprietaryFindingTotal??0).toLocaleString("en-US")}</div></div>
              </div>
              <p className="muted" style={{fontSize:13}}>Eligible-patient forecasts, composite scores and site ranking remain gated until review produces comparable pass/fail counts and a validated eligibility fraction.</p>
            </>:<p className="sub">TrialBridge does not convert unavailable supply into a measured zero. Statistical transport requires a comparable proprietary denominator and a validated eligibility fraction before scores, forecasts or a country go/no-go recommendation are released.</p>}
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
    const displayPhase = protocolPhase(consultation.title);
    const [competition, siteRegistryLandscape] = await Promise.all([
      fetchCompetition(condition),
      buildSiteRegistryLandscape(
        siteFeasibilityQueryFromProtocol({
          condition,
          title: consultation.title,
          nctId: consultation.nct,
          phase: displayPhase,
        }),
        { asOf: nationalEstimate.asOf },
      ),
    ]);

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
        displayPhase,
        competition,
        siteRegistryLandscape,
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
                <div><div className="muted">Observed Proprietary Cohort</div><div className="tb-stat tb-stat--sm">{(nationalEstimate.proprietaryFindingTotal??0).toLocaleString("en-US")}</div><div className="muted">across {nationalEstimate.proprietaryFindingBySite?.length??0} hospitals · aggregate, localizable supply</div></div>
                <div><div className="muted">Statistically Characterized DataSUS Population</div><div className="tb-stat">{Math.round(nationalEstimate.estimatedN).toLocaleString("en-US")}</div><div className="muted">transported aggregate estimate · 95% CI {Math.round(nationalEstimate.ciLo).toLocaleString("en-US")}–{Math.round(nationalEstimate.ciHi).toLocaleString("en-US")}</div></div>
              </div>
              <div className="table-scroll" style={{marginTop:12}}><table className="data"><thead><tr><th>Hospital code</th><th className="num">With diagnosis</th><th className="num">Checkable match</th></tr></thead><tbody>{(nationalEstimate.proprietaryFindingBySite??[]).map(s=><tr key={s.site}><td><strong className="mono">{s.site}</strong></td><td className="num">{s.withDiagnosis.toLocaleString("en-US")}</td><td className="num"><strong>{s.findingN.toLocaleString("en-US")}</strong></td></tr>)}</tbody></table></div>
              <p className="muted" style={{fontSize:12}}>Hospitals remain pseudonymized by their proprietary source codes. CNES resolution is intentionally deferred and is not required for this production release.</p>
              <p className="muted" style={{fontSize:12}}>No individual linkage is performed. The proprietary SUS slice calibrates aggregate characteristics transported to the observed DataSUS population; it is not added to the DataSUS total.</p>
            </div>
          )}
          <EngineReport report={report} />
          <p className="muted" style={{ fontSize: 12 }}>
            Generated by TrialBridge. Counts only — no patient rows.
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
                      <td>{englishRegion(r.region)}</td>
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
            Generated by TrialBridge. Counts only — no patient rows.
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
          {ds.site.name} — {ds.site.city}, {englishRegion(ds.site.region)} ·{" "}
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
          Generated by TrialBridge. Counts only — no patient rows.
          Synthetic/de-identified data; {consultation.sourceNote}
        </p>
      </main>
    </>
  );
}
