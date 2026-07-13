# How Claude Built and Powers TrialBridge

*This document exists for the **Claude Use (25%)** judging criterion. Every claim is
verifiable in this repo's commit history, the linked source files, or the live URLs.*

**The one-line version:** the author of this project has **never written a line of code**.
Eight months ago he did not know how to deploy a landing page. Everything here — a deployed,
access-gated web app, a 163GB data pipeline, an MCP server, a calibration harness, 50+ test
files — was built with Claude Code. TrialBridge is simultaneously *built by* Claude, *powered
by* Claude in production, and *shipped as* a Claude-native tool.

---

## 1. Claude **in the product** (runtime)

- **Eligibility parsing with per-criterion reasoning.** At `/sponsor/new`, `claude-opus-4-8`
  parses free-text protocol eligibility (or a fetched ClinicalTrials.gov protocol) into a typed
  `Criterion[]` via **structured outputs**. Each criterion carries Claude's reasoning and a
  confidence; low-confidence rows are surfaced for human correction *before* they reach the
  deterministic matcher. → `src/lib/parse.ts`, `src/app/api/parse/route.ts`
- **Why this is more than "call an LLM":** the LLM does the ambiguous linguistic work (turning
  prose into rules) and is deliberately kept *out* of the counting path. The counting is
  deterministic and auditable. The design makes the model's weakest step the one a human checks.

## 2. Claude **as the platform** (Claude-native delivery)

- The estimator ships as an **MCP server** — `scripts/mcp-cohort-server.ts` — so a research
  coordinator can ask the same feasibility question *inside Claude* and receive the same governed,
  provenance-labeled answer the web app returns. The product is not just "a web app that uses
  Claude"; it is also a tool Claude itself can wield.
- Tested end-to-end: see `tests/autofill-cohort-mcp.test.ts`, `tests/autofill-mcp-client.test.ts`.

## 3. Claude **as the builder** (the meta-story)

A non-programmer orchestrated Claude Code to produce infrastructure-grade work:

- **Multi-agent / parallel-session workflows** materialized a **163GB DataSUS mirror** (890M-row
  condition table + 63M-row person table) and a 6.68M-record proprietary base into small,
  **PHI-safe aggregates** the cloud can serve — without shipping any raw data. → `estimator/`,
  `PROVENANCE.md`
- **50+ test files** across intake, matcher, concept-map golden tests, provenance, and
  orchestration. → `tests/`
- **A governance + provenance layer**, bearer-token gating on the estimator, and honest coverage
  labels — the unglamorous production concerns, all authored through Claude Code.
- **A calibration harness** that produced a genuine scientific finding reported against the
  author's own interest (in-distribution ECE ≈ 0.0002 vs. cross-site ECE 0.18–0.22).

## 4. Claude **for market evidence** (during the hackathon)

- A Claude Code session connected via **MCP to Prolific** designed and ran a live survey of 50
  biotech/pharma/CRO professionals, then analyzed the results — surfacing that 70% had never heard
  of Brazil's Lei 14.874/2024 and that one paragraph of information lifted buyer intent +1.39 pts
  (p < .001). → `docs/SURVEY.md`

---

## Why this "surprises even us"

The interesting artifact is not any single feature — it is that the **entire stack, from a 163GB
ETL to an MCP server to a statistically-significant market study, was produced by someone who
cannot write code**, using Claude Code as the sole engineering surface. That is the capability the
tool is meant to unlock, demonstrated end to end on a real, deployed, healthcare product.
