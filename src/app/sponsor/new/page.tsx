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
import { HERO_PROTOCOL_TEXT, HERO_META } from "@/data/hero-protocol";
import { TopBar } from "@/components/ui";

interface ParseResult {
  criteria: Criterion[];
  source: "claude" | "cached";
  model?: string;
  note: string;
}

export default function NewConsultationPage() {
  const router = useRouter();
  const [text, setText] = useState(HERO_PROTOCOL_TEXT);
  const [title, setTitle] = useState<string>(HERO_META.title);
  const [nct, setNct] = useState<string>(HERO_META.nct);
  const [parsing, setParsing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [rows, setRows] = useState<Criterion[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function parse() {
    setParsing(true);
    setError(null);
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
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
          <h2>1 · Protocol text</h2>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
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
