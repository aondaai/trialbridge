import { TopBar, PrivacyBanner } from "@/components/ui";
import { listSite } from "./actions";

const REGIONS = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"] as const;

export default function NewSitePage() {
  return (
    <>
      <TopBar active="site" />
      <main className="wrap">
        <h1 style={{ marginBottom: 2 }}>List your site</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Declare your center once — patient records stay local; sponsors only
          ever see aggregate counts.
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
                      {r}
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

            <label style={{ fontSize: 13, display: "block", marginTop: 12 }}>
              <div className="muted">Patient records (JSON)</div>
              <textarea
                name="patientsJson"
                required
                spellCheck={false}
                style={{
                  width: "100%",
                  minHeight: 220,
                  background: "var(--panel-2)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 12,
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 13,
                  marginTop: 4,
                }}
              />
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Paste a JSON array of patient records, or the contents of a
                generated data/site-*.json file. Rows never leave this server.
              </div>
            </label>

            <div style={{ marginTop: 12 }}>
              <button className="cl-btn cl-btn--primary" type="submit">
                List site →
              </button>
            </div>
          </form>
        </div>
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
