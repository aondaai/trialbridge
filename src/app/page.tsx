import Link from "next/link";
import { TopBar } from "@/components/ui";

export default function Home() {
  return (
    <>
      <TopBar active="home" />
      <main className="wrap">
        <h1 style={{ fontSize: 34, letterSpacing: "-0.03em", marginBottom: 6 }}>
          The two-sided discovery layer for clinical-trial feasibility.
        </h1>
        <p className="muted" style={{ fontSize: 17, maxWidth: 680, marginTop: 0 }}>
          Sponsors post a protocol&apos;s eligibility criteria. Sites run them
          against their own patients privately and respond with a de-identified
          proof of capacity. Every match is deterministic and auditable — and the
          sponsor sees counts, never patients.
        </p>

        <div className="grid2" style={{ marginTop: 24 }}>
          <Link href="/sponsor" className="card" style={{ display: "block" }}>
            <h2>Sponsor view — Marcus</h2>
            <p className="sub">
              See aggregated candidate counts across responding sites, a
              funnel-discounted deliverable estimate, and simulate loosening any
              criterion in real time.
            </p>
            <span className="btn primary">Open sponsor view →</span>
          </Link>
          <Link href="/site" className="card" style={{ display: "block" }}>
            <h2>Site view — Camila</h2>
            <p className="sub">
              Discover an open consultation, run the matcher over your patients
              with per-criterion transparency, and submit proof of capacity in one
              click.
            </p>
            <span className="btn">Open site view →</span>
          </Link>
        </div>

        <div className="card" style={{ marginTop: 24 }}>
          <h2>Under the hood</h2>
          <ul className="muted" style={{ fontSize: 14, lineHeight: 1.8 }}>
            <li>
              <strong>Deterministic matcher</strong> — the LLM parses criteria; arithmetic decides
              matches. Tri-state cohorts: definite / possible (has unknowns) / excluded.
            </li>
            <li>
              <strong>Honest softening</strong> — pool gains split into genuinely-eligible vs.
              &ldquo;only newly definite because a field was unknown&rdquo;.
            </li>
            <li>
              <strong>Counts-not-rows</strong> — responses carry counts + a bottleneck; small cells
              (1–4) suppressed to <span className="mono">&lt;5</span>.
            </li>
            <li>
              <strong>Realism</strong> — 30–40% missing HER2, mixed lab units, a match ≠ enrollable
              funnel discount, and capacity as a monthly rate.
            </li>
          </ul>
          <p className="muted" style={{ fontSize: 13 }}>
            Headless proof: <span className="mono">npm run demo</span>.
          </p>
        </div>
      </main>
    </>
  );
}
