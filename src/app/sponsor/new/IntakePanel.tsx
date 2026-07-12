"use client";

/**
 * The universal intake panel (Phase 5) — the "bring your protocol, any format"
 * front door. Four input modes (file upload / registry id / paste / structured)
 * all POST to /api/intake, which runs the SourceAdapter registry. The result is
 * handed up via `onResult`; the parent routes the two lanes (eligibilityText →
 * parse+verify; preParsedCriteria → straight to the verify table).
 *
 * Also renders the "what you can bring" showcase — each card can load a live
 * sample so a sponsor can see any lane end-to-end in one click.
 */

import { useRef, useState } from "react";
import type { Criterion } from "@/lib/matcher/types";
import type { ProtocolMeta, Provenance } from "@/lib/intake";
import { FHIR_EVIDENCE_VARIABLE, ATLAS_COHORT, EUCTR_FIXTURE } from "@/data/intakeFixtures";

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

const SAMPLE_SYNOPSIS = `Protocol Synopsis — Drug Y in NSCLC

Eligibility:
- Adults with stage IV non-small cell lung cancer.
- KRAS G12C mutation confirmed.
- ECOG performance status 0 or 1.
- No prior KRAS inhibitor.`;

/** A loadable sample for a showcase card, or null when the format is binary. */
type Sample =
  | { mode: "id"; id: string }
  | { mode: "text"; text: string }
  | { mode: "json"; data: unknown }
  | null;

const FORMATS: { icon: string; name: string; hint: string; trust: Provenance["trust"]; sample: Sample }[] = [
  { icon: "🔖", name: "ClinicalTrials.gov", hint: "NCT id → live registry fetch", trust: "high", sample: { mode: "id", id: "NCT03529110" } },
  { icon: "🇪🇺", name: "EU CTR", hint: "EudraCT number (YYYY-NNNNNN-CC)", trust: "high", sample: { mode: "id", id: EUCTR_FIXTURE.eudractNumber } },
  { icon: "🧬", name: "FHIR EvidenceVariable", hint: "coded eligibility → skips the LLM", trust: "high", sample: { mode: "json", data: FHIR_EVIDENCE_VARIABLE } },
  { icon: "🧩", name: "ATLAS cohort JSON", hint: "OHDSI cohort → approximate", trust: "medium", sample: { mode: "json", data: ATLAS_COHORT } },
  { icon: "📝", name: "Synopsis / pasted text", hint: "bullets or prose", trust: "medium", sample: { mode: "text", text: SAMPLE_SYNOPSIS } },
  { icon: "📄", name: "Protocol PDF / DOCX", hint: "we locate the eligibility section", trust: "medium", sample: null },
  { icon: "📊", name: "XLSX matrix", hint: "one row per criterion", trust: "medium", sample: null },
  { icon: "📦", name: "IND / eCTD package", hint: ".zip → Module 5 protocol", trust: "low", sample: null },
];

const TRUST_STYLE: Record<Provenance["trust"], { bg: string; fg: string; label: string }> = {
  high: { bg: "rgba(22,163,74,0.12)", fg: "#15803d", label: "high trust" },
  medium: { bg: "rgba(180,83,9,0.14)", fg: "#b45309", label: "medium trust" },
  low: { bg: "rgba(220,38,38,0.12)", fg: "#dc2626", label: "low trust — verify all" },
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
  const abortRef = useRef<AbortController | null>(null);

  async function post(body: BodyInit, headers?: HeadersInit) {
    if (busy) return; // guard against overlapping submits
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    onError("");
    try {
      const res = await fetch("/api/intake", { method: "POST", body, headers, signal: controller.signal });
      // Tolerate a non-JSON error body (e.g. a platform 413/502 HTML page).
      const json = await res.json().catch(() => ({ error: `intake failed (HTTP ${res.status})` }));
      if (!res.ok) throw new Error(json.error ?? `intake failed (HTTP ${res.status})`);
      onResult(json as IntakeResultClient);
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // superseded by a newer submit
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function submitFile(file: File | undefined | null) {
    if (busy || !file) return;
    const form = new FormData();
    form.append("file", file);
    void post(form); // browser sets the multipart boundary
  }
  const submitJson = (payloadMode: string, payload: Record<string, unknown>) =>
    post(JSON.stringify({ mode: payloadMode, ...payload }), { "content-type": "application/json" });

  function loadSample(s: NonNullable<Sample>) {
    if (busy) return;
    if (s.mode === "id") { setMode("id"); setIdInput(s.id); submitJson("id", { id: s.id }); }
    else if (s.mode === "text") { setMode("text"); setTextInput(s.text); submitJson("text", { text: s.text }); }
    else { setMode("json"); setJsonInput(JSON.stringify(s.data, null, 2)); submitJson("json", { data: s.data }); }
  }

  function openFilePicker() {
    fileRef.current?.click();
  }

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
            role="button"
            tabIndex={0}
            aria-label="Upload a protocol file — drop a file here or activate to browse"
            aria-disabled={busy}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); submitFile(e.dataTransfer.files?.[0]); }}
            onClick={openFilePicker}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openFilePicker(); } }}
            style={{
              border: `2px dashed ${dragOver ? "var(--accent, #D97757)" : "var(--border)"}`,
              borderRadius: 10, padding: "26px 16px", textAlign: "center", cursor: "pointer",
              background: dragOver ? "rgba(217,119,87,0.06)" : "var(--panel-2)",
              opacity: busy ? 0.6 : 1,
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 4 }}>📎</div>
            <div style={{ fontWeight: 600 }}>{busy ? "Reading…" : "Drop a file or click to browse"}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              PDF · DOCX · XLSX · .zip / eCTD · FHIR/ATLAS .json
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.xlsx,.zip,.json,.txt,.md"
            style={{ display: "none" }}
            onChange={(e) => { submitFile(e.target.files?.[0]); e.target.value = ""; }}
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
            {/^\s*NCT\d{8}\s*$/i.test(idInput) ? "→ ClinicalTrials.gov" : /^\s*\d{4}-\d{6}-\d{2}\s*$/.test(idInput) ? "→ EU CTR" : ""}
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

      {/* "What you can bring" showcase — each card can load a live sample */}
      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>What can I bring? (8 formats)</summary>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8, marginTop: 10 }}>
          {FORMATS.map((f) => (
            <div key={f.name} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "9px 11px", background: "var(--panel-2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{f.icon} {f.name}</span>
                <TrustChip trust={f.trust} />
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{f.hint}</div>
              <div style={{ marginTop: 7 }}>
                {f.sample ? (
                  <button className="btn soft" disabled={busy} onClick={() => loadSample(f.sample!)} style={{ padding: "3px 10px", fontSize: 12 }}>
                    Try a sample →
                  </button>
                ) : (
                  <button className="btn soft" onClick={() => setMode("file")} style={{ padding: "3px 10px", fontSize: 12 }}>
                    Upload your own →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
