"use client";

/**
 * "Marcus posts a protocol" — the parse-and-verify flow (the ADR's shown-once,
 * live-but-safe capability). Paste protocol text → Claude parses it into typed
 * Criterion[] → verify/correct the low-confidence rows → post. Without an API key
 * the parse falls back to the cached verified criteria (clearly labelled), so the
 * flow always works. Correcting a flagged row on screen is the trust moment.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Criterion } from "@/lib/matcher/types";
import type { BaseFit } from "@/lib/matcher/types";
import { stampBaseFit, summarizeBaseFit } from "@/lib/basefit/registry";
import { compileEstimatorProtocol } from "@/lib/estimator/protocol";
import { HERO_PROTOCOL_TEXT, HERO_META } from "@/data/hero-protocol";
import { TopBar } from "@/components/ui";
import { IntakePanel, TrustChip, type IntakeResultClient } from "./IntakePanel";
import type { Provenance } from "@/lib/intake";
import type { ElasticsearchQueryPlan } from "@/lib/elasticsearch/types";

interface ParseResult {
  criteria: Criterion[];
  source: "claude" | "cached" | "deterministic" | "structured";
  model?: string;
  note: string;
}

/**
 * Read an error message off a failed response, tolerating a NON-JSON body — a
 * 401 from the Basic-Auth gate (text/plain), or a 502/504 gateway page (HTML)
 * on a slow upstream. Without this, `(await res.json())` on those bodies throws
 * a second, cryptic "Unexpected token" SyntaxError that masks the real HTTP
 * status, and the caller appears to silently do nothing. Mirrors the hardening
 * already in IntakePanel.post.
 */
async function errorFrom(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return (body && typeof body.error === "string" && body.error) || `${fallback} (HTTP ${res.status})`;
}

interface CtGovFetchResult {
  protocol: {
    nctId: string;
    title: string;
    eligibilityCriteria: string;
    sponsor: string | null;
    sourceUrl: string;
  };
  source: "live" | "cached";
  note: string;
}

export default function NewConsultationPage() {
  const router = useRouter();
  const [text, setText] = useState(HERO_PROTOCOL_TEXT);
  const [title, setTitle] = useState<string>(HERO_META.title);
  const [nct, setNct] = useState<string>(HERO_META.nct);
  // True only while `text` is known to actually correspond to `nct` (freshly
  // fetched, or the untouched default) — a manual edit un-trusts it so the
  // no-API-key fallback can't attach an unrelated trial's cached criteria to
  // whatever the user just typed. See src/lib/parse.ts.
  const [textMatchesNct, setTextMatchesNct] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [rows, setRows] = useState<Criterion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [nctInput, setNctInput] = useState<string>(HERO_META.nct);
  const [fetchingCt, setFetchingCt] = useState(false);
  const [ctResult, setCtResult] = useState<CtGovFetchResult | null>(null);

  const [generatingElastic, setGeneratingElastic] = useState(false);
  const [elasticsearchPlan, setElasticsearchPlan] = useState<ElasticsearchQueryPlan | null>(null);
  const [elasticsearchReviewed, setElasticsearchReviewed] = useState(false);

  // Provenance of the last universal-intake ingest (which format, how, trust tier).
  const [provenance, setProvenance] = useState<Provenance | null>(null);

  /**
   * Route an /api/intake result into the existing flow's two lanes:
   *  - preParsedCriteria (structured) → jump straight to the verify table
   *  - eligibilityText (document/registry) → prefill the parse step
   */
  function handleIntake(r: IntakeResultClient) {
    setError(null);
    setProvenance(r.provenance);
    setElasticsearchPlan(null);
    setElasticsearchReviewed(false);
    setCtResult(null); // supersede any prior classic CT.gov fetch banner
    if (r.metadata.title) setTitle(r.metadata.title);

    const fromCtGov = r.metadata.sourceRegistry === "clinicaltrials.gov";
    setNct(fromCtGov ? r.metadata.sourceId : "");

    if (r.preParsedCriteria && r.preParsedCriteria.length > 0) {
      // Structured lane — no LLM parse; the verify table is the trust moment.
      const criteria = stampBaseFit(r.preParsedCriteria);
      setText(r.eligibilityText ?? "");
      setRows(criteria);
      setResult({
        criteria,
        source: "structured",
        note: "Criteria imported from a structured source and ready for review.",
      });
      setTextMatchesNct(false);
    } else {
      // Document / registry lane — hand the eligibility text to the parse step.
      setText(r.eligibilityText ?? "");
      setRows([]);
      setResult(null);
      setTextMatchesNct(fromCtGov);
    }
  }

  async function fetchFromCtGov() {
    setFetchingCt(true);
    setError(null);
    try {
      const res = await fetch("/api/ctgov", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nctId: nctInput }),
      });
      if (!res.ok) throw new Error(await errorFrom(res, "ClinicalTrials.gov fetch failed"));
      const r = (await res.json()) as CtGovFetchResult;
      setCtResult(r);
      setProvenance(null); // supersede any prior universal-intake provenance badge
      setText(r.protocol.eligibilityCriteria);
      if (r.protocol.title) setTitle(r.protocol.title);
      setNct(r.protocol.nctId);
      setTextMatchesNct(true);
      setResult(null);
      setRows([]);
      setElasticsearchPlan(null);
      setElasticsearchReviewed(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFetchingCt(false);
    }
  }

  async function parse() {
    setParsing(true);
    setError(null);
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, nctId: textMatchesNct ? nct : undefined }),
      });
      if (!res.ok) throw new Error(await errorFrom(res, "parse failed"));
      const r = (await res.json()) as ParseResult;
      setResult(r);
      setRows(r.criteria);
      setElasticsearchPlan(null);
      setElasticsearchReviewed(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  function updateRow(i: number, patch: Partial<Criterion>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setElasticsearchPlan(null);
    setElasticsearchReviewed(false);
  }
  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, j) => j !== i));
    setElasticsearchPlan(null);
    setElasticsearchReviewed(false);
  }

  async function generateElasticsearchPlan() {
    setGeneratingElastic(true);
    setError(null);
    try {
      const res = await fetch("/api/elasticsearch-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ criteria: rows }),
      });
      if (!res.ok) throw new Error(await errorFrom(res, "Elasticsearch query generation failed"));
      setElasticsearchPlan(await res.json() as ElasticsearchQueryPlan);
      setElasticsearchReviewed(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGeneratingElastic(false);
    }
  }

  async function post() {
    setPosting(true);
    setError(null);
    try {
      const res = await fetch("/api/consultations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          nct,
          protocolText: text,
          criteria: rows,
          elasticsearchPlan: elasticsearchPlan && elasticsearchReviewed
            ? { ...elasticsearchPlan, reviewedAt: new Date().toISOString() }
            : undefined,
          heroBottleneckHandle: HERO_META.heroBottleneckHandle,
        }),
      });
      if (!res.ok) throw new Error(await errorFrom(res, "post failed"));
      const { id } = (await res.json()) as { id: string };
      router.push(`/reports/${encodeURIComponent(id)}`);
    } catch (e) {
      setError((e as Error).message);
      setPosting(false);
    }
  }

  return (
    <>
      <TopBar active="sponsor" />
      <main className="wrap">
        <h1 style={{ marginBottom: 2 }}>Post a consultation — bring your protocol in any format</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Upload a document, paste a registry id, or drop in structured eligibility. We detect the
          format and extract machine-checkable rules; you verify before posting.{" "}
          <Link href="/sponsor">← back</Link>
        </p>

        <IntakePanel onResult={handleIntake} onError={setError} />

        {provenance && (
          <div className="privacy" style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="lock">📥</span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <strong style={{ textTransform: "capitalize" }}>{provenance.adapter}</strong> · {provenance.extraction}
              <div className="muted" style={{ fontSize: 12 }}>{provenance.note}</div>
            </div>
            <TrustChip trust={provenance.trust} />
          </div>
        )}

        <div className="card">
          <h2>Alternative · classic ClinicalTrials.gov fetch</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
            Same as the Registry ID mode in Step 1 — pulls the eligibility text straight from a
            real NCT record. Kept as the one-field shortcut.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={nctInput}
              onChange={(e) => setNctInput(e.target.value)}
              placeholder="NCT03529110"
              style={{ ...selStyle, width: 160 }}
            />
            <button className="btn soft" onClick={fetchFromCtGov} disabled={fetchingCt || !nctInput.trim()}>
              {fetchingCt ? "Fetching…" : "Fetch protocol →"}
            </button>
          </div>
          {ctResult && (
            <div className="privacy" style={{ marginTop: 10 }}>
              <span className="lock">{ctResult.source === "live" ? "🌐" : "📦"}</span>
              <div>
                <strong>{ctResult.source === "live" ? "Fetched live" : "Cached fallback"}.</strong>{" "}
                {ctResult.note}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <h2>Step 2 · Protocol text</h2>
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setTextMatchesNct(false); }}
            spellCheck={false}
            style={{
              width: "100%", minHeight: 180, background: "var(--panel-2)",
              color: "var(--text)", border: "1px solid var(--border)",
              borderRadius: 8, padding: 12, fontFamily: "ui-monospace, monospace", fontSize: 13,
            }}
          />
          <div style={{ marginTop: 10 }}>
            <button className="cl-btn cl-btn--primary" onClick={parse} disabled={parsing || !text.trim()}>
              {parsing ? "Extracting…" : "Extract eligibility criteria →"}
            </button>
          </div>
          {!textMatchesNct && (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              This text has changed since the last registry fetch. Parse it again before continuing;
              a previously validated version is only used while the source remains unchanged.
            </p>
          )}
        </div>

        {error && (
          <div className="card" style={{ borderColor: "var(--danger)" }}>
            <strong style={{ color: "var(--danger)" }}>Error:</strong> {error}
          </div>
        )}

        {result && (
          <>
            <div className="card">
              <h2>Step 3 · Review eligibility criteria</h2>
              <div className="privacy" style={{ marginBottom: 10 }}>
                <span className="lock">{result.source === "claude" ? "🤖" : result.source === "structured" ? "🧬" : "📦"}</span>
                <div>
                  <strong>
                    {result.source === "claude"
                      ? "Extracted from protocol text"
                      : result.source === "structured"
                        ? "Imported from structured eligibility"
                        : "Loaded from a previously validated protocol"}
                    .
                  </strong>{" "}Review the clinical meaning before building the cohort search plan.
                </div>
              </div>
              {/* Trust-driven flagging: how much of THIS import needs a human. */}
              {(() => {
                const flagged = rows.filter((r) => r.confidence < 0.75).length;
                const trust = provenance?.trust;
                const emphasize = trust === "low" || flagged > 0;
                return (
                  <div
                    style={{
                      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                      marginBottom: 12, padding: "8px 12px", borderRadius: 8,
                      border: `1px solid ${emphasize ? "rgba(180,83,9,0.35)" : "var(--border)"}`,
                      background: emphasize ? "rgba(251,191,36,0.08)" : "var(--panel-2)",
                    }}
                  >
                    {provenance && <TrustChip trust={provenance.trust} />}
                    <span style={{ fontSize: 13 }}>
                      {flagged > 0 ? (
                        <>
                          <strong>{flagged} of {rows.length}</strong> row{flagged === 1 ? "" : "s"} flagged for verification
                          {trust === "low" && " — low-trust source, review every row"}.
                        </>
                      ) : (
                        <>All {rows.length} rows above the confidence threshold — spot-check and post.</>
                      )}
                    </span>
                  </div>
                );
              })()}
              <div style={{ display: "grid", gap: 10 }}>
                {rows.map((criterion, index) => {
                  const low = criterion.confidence < 0.75;
                  return (
                    <article
                      key={criterion.id}
                      style={{
                        border: `1px solid ${low ? "rgba(180,83,9,0.35)" : "var(--border)"}`,
                        borderRadius: 10,
                        padding: 12,
                        background: low ? "rgba(251,191,36,0.06)" : "var(--panel-2)",
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 220 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5, flexWrap: "wrap" }}>
                            <select
                              aria-label={`Criterion ${index + 1} type`}
                              value={criterion.kind}
                              onChange={(event) => updateRow(index, { kind: event.target.value as Criterion["kind"] })}
                              style={selStyle}
                            >
                              <option value="inclusion">Inclusion</option>
                              <option value="exclusion">Exclusion</option>
                            </select>
                            {low && <span className="badge-low">Review needed</span>}
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 650, lineHeight: 1.45 }}>{criterion.rawText}</div>
                          <div className="muted" style={{ fontSize: 12.5, marginTop: 5 }}>
                            Interpreted as: <strong>{criterionInterpretation(criterion)}</strong>
                          </div>
                        </div>
                        <button className="btn soft" aria-label={`Remove criterion ${index + 1}`} onClick={() => removeRow(index)} style={{ padding: "3px 9px" }}>
                          Remove
                        </button>
                      </div>
                      <details style={{ marginTop: 9 }}>
                        <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--muted)" }}>Advanced details</summary>
                        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginTop: 9 }}>
                          <label style={{ fontSize: 12 }}>
                            <span className="muted">Value</span>
                            <input
                              aria-label={`Criterion ${index + 1} value`}
                              value={JSON.stringify(criterion.value)}
                              onChange={(event) => {
                                let value: Criterion["value"];
                                try { value = JSON.parse(event.target.value); } catch { value = event.target.value; }
                                updateRow(index, { value });
                              }}
                              style={{ ...selStyle, display: "block", width: 150, marginTop: 3 }}
                            />
                          </label>
                          <span className="mono" style={{ fontSize: 12 }}>{criterion.field} {criterion.operator}</span>
                          <span className="mono muted" style={{ fontSize: 12 }}>{criterion.unit ?? "no unit"}</span>
                          <BaseFitBadge fit={criterion.baseFit} terms={criterion.nlpTerms} />
                          <span className="muted" style={{ fontSize: 12 }}>confidence {criterion.confidence.toFixed(2)}</span>
                        </div>
                      </details>
                    </article>
                  );
                })}
              </div>
              <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
                Removing or editing a criterion invalidates any previously generated cohort plan.
              </p>
            </div>

            <ElasticsearchPlanCard
              rows={rows}
              plan={elasticsearchPlan}
              busy={generatingElastic}
              disabled={rows.length === 0}
              onGenerate={generateElasticsearchPlan}
              reviewed={elasticsearchReviewed}
              onReviewedChange={setElasticsearchReviewed}
            />

            <div className="card">
              <h2>Step 5 · Post</h2>
              <div className="grid2">
                <label style={{ fontSize: 13 }}>
                  <div className="muted">Title</div>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...selStyle, width: "100%" }} />
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="muted">NCT reference</div>
                  <input value={nct} onChange={(e) => setNct(e.target.value)} style={{ ...selStyle, width: "100%" }} />
                </label>
              </div>
              <div style={{ marginTop: 12 }}>
                <button className="cl-btn cl-btn--primary" onClick={post} disabled={posting || rows.length === 0 || !elasticsearchPlan || !elasticsearchReviewed}>
                  {posting ? "Posting…" : `Post consultation (${rows.length} criteria) →`}
                </button>
              </div>
              {!elasticsearchPlan && <p className="muted" style={{ fontSize: 12.5 }}>Generate and review the Elasticsearch funnel before posting.</p>}
              {elasticsearchPlan && !elasticsearchReviewed && <p className="muted" style={{ fontSize: 12.5 }}>Confirm the automatic, assisted and manual-review stages in Step 4 before posting.</p>}
            </div>
          </>
        )}
      </main>
    </>
  );
}

function ElasticsearchPlanCard({
  rows, plan, busy, disabled, onGenerate, reviewed, onReviewedChange,
}: {
  rows: Criterion[];
  plan: ElasticsearchQueryPlan | null;
  busy: boolean;
  disabled: boolean;
  onGenerate: () => void;
  reviewed: boolean;
  onReviewedChange: (reviewed: boolean) => void;
}) {
  const compiled = compileEstimatorProtocol("preview", rows);
  const baseFit = summarizeBaseFit(rows);
  const counts = plan?.stages.reduce((acc, stage) => {
    acc[stage.automation] += 1;
    return acc;
  }, { AUTOMATED: 0, ASSISTED: 0, MANUAL_REVIEW: 0 } as Record<"AUTOMATED" | "ASSISTED" | "MANUAL_REVIEW", number>);
  return (
    <div className="card">
      <h2>Step 4 · Review cohort search plan</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
        See which criteria can be applied automatically and which still need clinical confirmation.
      </p>
      <div className="privacy" style={{ marginBottom: 10, alignItems: "flex-start" }}>
        <span className="lock">🧭</span>
        <div style={{ fontSize: 12.5 }}>
          <strong>{compiled.coverage.applied} of {compiled.coverage.total}</strong> criteria can enter the initial estimate ·{" "}
          {baseFit.viaNlp} need text-assisted evidence · {baseFit.needReview} need manual confirmation.
          {compiled.coverage.applied < compiled.coverage.total && (
            <div className="muted" style={{ marginTop: 2 }}>Results remain explicitly partial until the remaining criteria are confirmed.</div>
          )}
        </div>
      </div>
      <button className="cl-btn cl-btn--primary" onClick={onGenerate} disabled={busy || disabled}>
        {busy ? "Building and validating…" : plan ? "Rebuild cohort search plan ↻" : "Build cohort search plan →"}
      </button>
      {plan && (
        <>
          <div className="privacy" style={{ marginTop: 12, marginBottom: 10 }}>
            <span className="lock">{plan.source === "claude" ? "🤖" : "🛡️"}</span>
            <div>
              <strong>{plan.stages.length} validated stages.</strong>{" "}
              {plan.source === "claude"
                ? "The plan was generated from the reviewed criteria and passed structural validation."
                : "A validated local plan was built from the reviewed criteria."}
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                {counts?.AUTOMATED ?? 0} automatic · {counts?.ASSISTED ?? 0} assisted · {counts?.MANUAL_REVIEW ?? 0} manual review
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {plan.stages.map((stage, index) => (
              <details key={stage.criterionId} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "9px 11px", background: "var(--panel-2)" }}>
                <summary style={{ cursor: "pointer", fontSize: 13 }}>
                  <strong>{index + 1}. {stage.stageType}</strong> · {stage.criterionText}{" "}
                  <AutomationBadge automation={stage.automation} />
                </summary>
                <p className="muted" style={{ fontSize: 12.5 }}>{stage.rationale}</p>
                {stage.limitations.length > 0 && (
                  <ul style={{ margin: "0 0 8px", paddingLeft: 20, color: "var(--muted)", fontSize: 12.5 }}>
                    {stage.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
                  </ul>
                )}
                <details>
                  <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--muted)" }}>Advanced query details</summary>
                  <pre style={{ overflowX: "auto", whiteSpace: "pre-wrap", fontSize: 11.5, marginBottom: 0 }}>
                    {JSON.stringify(stage.query, null, 2)}
                  </pre>
                </details>
              </details>
            ))}
          </div>
          <label style={{ display: "flex", gap: 9, alignItems: "flex-start", marginTop: 12, fontSize: 13, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => onReviewedChange(event.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              I reviewed every stage and understand that assisted and manual-review matches are candidate evidence, not automatic eligibility decisions.
            </span>
          </label>
        </>
      )}
    </div>
  );
}

function criterionInterpretation(criterion: Criterion): string {
  const operator: Record<Criterion["operator"], string> = {
    eq: "=", neq: "≠", lt: "<", lte: "≤", gt: ">", gte: "≥",
    in: "is one of", not_in: "is not one of", exists: "is present",
    not_exists: "is absent", between: "is between",
  };
  const value = criterion.value === null ? "" : Array.isArray(criterion.value)
    ? criterion.value.join(" – ")
    : String(criterion.value);
  return [humanizeField(criterion.field), operator[criterion.operator], value, criterion.unit].filter(Boolean).join(" ");
}

function humanizeField(field: string): string {
  return field.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function AutomationBadge({ automation }: { automation: "AUTOMATED" | "ASSISTED" | "MANUAL_REVIEW" }) {
  const style = automation === "AUTOMATED"
    ? { label: "automatic", bg: "rgba(22,163,74,0.12)", color: "#15803d" }
    : automation === "ASSISTED"
      ? { label: "assisted", bg: "rgba(217,138,43,0.14)", color: "#b45309" }
      : { label: "manual review", bg: "rgba(185,28,28,0.10)", color: "#b91c1c" };
  return (
    <span style={{ background: style.bg, color: style.color, borderRadius: 999, padding: "2px 7px", fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>
      {style.label}
    </span>
  );
}

const selStyle: React.CSSProperties = {
  background: "var(--panel-2)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 13,
};

const BASE_FIT_BADGE: Record<BaseFit, { label: string; bg: string; fg: string }> = {
  checkable: { label: "checkable", bg: "rgba(22,163,74,0.12)", fg: "#15803d" },
  depth: { label: "depth", bg: "rgba(22,163,74,0.12)", fg: "#15803d" },
  nlp_extractable: { label: "needs NLP", bg: "rgba(180,83,9,0.14)", fg: "#b45309" },
  not_answerable: { label: "n/a", bg: "var(--panel-2)", fg: "var(--muted, #888)" },
};

function BaseFitBadge({ fit, terms }: { fit?: BaseFit; terms?: string[] }) {
  const s = BASE_FIT_BADGE[fit ?? "not_answerable"];
  const title = fit === "nlp_extractable" && terms?.length ? `NLP terms: ${terms.join(", ")}` : undefined;
  return (
    <span title={title} style={{ background: s.bg, color: s.fg, borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}
