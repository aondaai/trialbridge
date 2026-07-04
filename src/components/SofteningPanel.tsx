"use client";

/**
 * Interactive protocol-softening panel — the demo's hero moment.
 *
 * It receives ALL softening results precomputed server-side (just numbers, no
 * patient rows), so toggling a criterion updates the candidate pool instantly
 * with zero server round-trip (< 1s NFR). The split into genuine-vs-caveat gains
 * is always visible so the pool jump can't be read as more than it is (D2).
 */

import { useState } from "react";
import type { SofteningRow } from "@/lib/sponsor-view";

export function SofteningPanel({
  softening,
  heroHandle,
}: {
  softening: SofteningRow[];
  heroHandle?: string;
}) {
  const heroIndex = Math.max(
    0,
    softening.findIndex((s) => s.handle === heroHandle),
  );
  const [selected, setSelected] = useState<string | null>(null);

  const active = selected ? softening.find((s) => s.handle === selected) ?? null : null;
  const baseline = softening[0]?.baselineDefinite ?? 0;

  return (
    <div>
      <p className="sub">
        Click a criterion to simulate loosening it across all responding sites.
        The confirmed-eligible pool updates instantly; the gain is split so a jump
        driven by <em>missing data</em> can&apos;t be mistaken for real capacity.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {softening.map((s) => (
          <button
            key={s.handle}
            className={`btn soft ${selected === s.handle ? "on" : ""}`}
            onClick={() => setSelected(selected === s.handle ? null : s.handle)}
            title={s.rawTexts.join(" · ")}
          >
            {s.handle === heroHandle ? "★ " : ""}
            {s.label.length > 42 ? s.label.slice(0, 40) + "…" : s.label}
          </button>
        ))}
      </div>

      <div className="grid2">
        <div className="card" style={{ margin: 0, textAlign: "center" }}>
          <div className="sub">Confirmed-eligible now (baseline)</div>
          <div className="stat">{baseline}</div>
          <div className="muted" style={{ fontSize: 12 }}>definite across responding sites</div>
        </div>
        <div
          className="card"
          style={{ margin: 0, textAlign: "center", borderColor: active ? "var(--brand)" : "var(--border)" }}
        >
          <div className="sub">{active ? `If we loosen: ${active.label}` : "Select a criterion →"}</div>
          <div className="stat" style={{ color: active ? "var(--brand)" : "var(--muted)" }}>
            {active ? active.relaxedDefinite : "—"}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {active ? `Δ +${active.relaxedDefinite - active.baselineDefinite} confirmed-eligible` : "no change yet"}
          </div>
        </div>
      </div>

      {active && (
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="sub" style={{ marginBottom: 10 }}>
            Where the +{active.relaxedDefinite - active.baselineDefinite} comes from — honesty split:
          </div>
          <SplitRow
            color="var(--definite)"
            n={active.newlyDefiniteFromFail}
            label="genuinely newly eligible — were failing this criterion (e.g. HER2-negative/low)"
          />
          <SplitRow
            color="var(--possible)"
            n={active.newlyDefiniteFromUnknown}
            label="CAVEAT: “newly definite” only because this field was UNKNOWN — still unproven, needs a test"
          />
          <SplitRow
            color="var(--excluded)"
            n={active.newlyPossible}
            label="newly possible — were excluded, still carry other unknowns"
          />
        </div>
      )}
    </div>
  );
}

function SplitRow({ color, n, label }: { color: string; n: number; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0", borderBottom: "1px dashed var(--border)" }}>
      <span className="stat small" style={{ color, minWidth: 44, textAlign: "right" }}>
        +{n}
      </span>
      <span style={{ fontSize: 13.5 }}>{label}</span>
    </div>
  );
}
