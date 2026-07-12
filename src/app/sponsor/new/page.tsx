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
import { summarizeBaseFit } from "@/lib/basefit/registry";
import { compileEstimatorProtocol } from "@/lib/estimator/protocol";
import { HERO_PROTOCOL_TEXT, HERO_META } from "@/data/hero-protocol";
import { TopBar } from "@/components/ui";
import { IntakePanel, TrustChip, type IntakeResultClient } from "./IntakePanel";
import type { Provenance } from "@/lib/intake";

interface ParseResult {
  criteria: Criterion[];
  source: "claude" | "cached" | "structured";
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

  const [showQueryPlan, setShowQueryPlan] = useState(false);

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
    setShowQueryPlan(false);
    setCtResult(null); // supersede any prior classic CT.gov fetch banner
    if (r.metadata.title) setTitle(r.metadata.title);

    const fromCtGov = r.metadata.sourceRegistry === "clinicaltrials.gov";
    setNct(fromCtGov ? r.metadata.sourceId : "");

    if (r.preParsedCriteria && r.preParsedCriteria.length > 0) {
      // Structured lane — no LLM parse; the verify table is the trust moment.
      setText(r.eligibilityText ?? "");
      setRows(r.preParsedCriteria);
      setResult({
        criteria: r.preParsedCriteria,
        source: "structured",
        note: `Structured import via ${r.provenance.adapter} — skipped the LLM parse. ${r.provenance.note ?? ""}`,
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
      setShowQueryPlan(false);
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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  function updateRow(i: number, patch: Partial<Criterion>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, j) => j !== i));
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
              {parsing ? "Parsing…" : "Parse with Claude →"}
            </button>
          </div>
          {!textMatchesNct && (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              Text edited since the last fetch — without <code>ANTHROPIC_API_KEY</code> this
              can only be parsed live; it won&apos;t silently fall back to another trial&apos;s cached criteria.
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
              <h2>Step 3 · Verify {result.source === "structured" ? "imported" : "parsed"} criteria</h2>
              <div className="privacy" style={{ marginBottom: 10 }}>
                <span className="lock">{result.source === "claude" ? "🤖" : result.source === "structured" ? "🧬" : "📦"}</span>
                <div>
                  <strong>
                    {result.source === "claude"
                      ? `Parsed by ${result.model}`
                      : result.source === "structured"
                        ? "Structured import — no LLM parse"
                        : "Cached parse"}
                    .
                  </strong>{" "}
                  {result.note}
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
                    {(() => {
                      const bf = summarizeBaseFit(rows);
                      return (
                        <span style={{ fontSize: 12.5, opacity: 0.85, width: "100%" }}>
                          <strong>{bf.answerableToday + bf.viaNlp} of {bf.total}</strong> answerable against your base
                          ({bf.answerableToday} today, {bf.viaNlp} via NLP extraction); {bf.needReview} need review.
                        </span>
                      );
                    })()}
                  </div>
                );
              })()}
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Kind</th><th>Field</th><th>Op</th><th>Value</th><th>Unit</th><th>Base fit</th><th>Conf.</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const low = r.confidence < 0.75;
                      return (
                        <tr key={r.id} style={low ? { background: "rgba(251,191,36,0.08)" } : undefined}>
                          <td>
                            <select
                              value={r.kind}
                              onChange={(e) => updateRow(i, { kind: e.target.value as Criterion["kind"] })}
                              style={selStyle}
                            >
                              <option value="inclusion">inclusion</option>
                              <option value="exclusion">exclusion</option>
                            </select>
                          </td>
                          <td className="mono">{r.field}</td>
                          <td className="mono">{r.operator}</td>
                          <td>
                            <input
                              value={JSON.stringify(r.value)}
                              onChange={(e) => {
                                let v: Criterion["value"];
                                try { v = JSON.parse(e.target.value); } catch { v = e.target.value; }
                                updateRow(i, { value: v });
                              }}
                              style={{ ...selStyle, width: 120 }}
                            />
                          </td>
                          <td className="mono muted">{r.unit ?? "—"}</td>
                          <td><BaseFitBadge fit={r.baseFit} terms={r.nlpTerms} /></td>
                          <td className="num">
                            {low ? <span className="badge-low">{r.confidence.toFixed(2)} · verify</span> : r.confidence.toFixed(2)}
                          </td>
                          <td>
                            <button className="btn soft" onClick={() => removeRow(i)} style={{ padding: "2px 8px" }}>✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
                Highlighted rows are low-confidence — the parser flagged them for a human. Fix a value and it flows straight into the deterministic matcher.
              </p>
            </div>

            <QueryPlanCard rows={rows} open={showQueryPlan} onToggle={() => setShowQueryPlan((v) => !v)} />

            <div className="card">
              <h2>Step 4 · Post</h2>
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
                <button className="cl-btn cl-btn--primary" onClick={post} disabled={posting || rows.length === 0}>
                  {posting ? "Posting…" : `Post consultation (${rows.length} criteria) →`}
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}

function queryPlanMeta(c: Criterion): { source: string; method: string; status: string } {
  switch (c.baseFit) {
    case "checkable":
      return {
        source: "Proprietary + DataSUS",
        method: c.field === "diagnosis" || c.field === "dx" ? "CID-10 cohort" : "structured demographic",
        status: "included",
      };
    case "depth":
      return { source: "Proprietary", method: "validated depth feature", status: "included" };
    case "nlp_extractable":
      return { source: "Proprietary DuckDB", method: "clinical-text proxy", status: "NLP proxy pending" };
    default:
      return { source: "Site", method: "site confirmation", status: "not in initial estimate" };
  }
}

function QueryPlanCard({ rows, open, onToggle }: { rows: Criterion[]; open: boolean; onToggle: () => void }) {
  const compiled = compileEstimatorProtocol("preview", rows);
  const applied = new Map(compiled.criteria.map((c) => [c.id, c]));
  const omitted = new Map(compiled.coverage.omitted.map((c) => [c.id, c.reason]));
  const bf = summarizeBaseFit(rows);
  return (
    <div className="card">
      <h2>Step 3b · Data coverage &amp; query plan</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
        Preview which source and method will answer each verified criterion after posting.
        DataSUS/OMOP translation is automatic inside its compiler; proprietary finding runs over DuckDB.
      </p>
      <div className="privacy" style={{ marginBottom: 10, alignItems: "flex-start" }}>
        <span className="lock">🧭</span>
        <div style={{ fontSize: 12.5 }}>
          <strong>{compiled.coverage.applied} of {compiled.coverage.total}</strong> criteria enter the initial estimate ·{" "}
          {bf.viaNlp} searchable by DuckDB text proxy · {bf.needReview} require site confirmation or review.
          {compiled.coverage.applied < compiled.coverage.total && (
            <div className="muted" style={{ marginTop: 2 }}>The national result will be labeled partial until omitted criteria are resolved.</div>
          )}
        </div>
      </div>
      <button className="btn soft" onClick={onToggle} disabled={rows.length === 0}>
        {open ? "Hide query plan ↑" : "Review query plan →"}
      </button>
      {open && (
        <div className="table-scroll" style={{ marginTop: 10 }}>
          <table className="data">
            <thead><tr><th>Criterion</th><th>Source</th><th>Method</th><th>Query detail</th><th>Initial calculation</th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const meta = queryPlanMeta(c);
                const compiledCriterion = applied.get(c.id);
                const detail = compiledCriterion?.field === "dx"
                  ? `CID-10 concept: ${JSON.stringify(compiledCriterion.value)}`
                  : c.baseFit === "nlp_extractable" && c.nlpTerms?.length
                    ? c.nlpTerms.join(", ")
                    : `${c.field} ${c.operator} ${JSON.stringify(c.value)}`;
                return (
                  <tr key={c.id}>
                    <td>{c.rawText}</td><td>{meta.source}</td><td>{meta.method}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{detail}</td>
                    <td>{compiledCriterion ? <span>✅ included</span> : <span className="badge-low">{omitted.get(c.id) ?? meta.status}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
        Posting saves this verified plan, then starts proprietary finding, depth qualification and DataSUS expansion.
      </p>
    </div>
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
