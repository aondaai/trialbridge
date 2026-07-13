"use client";

import { useState } from "react";
import { TopBar, PrivacyBanner } from "@/components/ui";
import type { Patient } from "@/lib/matcher/types";
import { listSite } from "./actions";
import { EhrIntakePanel } from "./EhrIntakePanel";

const REGIONS = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"] as const;
const REGION_LABELS: Record<(typeof REGIONS)[number], string> = {
  Norte: "North",
  Nordeste: "Northeast",
  "Centro-Oeste": "Central-West",
  Sudeste: "Southeast",
  Sul: "South",
};

const selStyle: React.CSSProperties = {
  background: "var(--panel-2)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 13,
};

export default function NewSitePage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [intakeBusy, setIntakeBusy] = useState(false);

  return (
    <>
      <TopBar active="site" />
      <main className="wrap">
        <h1 style={{ marginBottom: 2 }}>List your site</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Declare your center once, upload an EHR export — we structure it.
          Records stay local; sponsors only ever see aggregate counts.
        </p>

        <PrivacyBanner variant="site" />

        <div className="card">
          <form action={listSite}>
            <div className="grid2">
              <label style={{ fontSize: 13 }}>
                <div className="muted">Site name</div>
                <input name="name" required style={{ ...selStyle, width: "100%" }} />
              </label>
              <label style={{ fontSize: 13 }}>
                <div className="muted">City</div>
                <input name="city" required style={{ ...selStyle, width: "100%" }} />
              </label>
            </div>

            <div className="grid2" style={{ marginTop: 12 }}>
              <label style={{ fontSize: 13 }}>
                <div className="muted">Region</div>
                <select name="region" required defaultValue="" style={{ ...selStyle, width: "100%" }}>
                  <option value="" disabled>
                    Select a region
                  </option>
                  {REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {REGION_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <div className="muted">Monthly incidence (new eligible patients/month)</div>
                <input
                  name="monthlyIncidence"
                  type="number"
                  min={0}
                  step={1}
                  required
                  style={{ ...selStyle, width: "100%" }}
                />
              </label>
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
                EHR export
              </div>
              <EhrIntakePanel onPatients={setPatients} onBusyChange={setIntakeBusy} />
            </div>

            <input type="hidden" name="patients" value={JSON.stringify(patients)} />

            <div style={{ marginTop: 12 }}>
              <button className="cl-btn cl-btn--primary" type="submit" disabled={patients.length === 0 || intakeBusy}>
                List site{patients.length > 0 ? ` (${patients.length} patients)` : ""} →
              </button>
            </div>
          </form>
        </div>
      </main>
    </>
  );
}
