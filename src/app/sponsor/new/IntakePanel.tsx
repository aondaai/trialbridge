"use client";

/**
 * The universal intake panel (Phase 5) — the "bring your protocol, any format"
 * front door. Four input modes (file upload / registry id / paste / structured)
 * all POST to /api/intake, which runs the SourceAdapter registry. The result is
 * handed up via `onResult`; the parent routes the two lanes (eligibilityText →
 * parse+verify; preParsedCriteria → straight to the verify table).
 *
 * Also renders the "what you can bring" showcase so the sponsor SEES the full
 * range of supported entrances.
 */

import { useRef, useState } from "react";
import type { Criterion } from "@/lib/matcher/types";
import type { ProtocolMeta, Provenance } from "@/lib/intake";

export interface IntakeResultClient {
  metadata: ProtocolMeta;
  eligibilityText?: string;
  preParsedCriteria?: Criterion[];
  provenance: Provenance;
}

type Mode = "file" | "id" | "text" | "json";

const MODES: { key: Mode; icon: string; label: string }[] = [
  { key: "file", icon: "📎", label: "Upload a file" },
  { key: "id", icon: "🔖", label: "Registry ID" },
  { key: "text", icon: "📋", label: "Paste text" },
  { key: "json", icon: "🧬", label: "Structured JSON" },
];

const FORMATS: { icon: string; name: string; hint: string; trust: Provenance["trust"] }[] = [
  { icon: "🔖", name: "ClinicalTrials.gov", hint: "NCT id → live registry fetch", trust: "high" },
  { icon: "🇪🇺", name: "EU CTR", hint: "EudraCT number (YYYY-NNNNNN-CC)", trust: "high" },
  { icon: "🧬", name: "FHIR EvidenceVariable", hint: "coded eligibility → skips the LLM", trust: "high" },
  { icon: "📄", name: "Protocol PDF / DOCX", hint: "we locate the eligibility section", trust: "medium" },
  { icon: "📝", name: "Synopsis / pasted text", hint: "bullets or prose", trust: "medium" },
  { icon: "📊", name: "XLSX matrix", hint: "one row per criterion", trust: "medium" },
  { icon: "🧩", name: "ATLAS cohort JSON", hint: "OHDSI cohort → approximate", trust: "medium" },
  { icon: "📦", name: "IND / eCTD package", hint: ".zip → Module 5 protocol", trust: "low" },
];

const TRUST_STYLE: Record<Provenance["trust"], { bg: string; fg: string; label: string }> = {
  high: { bg: "rgba(22,163,74,0.12)", fg: "#16a34a", label: "high trust" },
  medium: { bg: "rgba(251,191,36,0.14)", fg: "#b45309", label: "medium trust" },
  low: { bg: "rgba(239,68,68,0.12)", fg: "#dc2626", label: "low trust — verify all" },
};

export function TrustChip({ trust }: { trust: Provenance["trust"] }) {
  const s = TRUST_STYLE[trust];
  return (
    <span style={{ background: s.bg, color: s.fg, borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)",
  borderRadius: 8, padding: "8px 10px", fontSize: 13,
};

export function IntakePanel({
  onResult,
  onError,
}: {
  onResult: (r: IntakeResultClient) => void;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("file");
  const [busy, setBusy] = useState(false);
  const [idInput, setIdInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [jsonInput, setJsonInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function post(body: BodyInit, headers?: HeadersInit) {
    setBusy(true);
    onError("");
    try {
      const res = await fetch("/api/intake", { method: "POST", body, headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "intake failed");
      onResult(json as IntakeResultClient);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function submitFile(file: File | undefined | null) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    void post(form); // browser sets multipart boundary
  }
  const submitJson = (mode: string, payload: Record<string, unknown>) =>
    post(JSON.stringify({ mode, ...payload }), { "content-type": "application/json" });

  return (
    <div className="card">
      <h2 style={{ marginBottom: 2 }}>Bring your protocol — any format</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
        Upload a document, paste a registry id, or drop in structured eligibility. We detect the
        format, extract the criteria, and show you where they came from and how much to trust them.
      </p>

      {/* Mode switch */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0 14px" }}>
        {MODES.map((m) => (
          <button
            key={m.key}
            className={`btn ${mode === m.key ? "primary" : "soft"}`}
            onClick={() => setMode(m.key)}
            style={{ padding: "6px 12px", fontSize: 13 }}
          >
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      {mode === "file" && (
        <div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); submitFile(e.dataTransfer.files?.[0]); }}
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? "var(--accent, #D97757)" : "var(--border)"}`,
              borderRadius: 10, padding: "26px 16px", textAlign: "center", cursor: "pointer",
              background: dragOver ? "rgba(217,119,87,0.06)" : "var(--panel-2)",
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 4 }}>📎</div>
            <div style={{ fontWeight: 600 }}>Drop a file or click to browse</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              PDF · DOCX · XLSX · .zip / eCTD · FHIR/ATLAS .json
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.xlsx,.zip,.json,.txt,.md"
            style={{ display: "none" }}
            onChange={(e) => submitFile(e.target.files?.[0])}
          />
        </div>
      )}

      {mode === "id" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={idInput}
            onChange={(e) => setIdInput(e.target.value)}
            placeholder="NCT03529110  or  2019-000123-45"
            style={{ ...inputStyle, width: 260 }}
          />
          <button className="btn primary" disabled={busy || !idInput.trim()} onClick={() => submitJson("id", { id: idInput })}>
            {busy ? "Fetching…" : "Fetch →"}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            {/^\s*NCT\d{8}/i.test(idInput) ? "→ ClinicalTrials.gov" : /^\s*\d{4}-\d{6}-\d{2}/.test(idInput) ? "→ EU CTR" : ""}
          </span>
        </div>
      )}

      {mode === "text" && (
        <div>
          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder={"Inclusion Criteria:\n- Age >= 18 years\n...\nExclusion Criteria:\n- ..."}
            spellCheck={false}
            style={{ width: "100%", minHeight: 130, ...inputStyle, fontFamily: "ui-monospace, monospace" }}
          />
          <div style={{ marginTop: 8 }}>
            <button className="btn primary" disabled={busy || !textInput.trim()} onClick={() => submitJson("text", { text: textInput })}>
              {busy ? "Reading…" : "Use this text →"}
            </button>
          </div>
        </div>
      )}

      {mode === "json" && (
        <div>
          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder={'{ "resourceType": "EvidenceVariable", "characteristic": [ ... ] }'}
            spellCheck={false}
            style={{ width: "100%", minHeight: 130, ...inputStyle, fontFamily: "ui-monospace, monospace" }}
          />
          <div style={{ marginTop: 8 }}>
            <button className="btn primary" disabled={busy || !jsonInput.trim()} onClick={() => submitJson("json", { data: jsonInput })}>
              {busy ? "Mapping…" : "Map structured →"}
            </button>
          </div>
        </div>
      )}

      {/* "What you can bring" showcase */}
      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>What can I bring? (8 formats)</summary>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8, marginTop: 10 }}>
          {FORMATS.map((f) => (
            <div key={f.name} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "9px 11px", background: "var(--panel-2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{f.icon} {f.name}</span>
                <TrustChip trust={f.trust} />
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{f.hint}</div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
