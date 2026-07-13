import type { Metadata } from "next";
import { ROLE_OPTIONS } from "./roles";

export const metadata: Metadata = {
  title: "TrialBridge — Choose your role",
};

/**
 * Role-selection entry screen. The user picks Patrocinador or Site and is routed
 * to the matching journey. This is the canonical entry to the app — the top-bar
 * toggle is a convenience, no longer the only way in. Plain <a> anchors (full
 * navigation) keep this server-rendered and unit-testable. Light Claude theme
 * (claude.css, .cl-root scope) — matches the marketing landing.
 */
export default function StartPage() {
  return (
    <div className="cl-root" style={{ minHeight: "100vh", background: "var(--cl-bg)" }}>
      <main style={{ maxWidth: 940, margin: "0 auto", padding: "72px 24px" }}>
        <p
          style={{
            color: "var(--cl-accent)",
            fontWeight: 600,
            letterSpacing: "0.02em",
            marginBottom: 8,
          }}
        >
          TrialBridge
        </p>
        <h1 className="cl-h1" style={{ margin: "0 0 12px", lineHeight: 1.1 }}>
          How do you want to start?
        </h1>
        <p className="cl-text-secondary" style={{ fontSize: 18, margin: "0 0 40px", maxWidth: 620 }}>
          Choose your role to follow the right journey. You can switch later from the top bar.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 20,
          }}
        >
          {ROLE_OPTIONS.map((r) => (
            <a
              key={r.key}
              href={r.href}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: 28,
                borderRadius: 16,
                border: "1px solid var(--cl-border, #E5E3DC)",
                background: "var(--cl-bg)",
                color: "var(--cl-text)",
                textDecoration: "none",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 16,
                }}
              >
                <h2 className="cl-h2" style={{ margin: 0 }}>
                  {r.title}
                </h2>
                {r.key === "site" && (
                  <span
                    aria-label="pretty soon"
                    style={{
                      position: "relative",
                      flexShrink: 0,
                      padding: "7px 11px",
                      borderRadius: 999,
                      background: "var(--cl-accent)",
                      color: "white",
                      fontSize: 12,
                      fontWeight: 700,
                      lineHeight: 1,
                      letterSpacing: "0.02em",
                      boxShadow: "0 2px 6px rgba(0, 0, 0, 0.12)",
                    }}
                  >
                    pretty soon
                    <span
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        left: 12,
                        bottom: -4,
                        width: 9,
                        height: 9,
                        background: "var(--cl-accent)",
                        transform: "rotate(45deg)",
                      }}
                    />
                  </span>
                )}
              </div>
              <p className="cl-text-secondary" style={{ margin: 0, flexGrow: 1 }}>
                {r.blurb}
              </p>
              <span
                style={{
                  display: "inline-block",
                  marginTop: 8,
                  color: "var(--cl-accent)",
                  fontWeight: 600,
                }}
              >
                {r.cta}
              </span>
            </a>
          ))}
        </div>
      </main>
    </div>
  );
}
