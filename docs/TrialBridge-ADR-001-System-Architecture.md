# ADR-001: TrialBridge System Architecture (Hackathon v1)

**Status:** Proposed
**Date:** 2026-07-04
**Deciders:** Angelo (solo build)
**Supersedes:** —
**Related:** TrialBridge Product Spec (Life Sciences Hackathon, Build Track, Jul 7–13 2026)

---

## Context

TrialBridge is a two-sided clinical-trial feasibility tool: sponsors post a protocol's eligibility criteria; sites run those criteria against their own patient population privately and respond with a de-identified proof-of-capacity; the sponsor sees aggregated candidate counts and can simulate loosening criteria ("protocol softening").

The architecture has to serve an unusually specific set of forces:

- **Solo developer, 7 calendar days.** Every component added is a component maintained alone. Minimizing surface area and staying in one language matters more than picking the theoretically best tool per layer.
- **Two distinct user roles, one shared engine.** Sponsor and site screens look different but sit on top of the same matching logic. Duplicating that logic is the main thing to avoid.
- **The risky part is the LLM parse, not the matching.** Free-text oncology eligibility → machine-checkable rules is the single highest-variance step, and everything downstream (matching, softening, aggregation) inherits its errors. The architecture must isolate and de-risk it.
- **Trust is a product requirement, not a nice-to-have.** Goals 3 and 4 demand per-criterion transparency and auditable softening. This forces a *deterministic* matcher — the LLM cannot be in the scoring loop.
- **The demo must not fail live** (red-team finding). Live LLM calls and live data generation on stage are failure modes. The system needs a frozen, offline-capable demo mode.
- **It must still run the week after** (Goal 6). Rules out anything that only works as a throwaway script on the builder's laptop with uncommitted state.
- **Credibility beats scale** (red-team finding). Non-goals already accept simulated scale. To compensate, at least one side of the loop should be anchored in *real* external data (a real ClinicalTrials.gov protocol), and the privacy boundary must survive small-cell re-identification, not just be asserted.

### Non-functional requirements

| NFR | Target | Source |
|-----|--------|--------|
| Paste criteria → ranked matches | < 30 s | Spec success metrics |
| Softening toggle → updated pool count | Immediate / < 1 s | Spec success metrics |
| Explain any match from UI alone | < 10 s for a viewer | Spec success metrics |
| Privacy boundary visible in UI | Self-evident, not asserted | Spec cross-cutting story |
| Runs after hackathon week | Yes, redeployable | Goal 6 |
| Demo runs without network | Yes (frozen mode) | Red-team |
| Scope | Oncology only | Non-goals |

---

## Decision

Build TrialBridge as a **single TypeScript Next.js application (App Router)** with server-side route handlers hosting a **pure-function deterministic matching engine**. Claude is called for **one job only — parsing free-text criteria into a typed rule schema — and its output is cached and human-verified before it ever reaches the matcher.** Data lives in **SQLite via Prisma**, seeded with three synthetic oncology patient datasets and one real ClinicalTrials.gov protocol. Roles are separated by route, not by a real auth system. An **aggregation layer enforces minimum-cell-size suppression** so cross-site counts can't re-identify a small site. The app ships with a **frozen demo mode** that serves a seeded snapshot and pre-parsed criteria so nothing on the critical demo path requires a live model call or network.

One sentence: *one language, one datastore, one engine called from two screens, with the only non-deterministic step pushed offline and cached.*

---

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Next.js app (TypeScript)                      │
│                                                                   │
│   /sponsor  (post consultation, aggregated view, softening)       │
│   /site     (browse consultations, run matcher, submit capacity)  │
│        │                         │                                │
│        └──────────┬──────────────┘                                │
│                   ▼                                               │
│         Route handlers (/api/*)                                   │
│                   │                                               │
│   ┌───────────────┼───────────────────────────────────────────┐  │
│   │  1. Parse service   (Claude → Criterion[], cached+verified)│  │
│   │  2. Matching engine (pure fn: patient × Criterion[] → eval)│  │
│   │  3. Softening sim    (re-run engine with 1 rule relaxed)   │  │
│   │  4. Aggregation      (counts only + min-cell suppression)  │  │
│   └───────────────┬───────────────────────────────────────────┘  │
│                   ▼                                               │
│            Prisma  →  SQLite (seeded)                             │
│   Patients (per site) · Consultations · Responses · ParsedCriteria│
└─────────────────────────────────────────────────────────────────┘
         ▲ demo mode: frozen snapshot, no network, no live LLM
```

The seven logical pieces:

1. **Criteria ingestion & parse service.** Accepts pasted protocol text (or a ClinicalTrials.gov ID for the *authoring* step, done offline). Calls Claude once to emit a `Criterion[]`, persists it, and renders it back to the user for verification/editing. Verified output — not raw model output — is what the matcher consumes.
2. **Criterion schema (the contract).** A typed, machine-checkable representation shared by parse, match, and softening. This is the most important interface in the system; get it right on Day 1.
3. **Deterministic matching engine.** A pure function with no I/O and no model calls: `(patient, Criterion[]) → { perCriterion: {id, status: pass|fail|unknown}[], score }`. Purity is what makes it unit-testable, instant, and honest.
4. **Softening simulator.** For each criterion, re-run the engine across the cohort with that one rule relaxed or removed, and diff the passing count against baseline. Trivial and correct *because* the engine is a pure function.
5. **Consultations & responses store.** Sponsor postings and site proof-of-capacity submissions. Plain relational rows.
6. **Aggregation / privacy layer.** The only path by which one actor sees another's data. Returns counts and bottleneck criteria — never rows — and suppresses any cell below a threshold (default n < 5) to `"<5"`.
7. **Two role views** over a shared component/engine layer.

---

## The Criterion schema (load-bearing interface)

```ts
type Operator =
  | "eq" | "neq" | "lt" | "lte" | "gt" | "gte"
  | "in" | "not_in" | "exists" | "not_exists" | "between";

interface Criterion {
  id: string;                 // stable, referenced by matcher + softening UI
  kind: "inclusion" | "exclusion";
  field: string;              // e.g. "ecog", "her2_status", "prior_lines"
  operator: Operator;
  value: string | number | (string | number)[] | null;
  unit?: string;              // e.g. "mg/dL"; null-safe comparisons
  rawText: string;            // original protocol sentence — for audit/UI
  confidence: number;         // parser self-report; low-confidence flagged for review
}
```

Design notes that matter for trust:

- **`status: "unknown"` is a first-class outcome.** If a patient record lacks the field a criterion needs, the result is `unknown`, never a silent `fail`. This is what lets a viewer explain a non-match in 10 seconds ("we don't have HER2 status for her") and is where real feasibility work actually lives.
- **`rawText` travels with every rule** so the UI can always show the source sentence next to the pass/fail — auditability by construction.
- **`confidence` drives the human-in-the-loop.** Low-confidence parses surface for verification. In the demo, deliberately show one wrong parse being corrected by the site coordinator — it turns the parse weakness into the trust feature.

---

## Data model (Prisma sketch)

```
Site            id, name, country, city
Patient         id, siteId, diagnosis, stage, biomarkers(json),
                priorLines, labs(json), sex, age            // synthetic only
Consultation    id, sponsorName, title, protocolText, sourceUrl, createdAt
ParsedCriteria  id, consultationId, criteria(json Criterion[]), verifiedAt
Response        id, consultationId, siteId, matchedCount,
                bottleneckCriterionId, submittedAt          // NO patient rows
```

Note the shape enforces the privacy model at the schema level: a `Response` carries a **count and a bottleneck reference, not a patient list.** A sponsor querying responses physically cannot reach row-level patient data because it was never written into the response.

---

## Options Considered

### Decision 1 — Application stack

#### Option A: TypeScript full-stack, Next.js (App Router) — **chosen**

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low–Med — one language, one repo, one deploy |
| Cost | Free tier hosting (Vercel/Railway/Render) |
| Scalability | Irrelevant at demo scale; fine later |
| Team familiarity | Solo — one mental context, no API contract to maintain between front and back |

**Pros:** Single language front-to-back; server route handlers give a natural home for the engine; first-class TS types make the `Criterion` contract self-enforcing across UI, API, and matcher; polished two-screen UI is achievable; trivially redeployable (Goal 6).
**Cons:** SQLite on serverless needs care (see Decision 2); slightly more ceremony than a notebook-grade tool.

#### Option B: Python FastAPI backend + React frontend

| Dimension | Assessment |
|-----------|------------|
| Complexity | Med–High — two languages, an API contract to keep in sync |
| Cost | Free tier available |
| Scalability | Fine |
| Team familiarity | Strong if the builder is a data/Python native |

**Pros:** Python is the comfortable home for any data-wrangling and synthetic-data generation; strong typing available via Pydantic.
**Cons:** For a solo dev, maintaining a front/back contract *and* two dependency ecosystems is exactly the overhead a 7-day build can't spare. The `Criterion` type now has to be kept consistent in two languages.

#### Option C: Python-only, Streamlit / Gradio

| Dimension | Assessment |
|-----------|------------|
| Complexity | Lowest — fastest to a running thing |
| Cost | Free |
| Scalability | Poor, but out of scope |
| Team familiarity | Very approachable |

**Pros:** Fastest path to *a* demo; excellent for the matching/softening logic itself.
**Cons:** Two genuinely different role UIs and a "privacy boundary that is visually self-evident" fight Streamlit's single-flow, single-user model. It reads as a data-science prototype, not a two-sided product — which undercuts the pitch. Weaker post-hackathon story.

**Why A wins for this build:** the deciding factor isn't raw speed-to-first-run (C wins that) — it's that the product's whole credibility rests on (a) two distinct roles and (b) a visible privacy wall, both of which are natural in a real web app and awkward in Streamlit, plus the solo-dev benefit of one language enforcing the `Criterion` contract everywhere.

### Decision 2 — Persistence

#### Option A: In-memory

Fast to build, but violates Goal 6 (nothing survives a restart) and makes the frozen-demo snapshot awkward. Rejected as the primary store.

#### Option B: SQLite via Prisma — **chosen for dev + demo**

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — file-based, zero infra, migrations via Prisma |
| Cost | $0 |
| Scalability | Ample for 3 sites × ~250 patients |
| Familiarity | Prisma schema is readable and typed end-to-end |

**Pros:** The seeded database file *is* the frozen demo snapshot — commit it and the demo runs offline and identically every time (directly addresses the "don't run live on stage" red-team point). Trivial to seed and reset.
**Cons:** On serverless platforms the filesystem is ephemeral. Two clean answers: run the demo on a persistent Node host (Railway/Render/local), or flip Prisma's datasource to Postgres for the hosted version — the schema and query code are unchanged.

#### Option C: Hosted Postgres (Supabase)

The right call *only if* you plan to keep building a real hosted product immediately after the week. For the demo it adds network dependency and a failure mode on stage. **Recommendation: build on SQLite, keep the Prisma datasource swappable, and move to Supabase post-hackathon if the project continues** — captured as an action item, not week-1 work.

### Decision 3 — Where does the LLM sit?

#### Option A: Parse at demo time, live

Rejected. Puts a network- and latency-variable, occasionally-wrong step on the critical demo path.

#### Option B: Parse offline, cache, verify — **chosen**

The hero protocol is parsed ahead of time, the `Criterion[]` is reviewed and stored, and the demo replays the verified artifact. The *capability* ("paste any protocol and we parse it") is still shown once, live-but-safe, early in the build with a fallback; the *demo-critical* path uses the cached artifact. This is the single most important reliability decision in the system.

### Decision 4 — Matching: rules vs. model

Deterministic rule evaluation is **chosen** over any LLM-scored matching, and this is non-negotiable given Goals 3–4. An LLM "match score" cannot be audited criterion-by-criterion, can't be unit-tested, and makes the softening simulation meaningless (you can't cleanly attribute a pool change to one relaxed rule if a model is guessing the whole thing). The model parses; arithmetic and comparison operators decide.

---

## Trade-off Analysis

The central trade the whole design makes is **giving up per-layer optimality to buy solo-maintainability and demo reliability.** A Python data stack would be marginally nicer for synthetic-data generation; a live-parse flow would be marginally more impressive "look, it's really AI." Both are declined because the failure modes they introduce (two-language drift; on-stage model/network flakiness) are exactly the ones a solo builder can least afford in the final 48 hours.

The second trade is **determinism over apparent intelligence.** The matcher is "dumb" arithmetic on purpose. That dumbness is the product: it's what makes every match explainable and every softening number trustworthy. The intelligence is concentrated in the one place it's actually needed and can be checked by a human — the parse.

The third trade is **enforcing privacy in schema/logic, not infrastructure.** Real federation (data never leaving origin) is deferred to v2. The honest mitigation is (a) writing responses as counts-not-rows so the boundary is structural, and (b) min-cell suppression so the aggregate can't leak a small site. This is defensible in a pitch *if stated plainly*; overselling it as "federated" is the trap.

---

## Consequences

**Becomes easier:**

- Adding the softening simulator — it's a loop over the pure matcher, essentially free once the engine exists.
- Explaining any result in the UI — `rawText` + per-criterion status are already carried on every evaluation.
- Running a reproducible demo — the seeded SQLite file is the snapshot.
- Post-hackathon continuation — swap datasource to Postgres, add real auth, keep everything else.

**Becomes harder / accepted costs:**

- Real federated matching is explicitly *not* here; it's a v2 rebuild of the aggregation layer, not a tweak.
- SQLite forces a hosting choice (persistent host or Postgres swap) before anything is publicly hosted.
- The parse verification UI is extra week-1 work that a live-parse demo would skip — but it's also what makes the trust story real.

**Will need to revisit:**

- The `Criterion` schema will meet oncology criteria it can't express (temporal logic like "≥2 prior lines *including* a platinum agent", nested AND/OR). Decide Day 1 how much of that to support vs. represent as `unknown` and defer.
- Min-cell threshold (n<5) is a guess; revisit against how many synthetic patients each site holds.

---

## Risks & Mitigations (folding the earlier red-team)

| Risk | Mitigation | Owner day |
|------|-----------|-----------|
| Parser mis-structures messy oncology criteria | Cache + human-verify; `confidence` flags; `unknown` fallback; hand-parse the hero protocol | Mon/Tue |
| Demo overlaps with TriNetX/IQVIA on shown features | Make the two-sided loop the hero moment, not the softening slider; name incumbents in the pitch | Sat |
| Closed-loop credibility (you author patients *and* criteria) | Anchor the protocol in a real ClinicalTrials.gov entry; generate patients blind to criteria | Mon |
| Small-cell re-identification in aggregate | Min-cell-size suppression in the aggregation layer | Thu |
| "So it's not really federated?" | Counts-not-rows schema + rehearsed 10-sec v2 (secure enclave) answer | Thu/Sat |
| Live failure on stage | Frozen demo mode: seeded DB + pre-parsed criteria, no network on critical path | Fri/Sun |

---

## Action Items (mapped to the spec timeline)

1. [ ] **Mon** — Lock the `Criterion` schema and the Prisma data model *first* (everything keys off these). Generate 3 synthetic datasets blind to the criteria. Pick and store one real ClinicalTrials.gov oncology protocol as the hero.
2. [ ] **Mon** — Scaffold the Next.js app, Prisma + SQLite, seed script, `/sponsor` and `/site` routes as stubs.
3. [ ] **Tue** — Build the deterministic matching engine as a pure, unit-tested function. Tests are the verification step — cover pass, fail, and `unknown`.
4. [ ] **Tue** — Build the parse service (Claude → `Criterion[]`) + verification UI; parse and store the hero protocol.
5. [ ] **Wed** — Consultation posting (sponsor) + discovery/response (site) flows against the store.
6. [ ] **Thu** — Aggregation layer with min-cell suppression; sponsor aggregated view; softening simulator + toggle UI.
7. [ ] **Fri** — Feasibility scorecard export (P1); polish both UIs; wire frozen demo mode.
8. [ ] **Sat** — Bilingual toggle if time (English-first, PT toggle for narrative); write + rehearse demo off the frozen snapshot.
9. [ ] **Sun** — Dry run, cut anything shaky, verify offline demo path, submit.
10. [ ] **Post-week** — If continuing: swap Prisma datasource to Supabase Postgres, add real auth, host.

---

## Open Decisions (need a call, don't block Day 1)

- How much temporal/nested criterion logic to support in v1 vs. represent as `unknown`? (Leaning: support flat comparisons + `in`/`not_in`; defer nested logic to `unknown` with the raw sentence shown.)
- Deploy target for the "still runs next week" promise: persistent Node host now, or Postgres swap + Vercel? (Leaning: local + Railway for the week; decide hosting only if the project continues.)
- Min-cell threshold value once dataset sizes are fixed.
```

