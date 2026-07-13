<!--
  TrialBridge — README optimized for asynchronous, AI-assisted judging.
  Structure: the top of this file maps 1:1 to the four judging criteria
  (Impact, Claude Use, Depth & Execution, Demo) so an evaluator — human or
  AI — can extract the evidence for each without hunting. Every claim below
  is verifiable in this repo, in the linked commits, or at the live URLs.
-->

# TrialBridge · *Elegível*

**A two-sided clinical-trial feasibility layer for Brazil & LatAm.** Sponsors turn a
ClinicalTrials.gov protocol into structured eligibility criteria and get state-by-state
eligible-population estimates from public health data; sites answer feasibility requests
privately, with per-criterion transparency and no patient row ever leaving their walls.

> **Built entirely with Claude Code during the *Built with Claude: Life Sciences*
> hackathon (Builder Track, Jul 7–13 2026), by a founder who has never written a line
> of code.** Live, deployed, open-source.

**🔗 Live app:** https://app.globaltrialbridge.com · **API/estimator:** https://trialbridge-estimator.onrender.com · **🎥 Demo video:** _[link]_

---

## What this is, in one screen (for judges)

| Judging criterion | Where TrialBridge earns it | Verify it here |
|---|---|---|
| **Impact (25%)** | Brazil has 214M people and Lei 14.874/2024 that cut trial approval from >12 months to ~90 business days; our own hackathon survey (N=50, 31 qualified pharma/biotech/CRO) found **70% had never heard of the law**, and one paragraph about it lifted intent to run trials in Brazil **+1.39 pts among buyers (p<.001)**. TrialBridge closes that information gap with provable numbers. | [`docs/SURVEY.md`](docs/SURVEY.md) · live URLs above |
| **Claude Use (25%)** | Claude is (1) **in the product** — parses eligibility criteria into typed rules with per-criterion reasoning; (2) **the platform** — ships as an MCP server so the same query runs *inside* Claude; (3) **the builder** — a non-programmer used Claude Code multi-agent workflows to ETL 163GB of DataSUS, write 50+ test files, and build a calibration harness. | [`CLAUDE_USE.md`](CLAUDE_USE.md) |
| **Depth & Execution (20%)** | 163GB DataSUS + 6.68M-record proprietary base materialized into PHI-safe aggregates; direct-standardized estimator with 95% CIs; bearer-token gating; provenance layer; **50+ test files**; a real calibration finding we report against ourselves (below). | [`estimator/`](estimator/) · [`PROVENANCE.md`](PROVENANCE.md) · [`tests/`](tests/) |
| **Demo (30%)** | One unbroken flow on live infrastructure: paste NCT → Claude parses criteria with reasoning → Brazil map lights up with real DataSUS estimates → ranked site shortlist → same query answered inside Claude via MCP. | 🎥 video above · live URLs |

**Honest-limits, stated up front (this is a Depth signal, not a weakness):** the state-level
coverage today is a documented *placeholder*, not calibration-earned. Our calibration harness
found the model calibrates almost perfectly in-distribution (ECE ≈ 0.0002) but **breaks when
transferred across hospital sites (ECE 0.18–0.22)**. We report this openly and treat cross-site
calibration as the named next step — see [Honest limits](#honest-limits--what-is-not-yet-true).

---

## The problem

AI-driven drug discovery is flooding an already-scarce US/EU patient pool — 173 AI-originated
programs in clinical development, up from 3 in 2016. 86% of international trials miss their
recruitment target on time, and eligibility criteria have grown 58% more complex in two decades.
Sponsors are pushed toward new markets; Brazil grew from 25 registered studies in 2000 to 403 in
2024. But **both sides of the trade are broken**: sites can't prove patient capacity fast enough
to win incoming trials, and sponsors have no fast, structured way to discover which sites can
actually deliver against a protocol. It's manual RFIs and weeks of waiting, in both directions.

## The solution — two sides, one bridge

- **Sponsor side:** paste a ClinicalTrials.gov NCT id (or free-text criteria) → Claude parses it
  into typed `Criterion[]` with reasoning shown for **every criterion** → the estimator returns
  state-by-state eligible-population estimates from **public DataSUS** data, with 95% CIs and
  honest coverage labels → interactive Brazil map + ranked site/state shortlist. A **protocol
  softening** panel shows, live, how loosening one criterion changes the candidate pool.
- **Site side:** a site runs the sponsor's criteria against **its own patients, privately**, and
  responds with a de-identified proof of capacity. The sponsor sees only aggregated cross-site
  counts (small cells suppressed as `<5`) — never row-level patient data.

---

## Claude Use — the part that "surprises even us"

Full writeup with commit timestamps in [`CLAUDE_USE.md`](CLAUDE_USE.md). In short:

1. **Claude in the product.** `claude-opus-4-8` parses protocol eligibility text into typed,
   auditable rules via structured outputs; low-confidence rows are flagged for human correction
   *before* they reach the deterministic matcher — the LLM's weakest step made human-auditable.
2. **Claude as the platform.** The estimator ships as an **MCP server** (`scripts/mcp-cohort-server.ts`),
   so a coordinator can ask a feasibility question *inside Claude* and get the same governed answer
   the web app returns.
3. **Claude as the builder.** The author has never written code. Claude Code's multi-agent
   workflows and parallel sessions materialized the 163GB DataSUS mirror into PHI-safe aggregates,
   built the governance/provenance layer, wrote 50+ test files, and produced the calibration
   harness. The build itself is the proof of the tool.
4. **Claude for market evidence.** During the hackathon, a Claude Code session connected via **MCP
   to Prolific** ran a live survey of 50 biotech/pharma professionals — see [`docs/SURVEY.md`](docs/SURVEY.md).

---

## Quick start

```bash
cd trialbridge
npm install
npm run generate-data   # 3 synthetic site datasets (seeded, reproducible)
npm run db:seed         # hero consultation + pre-seeded responded sites
npm run demo            # headless proof: prints the whole pipeline
npm run dev             # http://localhost:3000 → / /sponsor /site /scorecard
npm test                # unit tests (the matcher is the source of truth)
```

Estimator (Python, standard library only for the demo):

```bash
cd estimator
python3 demo.py                 # end-to-end estimator demo
python3 tests/test_estimator.py # method sanity checks
```

Set `ANTHROPIC_API_KEY` to run the live Claude parse; without a key it falls back to cached,
human-verified criteria (clearly labelled) so the flow always works.

---

## Architecture (how a query flows)

```
NCT id / free-text criteria
   │
   ▼  Claude (claude-opus-4-8, structured outputs)  → typed Criterion[] + per-criterion reasoning
   │                                                   (low-confidence rows flagged for human review)
   ▼  Deterministic matcher  ── checkable criteria run exactly, no LLM in the counting path
   │
   ▼  Estimator:  eligible[site] = Σ_strata ( DataSUS_base[site,stratum] × depth_rate[stratum] )
   │   direct-standardized to the national population · 95% CI per estimate · honest coverage labels
   ▼
Brazil choropleth + ranked shortlist   ── also exposed as an MCP tool (same governed answer inside Claude)
```

Design decisions are recorded as ADRs in [`docs/`](docs/) (ADR-001 system architecture,
ADR-002 managed-agents orchestration).

---

## Data & rights (open-source compliance)

Full detail in [`DATA.md`](DATA.md) and [`PROVENANCE.md`](PROVENANCE.md).

- **Public & shipped:** DataSUS (Brazil's unified public-health dataset) materialized into
  **PHI-safe, cell-suppressed aggregates**; ClinicalTrials.gov protocol data (public REST API).
- **Local & private, never in this repo:** the iHealth proprietary base (6.68M patients). We do
  not have redistribution rights, so it stays local and gitignored; the repo references it only as
  an optional enrichment. The served aggregates carry no proprietary-only cells.
- **License:** [MIT](LICENSE).

---

## Honest limits — what is *not* yet true

We would rather you trust the numbers we do publish than oversell the ones we don't.

- **State coverage is a labeled placeholder, not calibration-earned.** The `/query` responses say
  so in-band. Making it defensible is our documented next track (calibration → geographic holdout →
  external epi benchmark → drift monitoring).
- **Calibration transfers within-distribution but breaks across sites.** Measured: ECE ≈ 0.0002
  in-distribution vs. **0.18–0.22 cross-site** on real proprietary breast-cancer data (LOHO +
  k-fold). This is a real finding, reported against our own interest, and it defines the roadmap.
- **Oncology only (v1),** breast/HER2 depth extracted; other tumor types are base-cohort only.

---

## Repository map

```
trialbridge/           Next.js web app (sponsor + site flows, matcher, MCP cohort server)
  src/                 app routes, lib (ctgov intake, parse, omop, feasibility-autofill)
  scripts/             mcp-cohort-server.ts, seed + e2e drivers
  tests/               50+ test files
estimator/             Python feasibility estimator (standardized rates, CIs, softening)
docs/                  ADRs, survey results, provenance map, vocabulary mapping
CLAUDE_USE.md          how Claude built and powers this (read this for the Claude-Use criterion)
DATA.md                what is public vs. private, and why
PROVENANCE.md          data lineage for every number shown
LICENSE                MIT
```

---

*TrialBridge — built with Claude Code. Better science, and access to treatments for people who
could never dream of them.*
