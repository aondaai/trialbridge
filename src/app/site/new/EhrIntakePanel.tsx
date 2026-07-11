"use client";
/**
 * Upload a CSV/XLSX EHR export → POST /api/patient-intake → show the column
 * mapping (correctable) + a structured preview + trust. The confirmed
 * Patient[] is written up via `onPatients` so the parent form can carry it in
 * a hidden field for the server action to read.
 */
import { useRef, useState } from "react";
import type { Patient } from "@/lib/matcher/types";
import { TrustChip } from "@/app/sponsor/new/IntakePanel";
import type { MapTarget, PatientIntakeResult } from "@/lib/patient-intake";

const TARGETS: MapTarget[] = [
  "id",
  "diagnosis",
  "stage",
  "priorLines",
  "ecog",
  "sex",
  "age",
  "her2_status",
  "er_status",
  "pr_status",
  "creatinine",
  "hemoglobin",
  "platelets",
  "bilirubin",
  "ejection_fraction",
  "biomarker",
  "ignore",
];

export function EhrIntakePanel({ onPatients }: { onPatients: (p: Patient[]) => void }) {
  const [result, setResult] = useState<PatientIntakeResult | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const lastFile = useRef<File | null>(null);

  async function post(body: BodyInit, headers?: HeadersInit) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/patient-intake", { method: "POST", body, headers });
      const json = await res.json().catch(() => ({ error: `failed (HTTP ${res.status})` }));
      if (!res.ok) throw new Error(json.error ?? "failed");
      const parsed = json as PatientIntakeResult;
      setResult(parsed);
      onPatients(parsed.patients);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function submitFile(f: File | null | undefined) {
    if (!f || busy) return;
    lastFile.current = f;
    const fd = new FormData();
    fd.append("file", f);
    void post(fd);
  }

  function submitText() {
    if (!text.trim() || busy) return;
    lastFile.current = null;
    void post(JSON.stringify({ mode: "text", text }), { "content-type": "application/json" });
  }

  function reMap(column: string, target: string) {
    if (!result) return;
    const override: Record<string, string> = {};
    result.mapping.forEach((m) => {
      override[m.column] = m.column === column ? target : m.target;
    });
    if (lastFile.current) {
      const fd = new FormData();
      fd.append("file", lastFile.current);
      fd.append("override", JSON.stringify(override));
      void post(fd);
    } else {
      void post(JSON.stringify({ mode: "text", text, override }), { "content-type": "application/json" });
    }
  }

  return (
    <div>
      <div
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileRef.current?.click();
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          submitFile(e.dataTransfer.files?.[0]);
        }}
        style={{
          border: "2px dashed var(--border)",
          borderRadius: 10,
          padding: "22px 16px",
          textAlign: "center",
          cursor: "pointer",
          background: "var(--panel-2)",
        }}
      >
        <div style={{ fontSize: 22 }}>📄</div>
        <div style={{ fontWeight: 600 }}>{busy ? "Reading…" : "Drop your EHR export (CSV or XLSX) or click to browse"}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Rows never leave this server.
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.txt"
        style={{ display: "none" }}
        onChange={(e) => {
          submitFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: "pointer", fontSize: 13 }}>…or paste CSV</summary>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          style={{
            width: "100%",
            minHeight: 100,
            marginTop: 6,
            background: "var(--panel-2)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 10,
            fontFamily: "ui-monospace, monospace",
            fontSize: 12,
          }}
        />
        <button type="button" className="btn soft" disabled={busy || !text.trim()} onClick={submitText} style={{ marginTop: 6 }}>
          Structure CSV →
        </button>
      </details>

      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

      {result && (
        <div style={{ marginTop: 14 }}>
          <div className="privacy" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="lock">📄</span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <strong>Structured on this server ({result.provenance.extraction.toUpperCase()}).</strong>{" "}
              <span className="muted" style={{ fontSize: 12 }}>
                {result.provenance.note}
              </span>
            </div>
            <TrustChip trust={result.provenance.trust} />
          </div>
          <div className="table-scroll" style={{ marginTop: 10 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Maps to</th>
                  <th>Sample values</th>
                </tr>
              </thead>
              <tbody>
                {result.mapping.map((m) => (
                  <tr key={m.column}>
                    <td className="mono">{m.column}</td>
                    <td>
                      <select
                        value={m.target}
                        onChange={(e) => reMap(m.column, e.target.value)}
                        style={{
                          background: "var(--panel-2)",
                          color: "var(--text)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          padding: "3px 6px",
                          fontSize: 12,
                        }}
                      >
                        {TARGETS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="mono muted" style={{ fontSize: 12 }}>
                      {m.samples.join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {result.stats.rows} patients structured · {result.stats.cellsUnparsed} cells couldn&apos;t be read and are left{" "}
            <strong>unknown</strong> (the matcher keeps those patients as &ldquo;possible&rdquo;, never wrongly excluded).
          </p>
        </div>
      )}
    </div>
  );
}
