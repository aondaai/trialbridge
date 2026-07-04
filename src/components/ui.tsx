/**
 * Shared presentational components used across both role views. Server-safe
 * (no client hooks). The privacy banner and cohort visuals are what make the
 * privacy boundary and tri-state model visually self-evident (a spec requirement).
 */
import Link from "next/link";
import type { Criterion, CriterionResult, Cohort } from "@/lib/matcher/types";

export function TopBar({ active }: { active?: "home" | "sponsor" | "site" }) {
  return (
    <div className="topbar no-print">
      <Link href="/" className="brand">
        Trial<span>Bridge</span> · Elegível
      </Link>
      <nav className="navlinks">
        <Link href="/sponsor" className={active === "sponsor" ? "active" : ""}>
          Sponsor (Marcus)
        </Link>
        <Link href="/site" className={active === "site" ? "active" : ""}>
          Site (Camila)
        </Link>
      </nav>
    </div>
  );
}

export function PrivacyBanner({ variant }: { variant: "sponsor" | "site" }) {
  return (
    <div className="privacy">
      <span className="lock">🔒</span>
      <div>
        {variant === "sponsor" ? (
          <>
            <strong>You see counts, never patients.</strong> Every responding site
            sends aggregate candidate counts and its bottleneck criterion — no
            row-level patient data crosses this boundary. Cells of 1–4 are shown as{" "}
            <span className="mono">&lt;5</span> so a small subgroup can&apos;t be
            re-identified.{" "}
            <span className="muted">
              (Structural counts-not-rows + small-cell suppression — not full
              differential privacy; that&apos;s v2.)
            </span>
          </>
        ) : (
          <>
            <strong>Patient details stay here, at your site.</strong> The matcher
            runs locally over your records; only aggregate counts and your
            bottleneck criterion are submitted to the sponsor.
          </>
        )}
      </div>
    </div>
  );
}

export function Chip({ cohort, children }: { cohort: Cohort; children?: React.ReactNode }) {
  return <span className={`chip ${cohort}`}>{children ?? cohort}</span>;
}

export function CohortBar({
  definite,
  possible,
  excluded,
}: {
  definite: number;
  possible: number;
  excluded: number;
}) {
  const total = Math.max(1, definite + possible + excluded);
  const pct = (n: number) => `${(100 * n) / total}%`;
  return (
    <div className="cohortbar" title={`definite ${definite} · possible ${possible} · excluded ${excluded}`}>
      <span className="b-definite" style={{ width: pct(definite) }} />
      <span className="b-possible" style={{ width: pct(possible) }} />
      <span className="b-excluded" style={{ width: pct(excluded) }} />
    </div>
  );
}

export function CohortLegend() {
  return (
    <div style={{ display: "flex", gap: 14, fontSize: 12.5, marginTop: 8 }} className="muted">
      <span><span className="dot pass" /> definite — passes all criteria</span>
      <span><span className="dot unknown" /> possible — eligible but has unknowns</span>
      <span><span className="dot" style={{ background: "var(--excluded)" }} /> excluded</span>
    </div>
  );
}

/** Read-back of parsed criteria (the "verify the parse" surface). */
export function CriterionList({ criteria }: { criteria: Criterion[] }) {
  return (
    <div>
      {criteria.map((c) => (
        <div className="crit" key={c.id}>
          <span className="kind">{c.kind}</span>
          <span style={{ flex: 1 }}>
            {c.rawText}
            {c.confidence < 0.75 && <span className="badge-low">low-confidence · verify</span>}
          </span>
          {c.groupLabel && c.groupId && (
            <span className="muted" style={{ fontSize: 12 }}>
              group: {c.groupId}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Per-criterion pass/fail/unknown breakdown for a single patient (auditability). */
export function CriterionResultList({ results }: { results: CriterionResult[] }) {
  return (
    <div>
      {results.map((r) => (
        <div className="crit" key={r.criterionId}>
          <span className={`dot ${r.status}`} />
          <span style={{ width: 74 }} className="muted mono" data-status={r.status}>
            {r.status}
          </span>
          <span style={{ flex: 1 }}>{r.rawText}</span>
          <span className="muted mono" style={{ fontSize: 12 }}>
            {r.observed === undefined ? "no data" : `observed: ${String(r.observed)}`}
          </span>
        </div>
      ))}
    </div>
  );
}
