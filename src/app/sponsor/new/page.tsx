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
import type { OmopCriterion } from "@/lib/omop/types";
import { HERO_PROTOCOL_TEXT, HERO_META } from "@/data/hero-protocol";
import { TopBar } from "@/components/ui";

interface ParseResult {
  criteria: Criterion[];
  source: "claude" | "cached";
  model?: string;
  note: string;
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

  const [omopRows, setOmopRows] = useState<OmopCriterion[] | null>(null);
  const [mappingOmop, setMappingOmop] = useState(false);

  async function fetchFromCtGov() {
    setFetchingCt(true);
    setError(null);
    try {
      const res = await fetch("/api/ctgov", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nctId: nctInput }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "ClinicalTrials.gov fetch failed");
      const r = (await res.json()) as CtGovFetchResult;
      setCtResult(r);
      setText(r.protocol.eligibilityCriteria);
      if (r.protocol.title) setTitle(r.protocol.title);
      setNct(r.protocol.nctId);
      setTextMatchesNct(true);
      setResult(null);
      setRows([]);
      setOmopRows(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFetchingCt(false);
    }
  }

  async function mapToOmop() {
    setMappingOmop(true);
    setError(null);
    try {
      const res = await fetch("/api/omop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ criteria: rows }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "OMOP mapping failed");
      const { omopCriteria } = (await res.json()) as { omopCriteria: OmopCriterion[] };
      setOmopRows(omopCriteria);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMappingOmop(false);
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
      if (!res.ok) throw new Error((await res.json()).error ?? "parse failed");
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
      if (!res.ok) throw new Error((await res.json()).error ?? "post failed");
      const { id } = (await res.json()) as { id: string };
      router.push(`/sponsor?c=${id}`);
    } catch (e) {
      setError((e as Error).message);
      setPosting(false);
    }
  }

  return (
    <>
      <TopBar active="sponsor" />
      <main className="wrap">
        <h1 style={{ marginBottom: 2 }}>Post a consultation from protocol text</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Paste eligibility criteria. Claude parses them into machine-checkable
          rules; you verify before posting. <Link href="/sponsor">← back</Link>
        </p>

        <div className="card">
          <h2>0 · Fetch from ClinicalTrials.gov (optional)</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
            Pull the eligibility text straight from a real NCT record instead of pasting it.
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
          <h2>1 · Protocol text</h2>
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
            <button className="btn primary" onClick={parse} disabled={parsing || !text.trim()}>
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
              <h2>2 · Verify parsed criteria</h2>
              <div className="privacy" style={{ marginBottom: 12 }}>
                <span className="lock">{result.source === "claude" ? "🤖" : "📦"}</span>
                <div>
                  <strong>{result.source === "claude" ? `Parsed by ${result.model}` : "Cached parse"}.</strong>{" "}
                  {result.note}
                </div>
              </div>
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Kind</th><th>Field</th><th>Op</th><th>Value</th><th>Unit</th><th>Conf.</th><th></th>
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

            <div className="card">
              <h2>2b · OMOP mapping preview</h2>
              <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
                Codes each criterion to an OMOP CDM domain/table + vocabulary — the shape a
                future matcher needs to query real OMOP databases (DataSUS, DoctorAssistant
                NLP→OMOP) instead of only the synthetic patients. Preview only — posting still
                sends the criteria as today.
              </p>
              <button className="btn soft" onClick={mapToOmop} disabled={mappingOmop || rows.length === 0}>
                {mappingOmop ? "Mapping…" : "Map to OMOP →"}
              </button>
              {omopRows && (
                <div className="table-scroll" style={{ marginTop: 10 }}>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Field</th><th>Domain</th><th>Table</th><th>Vocabulary</th>
                        <th>Concept</th><th>Assertion</th><th>Mapped?</th>
                      </tr>
                    </thead>
                    <tbody>
                      {omopRows.map((o) => (
                        <tr key={o.criterionId}>
                          <td className="mono">{o.sourceField}</td>
                          <td>{o.concept.domain}</td>
                          <td className="mono">{o.concept.table}</td>
                          <td>{o.concept.vocabularyId}</td>
                          <td className="mono">
                            {o.concept.needsMapping ? "0 (unmapped)" : o.concept.conceptId}
                          </td>
                          <td className="mono">{o.assertion}</td>
                          <td>
                            {o.concept.verified ? (
                              <span>✅ verified</span>
                            ) : (
                              <span className="badge-low">⏳ needs mapping</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
                See <code>docs/omop-vocabulary-mapping.md</code> for which concepts are verified vs. placeholder, and why.
              </p>
            </div>

            <div className="card">
              <h2>3 · Post</h2>
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
                <button className="btn primary" onClick={post} disabled={posting || rows.length === 0}>
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

const selStyle: React.CSSProperties = {
  background: "var(--panel-2)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 13,
};
