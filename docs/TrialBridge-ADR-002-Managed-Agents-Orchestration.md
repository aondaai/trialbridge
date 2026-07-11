# ADR-002: Managed-Agents Orchestration for Feasibility Autofill

**Status:** Proposed
**Date:** 2026-07-11
**Deciders:** Angelo
**Supersedes:** —
**Related:** [ADR-001](TrialBridge-ADR-001-System-Architecture.md); [feasibility-autofill-reconciliation.md](feasibility-autofill-reconciliation.md); [feasibility-autofill-spec.md](feasibility-autofill-spec.md); Claude Managed Agents docs (managed-agents/overview)

---

## Context

The Feasibility Autofill module (epics F0–F6, `src/lib/feasibility-autofill/**`) is built: an
arbitrary sponsor feasibility form is ingested, each field routed to one of four archetypes, and
answered — **A** (institution profile lookup), **B** (capability-catalog lookup), **C** (patient-count
query), **D** (LLM narrative draft) — with provenance on every field and a human-in-the-loop review
gate. Today it runs as pure functions inside the Next.js app, invoked synchronously per request.

Two things make a managed multi-agent harness (Claude Managed Agents, "MCA") attractive here:

- **The archetype split is already an agent-decomposition boundary.** Routing → A/B/C/D → assemble is
  a natural orchestrator-plus-workers shape; we would otherwise hand-roll the loop, sandboxing, and
  fan-out that MCA provides.
- **The highest-value workloads are long-running, async, and scheduled** — a network feasibility sweep
  across many sites, nightly capability-catalog revalidation, proactive matching when a new study
  lands on ClinicalTrials.gov. These are exactly MCA's stated sweet spots.

But the decision is dominated by one force:

- **Data residency is a hard product invariant, and MCA cloud does not satisfy it for patient data.**
  Our LGPD posture (spec §9; enforced in `matcher/aggregate.ts` and `resolvers/cohort.ts`) is
  *aggregates leave, patient rows never do*. The MCA docs state plainly that Managed Agents is
  **stateful, stores session/sandbox state server-side, and is not eligible for Zero Data Retention or
  a HIPAA BAA.** Therefore **no component that touches patient rows may run in an MCA cloud sandbox.**
  Archetype C is the only such component.

Secondary forces carried over from ADR-001: the LLM must never be in the scoring loop and never has
submit authority; every surfaced value must be a provenanced `Metric`; the deterministic ~80% (A/B/C)
must stay reproducible and auditable.

---

## Decision

Introduce a **Managed-Agents orchestrator that coordinates A, B, and D only. Archetype C remains the
site's own service** (the existing TypeScript matcher / Python estimator), which the orchestrator
calls as a **plain MCP tool** that returns aggregates only. MCA never sees a patient row.

One sentence: *the cloud orchestrates the parts that touch no patient data; the count that touches
patient data stays home and answers over MCP with suppressed aggregates.*

Concretely:

1. **Orchestrator agent (MCA cloud).** Receives a feasibility request, runs F1 ingest+classify to
   route each field, dispatches to resolvers, assembles answers, and enforces the provenance gate
   (`assertProvenanced`) on the assembled result — exactly as `scorecardFeed.ts` does today.
2. **A / B resolvers are TOOLS, not agents.** `resolveProfileByLabel` and `resolveCapability` are
   deterministic, provenanced, sub-millisecond pure functions. They are exposed to the orchestrator as
   tool calls. Wrapping them in reasoning loops would add latency, cost, and nondeterminism to the very
   part of the form whose value is that it is auditable. **They stay pure; MCA calls them.**
3. **C stays the site's service, reached over MCP.** The cohort engine runs where it runs today — the
   site's own infrastructure — behind an MCP tool `cohort.preview({criteria}) → {n, perCriterionDelta[],
   suppressed}` (the shape `toCohortPreview` already emits). Small-cell suppression and the "no rows in
   the payload" guarantee are unchanged and now also a network boundary.
4. **D narrative is an agent (MCA cloud), gated by a critic.** The narrative resolver (the one new LLM
   surface, `resolvers/narrative.ts`) drafts grounded in RAG exemplars. A second **critic agent** — sole
   job: "is every clause grounded in a cited exemplar or fact? refute it" — runs before any draft
   reaches human review. D output is **always `status: "proposed"`**; approval remains a human event
   (`review.ts`). The LLM never approves, renders, or counts.
5. **Fan-out is the multiplier.** For a network sweep, the orchestrator spawns one session per site
   and, within each, resolves the 16 sections concurrently. This is MCA's long-running async workload
   and is the single biggest reason to adopt it.
6. **Scheduled deployments own freshness.** A cron-scheduled agent revalidates `CapabilityCatalog`
   (`lastValidatedAt`, the F5 "stale catalog" risk), re-indexes the prior-answer RAG store, and
   pre-computes feasibility when a new matching study appears (via the existing ctgov MCP surface).

### Residency split

```
                     ┌──────────────── MCA cloud sandbox (no patient data) ────────────────┐
  feasibility  ─────►│  Orchestrator agent                                                  │
  request (.docx)    │    ├─ F1 ingest + classify (route each field A/B/C/D)                 │
                     │    ├─ A profile     ── tool (pure, provenanced Metric)                │
                     │    ├─ B capability  ── tool (pure, provenanced Metric)                │
                     │    ├─ D narrative   ── agent → critic agent → status:"proposed"       │
                     │    └─ assemble + assertProvenanced + render-diff guard                │
                     └───────────────────────────────┬──────────────────────────────────────┘
                                                     │ MCP: cohort.preview({criteria})
                                                     │      → {n, perCriterionDelta[], suppressed}
                     ┌───────────────────────────────▼──── site infrastructure (patient data) ┐
                     │  C cohort service (existing matcher / estimator)                        │
                     │    runs criteria over patient ROWS, returns AGGREGATES ONLY (<5 suppressed)│
                     └─────────────────────────────────────────────────────────────────────────┘

  Human coordinator ── steer/interrupt events ──► orchestrator (edit D drafts, approve; D never auto-approves)
```

---

## Consequences

**Positive**

- Patient data never touches Anthropic infra; the LGPD invariant is now enforced by *physical sandbox
  location*, not only by code discipline. The ZDR/BAA gap in MCA cloud is sidestepped, not accepted.
- Network-scale feasibility (E6) becomes a concurrent fan-out instead of sequential work; freshness
  becomes a scheduled job instead of a manual chore.
- We delete our future need for a bespoke agent loop, sandbox, and tool-execution layer; MCA supplies
  the harness, persistence, steer/interrupt, and scheduling.
- The critic agent raises the floor on D quality without weakening the human gate.

**Negative / risks**

- **Two runtimes to operate.** The site now runs an MCP endpoint for C (self-hosted) alongside the
  cloud orchestrator. More moving parts than today's single app. Mitigation: C's MCP surface is a thin
  wrapper over functions that already exist; no new logic.
- **Complementary-release leakage is unchanged.** MCP returns suppressed aggregates, but repeated
  softening queries can still narrow a suppressed cell (the honest limit already noted in
  `aggregate.ts`). MCA adds no protection here; full DP remains out of scope. Rate-limit `cohort.preview`.
- **Non-determinism creep.** The temptation to "let an agent handle B when the catalog is thin" must be
  resisted — that relaxes the auditability guarantee. Guardrail: A/B/C outputs are Metrics produced by
  pure code; agents may *orchestrate* them but not *fabricate* them. The orchestrator asserts
  `assertProvenanced` on everything it assembles.
- **Cost/latency of fan-out.** Many sessions × many sections is real spend; scope sweeps and cache
  aggressively (MCA's built-in prompt caching helps).

**Neutral**

- The Next.js app remains the system of record and the human review surface (`/site/feasibility`); MCA
  is an execution layer above the existing pure resolvers, not a replacement for them.

---

## Alternatives considered

1. **Run everything, including C, in MCA cloud sandboxes.** Rejected: persists patient-derived state on
   infra with no BAA/ZDR — a direct violation of the product's core invariant.
2. **Run C in an MCA *self-hosted* sandbox.** Viable and compliant, but adds an MCA dependency to the
   one component that already works as a plain service. We chose the lower-coupling option: keep C as
   the site's own service and expose it over MCP. (Revisit if a site wants MCA to manage that sandbox.)
3. **Agent-ify A/B/C as reasoning workers.** Rejected: adds latency, cost, and nondeterminism to the
   deterministic ~80% whose entire value is reproducibility. They stay tools.
4. **Stay fully synchronous in the Next.js app (status quo).** Fine for single-site, single-form use;
   leaves network-scale sweeps, scheduling, and steer/interrupt on the table. MCA is additive — adopt it
   for the async/at-scale workloads, not to replace the interactive path.

---

## Rollout (phased, each independently shippable)

| Phase | Deliverable | Proves |
|---|---|---|
| M0 | Wrap C as an MCP tool (`cohort.preview`) over the existing resolver; run it as the site's service | The residency boundary + aggregate-only contract, no MCA yet |
| M1 | MCA orchestrator: one request, one site — route → A/B tools + C over MCP + D agent → assemble | End-to-end autofill through the harness with the provenance gate intact |
| M2 | D critic agent before human review | D quality floor without weakening the human gate |
| M3 | Fan-out: one study → N sites × 16 sections concurrently | Network-scale sweep (E6) |
| M4 | Scheduled deployment: nightly catalog revalidation + RAG re-index + new-study pre-match | Freshness as a job (kills the stale-catalog risk) |

**Invariants that hold across all phases:** no patient row leaves the site boundary; every surfaced
value is a provenanced `Metric`; D is always `proposed` and never auto-approved; A/B/C are pure code
that agents orchestrate but never fabricate.
