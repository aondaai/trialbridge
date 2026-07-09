"use client";

/**
 * The modeled-prevalence funnel panel — Beat 3/4's second layer, shown only
 * when the protocol has not-evaluable gating criteria (see sponsor-view.ts).
 *
 * Distinct from SofteningPanel on purpose: that panel re-runs the matcher
 * against OBSERVED patient records. This panel scales an observed pool by
 * cited epidemiological prevalence into a clearly `MODELED` estimate — never
 * presented as deliverable or observed (see modeledPrevalence.ts).
 */

import { useState } from "react";
import type { ModeledFunnelView } from "@/lib/sponsor-view";

export function ModeledFunnelPanel({ view }: { view: ModeledFunnelView }) {
  const [widened, setWidened] = useState(false);
  const active = widened ? view.widened : view.baseline;
  const pdl1Assumption = active.assumptions.find((a) => a.id.startsWith("pdl1"));
  const krasAssumption = active.assumptions.find((a) => a.id === "kras_g12c");

  return (
    <div>
      <p className="sub">
        The matcher can only tell you what the data can prove. These two
        criteria are gating AND effectively unmeasured in this data — so
        instead of pretending, we size two separate numbers: what&apos;s
        <strong> observed</strong> (addressable pool) and what&apos;s
        <strong> modeled</strong> (biomarker-eligible, from published prevalence).
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
        {view.testingGap.map((g) => (
          <div key={g.field} className="card" style={{ margin: 0, flex: "1 1 200px" }}>
            <div className="sub">{g.label} testing gap</div>
            <div className="stat small" style={{ color: "var(--excluded)" }}>{g.pct}%</div>
            <div className="muted" style={{ fontSize: 12 }}>of the addressable pool lacks documented testing</div>
          </div>
        ))}
      </div>

      <div className="grid2" style={{ marginBottom: 12 }}>
        <div className="card" style={{ margin: 0, textAlign: "center" }}>
          <div className="sub">Addressable pool (OBSERVED)</div>
          <div className="stat">{view.addressablePool}</div>
          <div className="muted" style={{ fontSize: 12 }}>definite + possible, from the matcher — real patients</div>
        </div>
        <div className="card" style={{ margin: 0, textAlign: "center", borderColor: "var(--brand)" }}>
          <div className="sub">
            Biomarker-eligible (MODELED)
            {pdl1Assumption ? ` — ${pdl1Assumption.label}` : ""}
          </div>
          <div className="stat" style={{ color: "var(--brand)" }}>~{active.modeledEligible}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {krasAssumption?.label}
            {pdl1Assumption ? ` × ${pdl1Assumption.label}` : ""} — never presented as observed
          </div>
        </div>
      </div>

      <button className={`btn soft ${widened ? "on" : ""}`} onClick={() => setWidened((w) => !w)}>
        {widened ? "★ widened: " : "widen: "}
        PD-L1 negative-only → {view.widenedLabel}
        {widened ? "" : ` (~${(view.widened.modeledEligible / Math.max(1, view.baseline.modeledEligible)).toFixed(1)}x)`}
      </button>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        This is a scientific trade, not a free lunch: widening PD-L1 grows the
        modeled pool but weakens the rationale for a KRAS-inhibitor-vs-IO trial
        (IO monotherapy underperforms specifically in PD-L1-negative disease —
        see docs/citations.md).
      </p>
    </div>
  );
}
