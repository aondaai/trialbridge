"use client";

/**
 * Marketing landing page — the app's "/" route. Uses the claude.css design
 * system (see src/app/claude.css + landing.css), scoped to this component's
 * own .cl-root wrapper so it doesn't affect the sponsor/site/scorecard routes,
 * which keep their existing dark-navy demo theme.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

type SoftenCriterion = {
  key: string;
  name: string;
  note: string;
  bump: number;
  checked: boolean;
};

const INITIAL_CRITERIA: SoftenCriterion[] = [
  { key: "ecog", name: "ECOG performance status 0–1", note: "Soften to 0–2", bump: 2400, checked: true },
  { key: "lvef", name: "LVEF ≥ 50%", note: "Soften to ≥ 45%", bump: 1150, checked: true },
  { key: "priorLines", name: "≥2 prior systemic therapy lines", note: "Soften to ≥1", bump: 900, checked: true },
];

const BASE_ELIGIBLE = 3200;
const TOTAL_POOL = 15250;

export default function Landing() {
  const [isDark, setIsDark] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [criteria, setCriteria] = useState(INITIAL_CRITERIA);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("tb-theme");
    } catch {
      // ignore
    }
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    setIsDark(stored ? stored === "dark" : !!prefersDark);
  }, []);

  function toggleTheme() {
    setIsDark((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("tb-theme", next ? "dark" : "light");
      } catch {
        // ignore
      }
      return next;
    });
  }

  function toggleCriterion(key: string) {
    setCriteria((prev) => prev.map((c) => (c.key === key ? { ...c, checked: !c.checked } : c)));
  }

  function closeMobileMenu() {
    setMobileOpen(false);
  }

  const softenedCount = criteria.filter((c) => !c.checked).length;
  const bump = criteria.filter((c) => !c.checked).reduce((sum, c) => sum + c.bump, 0);
  const finalPool = BASE_ELIGIBLE + bump;
  const pct = Math.round((finalPool / TOTAL_POOL) * 100);
  const poolHint =
    softenedCount > 0
      ? `${softenedCount} ${softenedCount === 1 ? "criterion" : "criteria"} softened — ${bump.toLocaleString(
          "en-US"
        )} newly eligible patients added. Numbers are illustrative.`
      : "Uncheck a softenable criterion to see the patient pool grow. Numbers are illustrative.";

  return (
    <div className="cl-root" data-theme={isDark ? "dark" : undefined}>
      <a className="tb-skip-link" href="#main">
        Skip to content
      </a>

      <header className="tb-header">
        <div className="tb-container">
          <nav className="cl-nav" aria-label="Primary">
            <a className="cl-nav__brand" href="#main">
              <span className="tb-nav__brand-mark" aria-hidden="true">
                TB
              </span>
              TrialBridge
            </a>
            <div className="cl-nav__links tb-nav__links">
              <a className="cl-nav__link" href="#how-it-works">
                How it works
              </a>
              <a className="cl-nav__link" href="#for-sites">
                For sites
              </a>
              <a className="cl-nav__link" href="#for-sponsors">
                For sponsors
              </a>
              <a className="cl-nav__link" href="#faq">
                FAQ
              </a>
            </div>
            <div className="tb-nav__actions">
              <button
                type="button"
                className="tb-theme-toggle"
                aria-label="Toggle dark mode"
                aria-pressed={isDark}
                onClick={toggleTheme}
              >
                <span aria-hidden="true">{isDark ? "☀️" : "🌙"}</span>
              </button>
              <Link href="/start" className="cl-btn cl-btn--primary tb-nav__cta">
                Open the app
              </Link>
              <button
                type="button"
                className="tb-nav-toggle"
                aria-label="Open menu"
                aria-expanded={mobileOpen}
                aria-controls="mobile-menu"
                onClick={() => setMobileOpen((o) => !o)}
              >
                ☰
              </button>
            </div>
          </nav>
          <nav
            id="mobile-menu"
            className={`tb-mobile-menu${mobileOpen ? " is-open" : ""}`}
            aria-label="Mobile"
          >
            <a href="#how-it-works" onClick={closeMobileMenu}>
              How it works
            </a>
            <a href="#for-sites" onClick={closeMobileMenu}>
              For sites
            </a>
            <a href="#for-sponsors" onClick={closeMobileMenu}>
              For sponsors
            </a>
            <a href="#faq" onClick={closeMobileMenu}>
              FAQ
            </a>
            <Link href="/start" className="cl-btn cl-btn--primary" onClick={closeMobileMenu}>
              Open the app
            </Link>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* ============================== HERO ============================== */}
        <section className="tb-hero">
          <div className="tb-container tb-hero__grid">
            <div>
              <span className="cl-badge cl-badge--accent tb-hero__eyebrow">
                <span className="cl-badge__dot" aria-hidden="true"></span>
                Now live in Brazil
              </span>
              <h1 className="cl-h1 tb-hero">Global trials. Ready sites. Finally matched.</h1>
              <p className="tb-hero__subhead">
                AI-accelerated drug discovery is producing more trial-ready compounds than US and
                EU recruitment can absorb. TrialBridge lets emerging-market sites declare their
                real capacity — and lets sponsors run protocol feasibility against it — so the
                next Phase&nbsp;II doesn&apos;t stall waiting on patients that were never visible
                in the first place.
              </p>
              <div className="tb-hero__ctas">
                <Link href="/sponsor" className="cl-btn cl-btn--primary cl-btn--lg">
                  Run a feasibility check
                </Link>
                <Link href="/site" className="cl-btn cl-btn--secondary cl-btn--lg">
                  List your site
                </Link>
              </div>
              <div className="tb-hero__meta">
                <span>🛡 Self-declared, site-verified capacity</span>
                <span>📊 Per-site feasibility scorecards</span>
                <span>🌐 Starting in Brazil</span>
              </div>
            </div>
            <div className="tb-hero__visual">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="tb-mascot-img tb-mascot-img--hero"
                src="/mascot/dr-capy.png"
                alt="Dr. Capy, the TrialBridge capybara physician"
                width={320}
                height={362}
              />
            </div>
          </div>
        </section>

        {/* ========================= PROBLEM STRIP =========================== */}
        <section className="tb-section tb-section--muted" aria-labelledby="problem-heading">
          <div className="tb-container">
            <div className="tb-section-head tb-section-head--center" style={{ maxWidth: 640 }}>
              <span className="tb-eyebrow">The bottleneck</span>
              <h2 className="cl-h2" id="problem-heading">
                Recruitment, not discovery, is now the constraint
              </h2>
              <p className="cl-text-secondary">
                Drug pipelines are growing faster than trial-ready patient populations in
                established markets — and the gap is showing up in enrollment data.
              </p>
            </div>

            <div className="tb-stat-grid">
              <div className="cl-card tb-stat-card">
                <div className="tb-stat-card__value">~19%</div>
                <div className="tb-stat-card__label">Trials fail on accrual</div>
                <p className="tb-stat-card__desc">
                  of trials terminate early for failed accrual or finish below 85% of their
                  enrollment target.
                  <sup>1</sup>
                </p>
              </div>
              <div className="cl-card tb-stat-card">
                <div className="tb-stat-card__value">&gt;20×</div>
                <div className="tb-stat-card__label">AI-originated pipeline growth</div>
                <p className="tb-stat-card__desc">
                  growth in AI-discovered molecules entering clinical trials, from 3 (2016) to 67
                  (2023).
                  <sup>2</sup>
                </p>
              </div>
              <div className="cl-card tb-stat-card">
                <div className="tb-stat-card__value">~2×</div>
                <div className="tb-stat-card__label">Timeline overruns</div>
                <p className="tb-stat-card__desc">
                  the typical multiple of planned timeline needed for trials that do enroll to
                  reach target.
                  <sup>1</sup>
                </p>
              </div>
            </div>

            <ol className="tb-footnotes">
              <li>
                1. Carlisle, Kimmelman, Ramsay &amp; MacKinnon, &quot;Unsuccessful Trial Accrual
                and Human Subjects Protections,&quot; <em>Clinical Trials</em> (SAGE) 12(1):77–83,
                2015; Tufts CSDD Impact Report, Jan 2013.
              </li>
              <li>
                2. Jayatunga et al., &quot;How successful are AI-discovered drugs in clinical
                trials?&quot;, <em>Drug Discovery Today</em> 2024;29(6):104009.
              </li>
            </ol>
          </div>
        </section>

        {/* ========================= HOW IT WORKS ============================ */}
        <section className="tb-section" id="how-it-works" aria-labelledby="how-heading">
          <div className="tb-container">
            <div className="tb-section-head tb-section-head--center">
              <span className="tb-eyebrow">How it works</span>
              <h2 className="cl-h2" id="how-heading">
                Connective tissue, not another database
              </h2>
              <p className="cl-text-secondary">
                TrialBridge doesn&apos;t scrape or infer site capacity — sites declare it
                directly, and sponsors match against what&apos;s real.
              </p>
            </div>

            <div className="tb-steps-grid">
              <div className="cl-card tb-step">
                <div className="tb-step__num">1</div>
                <h3 className="cl-h3">Sites declare capacity</h3>
                <p>
                  Patient populations, equipment, staff certifications, and past trial performance
                  — entered once, kept current, visible to every sponsor on the network.
                </p>
              </div>
              <div className="cl-card tb-step">
                <div className="tb-step__num">2</div>
                <h3 className="cl-h3">Sponsors run feasibility</h3>
                <p>
                  Upload protocol eligibility criteria and TrialBridge matches them against real,
                  self-declared site capacity across the network — not modeled estimates.
                </p>
              </div>
              <div className="cl-card tb-step">
                <div className="tb-step__num">3</div>
                <h3 className="cl-h3">Feasibility scorecard</h3>
                <p>
                  Every candidate site returns a scorecard — enrollment capacity, equipment fit,
                  certifications, and track record — so outreach starts with sites that can
                  actually enroll.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ======================= PROTOCOL SOFTENING ========================= */}
        <section className="tb-section tb-section--muted" aria-labelledby="soften-heading">
          <div className="tb-container tb-soften-grid">
            <div className="tb-soften-copy">
              <span className="tb-eyebrow">The differentiator</span>
              <h2 className="cl-h2" id="soften-heading">
                See what one criterion is really costing you
              </h2>
              <p>
                Every eligibility criterion narrows the pool of patients who can enroll.
                TrialBridge shows sponsors, live, how loosening a single criterion expands the
                available patient pool across responding sites — before a protocol amendment, not
                after enrollment stalls.
              </p>
              <ul>
                <li>
                  Toggle any criterion off to see its exact impact on eligible patients across the
                  network.
                </li>
                <li>
                  Distinguish patients who become <strong>newly eligible</strong> from those who
                  were already borderline.
                </li>
                <li>
                  Modeled on real-world Phase III eligibility structure (HER2+ metastatic breast
                  cancer archetype), simplified for illustration.
                </li>
              </ul>
            </div>

            <div className="cl-card cl-card--raised tb-soften-mock">
              <div className="cl-card__header tb-soften-mock__header">
                <h3 className="tb-soften-mock__title">Protocol softening simulator</h3>
                <span className="cl-badge cl-badge--neutral">Illustrative</span>
              </div>
              <ul className="tb-criteria">
                <li className="tb-criterion">
                  <label className="cl-check">
                    <input type="checkbox" checked disabled readOnly />
                    <span className="tb-criterion__label">
                      <span className="tb-criterion__name">HER2-positive (central lab confirmed)</span>
                      <span className="tb-criterion__note">Hard gate — not softenable</span>
                    </span>
                  </label>
                </li>
                {criteria.map((c) => (
                  <li className={`tb-criterion${c.checked ? "" : " tb-criterion--locked"}`} key={c.key}>
                    <label className="cl-check">
                      <input
                        type="checkbox"
                        className="tb-soften-toggle"
                        checked={c.checked}
                        onChange={() => toggleCriterion(c.key)}
                      />
                      <span className="tb-criterion__label">
                        <span className="tb-criterion__name">{c.name}</span>
                        <span className="tb-criterion__note">{c.note}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="tb-pool">
                <div className="tb-pool__row">
                  <span className="tb-pool__label">Eligible patients across responding sites</span>
                  <span className="tb-pool__value">
                    {finalPool.toLocaleString("en-US")}{" "}
                    <span>of {TOTAL_POOL.toLocaleString("en-US")}</span>
                  </span>
                </div>
                <div className="cl-progress">
                  <div className="cl-progress__bar" style={{ width: `${pct}%` }} />
                </div>
                <p className="tb-pool__hint">{poolHint}</p>
              </div>
            </div>
          </div>
        </section>

        {/* ========================= AUDIENCE SPLIT =========================== */}
        <section className="tb-section" aria-labelledby="audience-heading">
          <div className="tb-container">
            <div className="tb-section-head tb-section-head--center">
              <span className="tb-eyebrow">Built for both sides</span>
              <h2 className="cl-h2" id="audience-heading">
                Whichever side of the trial you&apos;re on
              </h2>
            </div>

            <div className="tb-audience-grid">
              <div className="cl-card tb-audience-card" id="for-sites">
                <span className="cl-badge cl-badge--info tb-audience-card__badge">For sites</span>
                <h3 className="cl-h3">Get found by sponsors who are actually looking</h3>
                <p className="cl-text-secondary">
                  Dra. Camila Rocha runs clinical research at a São Paulo academic hospital
                  network. Her site can enroll — global sponsors just can&apos;t see it.
                </p>
                <p className="tb-audience-card__quote">
                  &ldquo;We had the patients and the equipment. What we didn&apos;t have was a way
                  to show up in a sponsor&apos;s feasibility study.&rdquo;
                </p>
                <ul>
                  <li>Declare capacity once — patient populations, equipment, staff certifications, trial history.</li>
                  <li>Surface automatically in feasibility scorecards for matching protocols.</li>
                  <li>Build a track record that compounds with every completed trial.</li>
                </ul>
                <Link href="/site" className="cl-btn cl-btn--secondary">
                  List your site
                </Link>
              </div>

              <div className="cl-card tb-audience-card" id="for-sponsors">
                <span className="cl-badge cl-badge--accent tb-audience-card__badge">For sponsors</span>
                <h3 className="cl-h3">Find sites that can actually enroll</h3>
                <p className="cl-text-secondary">
                  Marcus is VP of Clinical Operations at a mid-size biotech planning a
                  Phase&nbsp;II oncology trial. He needs recruitment risk answered before site
                  selection, not after.
                </p>
                <p className="tb-audience-card__quote">
                  &ldquo;Our incumbent database is biased toward markets we&apos;ve already
                  saturated. I need to see capacity that actually exists.&rdquo;
                </p>
                <ul>
                  <li>Run protocol feasibility against real, self-declared site capacity.</li>
                  <li>See exactly how softening a criterion expands your eligible pool.</li>
                  <li>Compare sites on a standardized feasibility scorecard, not a sales call.</li>
                </ul>
                <Link href="/sponsor" className="cl-btn cl-btn--primary">
                  Run a feasibility check
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ======================= SCORECARD PREVIEW ========================== */}
        <section className="tb-section tb-section--muted" aria-labelledby="scorecard-heading">
          <div className="tb-container">
            <div className="tb-scorecard-head">
              <div className="tb-section-head" style={{ marginBottom: 0 }}>
                <span className="tb-eyebrow">What sponsors receive</span>
                <h2 className="cl-h2" id="scorecard-heading">
                  One scorecard per site, side by side
                </h2>
              </div>
              <Link href="/scorecard" className="cl-btn cl-btn--secondary cl-btn--sm">
                View live scorecard →
              </Link>
            </div>

            <div className="cl-table-wrap tb-scorecard-wrap">
              <table className="cl-table cl-table--hover">
                <thead>
                  <tr>
                    <th scope="col">Site</th>
                    <th scope="col">Enrollment capacity</th>
                    <th scope="col">Equipment fit</th>
                    <th scope="col">Certifications</th>
                    <th scope="col">Past performance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Hospital das Clínicas — São Paulo</td>
                    <td>
                      <span className="tb-score-cell">
                        <span className="tb-score-bar">
                          <span className="tb-score-bar__fill" style={{ width: "92%" }} />
                        </span>
                        92%
                      </span>
                    </td>
                    <td>
                      <span className="cl-badge cl-badge--success">Full match</span>
                    </td>
                    <td>GCP, ANVISA</td>
                    <td>
                      <span className="cl-badge cl-badge--success">On-time: 92%</span>
                    </td>
                  </tr>
                  <tr>
                    <td>Instituto Oncológico — Curitiba</td>
                    <td>
                      <span className="tb-score-cell">
                        <span className="tb-score-bar">
                          <span className="tb-score-bar__fill" style={{ width: "78%" }} />
                        </span>
                        78%
                      </span>
                    </td>
                    <td>
                      <span className="cl-badge cl-badge--warning">Partial — PET/CT offsite</span>
                    </td>
                    <td>GCP, ANVISA</td>
                    <td>
                      <span className="cl-badge cl-badge--success">On-time: 87%</span>
                    </td>
                  </tr>
                  <tr>
                    <td>Centro de Pesquisa — Porto Alegre</td>
                    <td>
                      <span className="tb-score-cell">
                        <span className="tb-score-bar">
                          <span className="tb-score-bar__fill" style={{ width: "65%" }} />
                        </span>
                        65%
                      </span>
                    </td>
                    <td>
                      <span className="cl-badge cl-badge--success">Full match</span>
                    </td>
                    <td>GCP</td>
                    <td>
                      <span className="cl-badge cl-badge--warning">On-time: 74%</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ================================ FAQ =============================== */}
        <section className="tb-section" id="faq" aria-labelledby="faq-heading">
          <div className="tb-container">
            <div className="tb-section-head tb-section-head--center">
              <span className="tb-eyebrow">Questions</span>
              <h2 className="cl-h2" id="faq-heading">
                Frequently asked questions
              </h2>
            </div>

            <div className="tb-faq-list">
              <details className="tb-faq-item">
                <summary>Is TrialBridge another site database like TriNetX or IQVIA?</summary>
                <div className="tb-faq-item__body">
                  No. Incumbent databases are built from historical and licensed data that skews
                  toward markets already saturated with trials. TrialBridge is connective
                  infrastructure: sites proactively declare their own current capacity, so
                  emerging-market capacity that&apos;s invisible elsewhere becomes visible here.
                </div>
              </details>
              <details className="tb-faq-item">
                <summary>How does a site&apos;s capacity get verified?</summary>
                <div className="tb-faq-item__body">
                  Sites declare patient populations, equipment, staff certifications, and past
                  trial performance directly. Certifications and trial history are checked against
                  supporting documentation as part of onboarding, and scorecards surface track
                  record so sponsors can weigh declared capacity against results.
                </div>
              </details>
              <details className="tb-faq-item">
                <summary>What is protocol softening, exactly?</summary>
                <div className="tb-faq-item__body">
                  It&apos;s a simulation that shows sponsors how loosening one eligibility
                  criterion at a time — for example, an ECOG cutoff or a lab threshold — changes
                  the number of eligible patients across responding sites, before committing to a
                  protocol amendment.
                </div>
              </details>
              <details className="tb-faq-item">
                <summary>Which markets does TrialBridge cover today?</summary>
                <div className="tb-faq-item__body">
                  TrialBridge is live with sites in Brazil, where registered clinical trial
                  activity has grown substantially over the past two decades. Additional emerging
                  markets are on the roadmap as site density grows.
                </div>
              </details>
              <details className="tb-faq-item">
                <summary>What does it cost to list a site or run a feasibility check?</summary>
                <div className="tb-faq-item__body">
                  Sites can declare capacity and appear in sponsor feasibility searches at no cost.
                  Sponsors get a free initial feasibility check per protocol; reach out for details
                  on deeper scorecard access and ongoing matching.
                </div>
              </details>
              <details className="tb-faq-item">
                <summary>How is this different from a CRO?</summary>
                <div className="tb-faq-item__body">
                  TrialBridge doesn&apos;t run trials or manage sites — it&apos;s the matching
                  layer that helps sponsors and CROs find sites with real capacity faster, and
                  helps sites get discovered without needing a global business-development team.
                </div>
              </details>
            </div>
          </div>
        </section>

        {/* ============================= CTA BAND ============================= */}
        <section className="tb-section tb-section--tight" aria-labelledby="cta-heading">
          <div className="tb-container">
            <div className="cl-card cl-card--raised tb-cta-band">
              <h2 className="cl-h2" id="cta-heading">
                Ready to see real capacity?
              </h2>
              <p className="cl-text-secondary">
                Whether you run a site or run clinical operations, TrialBridge shows you what&apos;s
                actually there.
              </p>
              <div className="tb-hero__ctas" style={{ justifyContent: "center" }}>
                <Link href="/sponsor" className="cl-btn cl-btn--primary cl-btn--lg">
                  Run a feasibility check
                </Link>
                <Link href="/site" className="cl-btn cl-btn--secondary cl-btn--lg">
                  List your site
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="tb-footer">
        <div className="tb-container">
          <div className="tb-footer__top">
            <div className="tb-footer__brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="tb-mascot-img tb-mascot-img--footer"
                src="/mascot/dr-capy.png"
                alt=""
                width={56}
                height={63}
              />
              <span className="tb-footer__brand-name">TrialBridge</span>
            </div>
            <div className="tb-footer__links">
              <div className="tb-footer__col">
                <h4>Product</h4>
                <a href="#how-it-works">How it works</a>
                <a href="#for-sites">For sites</a>
                <a href="#for-sponsors">For sponsors</a>
              </div>
              <div className="tb-footer__col">
                <h4>Demo</h4>
                <a href="#faq">FAQ</a>
                <Link href="/sponsor">Sponsor demo</Link>
                <Link href="/site">Site demo</Link>
              </div>
            </div>
          </div>
          <div className="tb-footer__bottom">
            <span>© 2026 TrialBridge. All rights reserved.</span>
            <span>Built with Claude — Life Sciences hackathon 2026</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
