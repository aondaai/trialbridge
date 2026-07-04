# TrialBridge · *Elegível*

**A two-sided discovery layer for clinical-trial site feasibility.** Sponsors post a
protocol's eligibility criteria; sites run them against their own patients *privately*
and respond with a de-identified proof of capacity; the sponsor sees aggregated
candidate counts and can loosen any criterion in real time ("protocol softening").

Built for the *Built with Claude: Life Sciences* hackathon (Build Track, Jul 7–13 2026).
Oncology only (v1). Synthetic/de-identified data only.

---

## Quick start

```bash
cd trialbridge
npm install
npm run generate-data   # writes 3 synthetic site datasets to data/ (seeded, reproducible)
npm run db:seed         # writes the hero consultation + pre-seeds sites B & C as responded
npm run demo            # headless proof: prints the whole pipeline to the console
npm run dev             # http://localhost:3000  → / (landing), /sponsor, /site, /scorecard
npm test                # 19 unit tests (the matcher is the source of truth)
```

> **Path note:** npm scripts call binaries via `./node_modules/.bin/…` because this
> project lives under a folder whose name contains a colon (`…Claude:…`), which
> corrupts npm's `PATH` injection. Next.js itself runs fine from that path.

---

## The demo in 90 seconds

1. **Marcus (sponsor)** has posted a Phase III HER2+ metastatic breast cancer trial.
2. **Camila (site)** opens `/site`, sees the matcher run over her 220 patients with
   per-criterion transparency, and clicks **Submit proof of capacity** — one live write.
3. **Marcus** opens `/sponsor`: three sites have responded, he sees aggregated counts
   (small cells shown as `<5`), a funnel-discounted deliverable estimate, and a
   **softening panel**. He loosens **HER2 status** and the confirmed-eligible pool jumps
   — *with the jump split into genuine gains vs. "only newly definite because HER2 was
   unknown."*

`npm run demo` prints all of this headlessly (the numbers on screen come from the same
service layer).

---

## What makes the matches trustworthy

The **matcher is a pure, deterministic function** — the LLM is only ever used to parse
free-text criteria into a typed schema (parsed offline, verified, cached). Arithmetic and
comparisons decide every match, so every verdict is explainable and every softening number
is attributable.

Key semantic decisions (all unit-tested):

- **Tri-state cohorts** — every patient is `definite` (passes all, zero unknowns),
  `possible` (would pass but has ≥1 unknown field), or `excluded`. A single opaque
  "matched count" is never reported.
- **`unknown` is first-class** — missing data is never a silent pass or fail. For an
  **exclusion** criterion, missing data is treated *conservatively*: the patient stays
  `possible`, never auto-`definite`.
- **Honest softening** — relaxing a criterion re-scores the pool and splits the gain into
  *genuinely newly eligible* (were failing it) vs. *"newly definite" only because the
  field was unknown* (still unproven — the caveat bucket). A mostly-unknown criterion
  can't masquerade as real capacity.
- **Composite criteria** — a sentence like "adequate organ function" expands to several
  lab thresholds grouped under one handle; the softening toggle acts on the whole group.
- **Unit canonicalization** — labs arrive in different units across sites (creatinine
  mg/dL vs µmol/L, hemoglobin g/dL vs g/L). They're canonicalized at seed time; an
  unreconcilable unit yields `unknown`, never a silently wrong comparison.

## Match ≠ enrollable (why the numbers stay honest)

A chart match is an **upper-bound screening count**, not deliverable capacity — the exact
overcount the industry already distrusts. So the UI:

- applies a crude **screen-to-enrol funnel discount** (×0.3, clearly labelled — not a
  validated figure), and
- treats capacity as a **rate**: each site carries a nominal monthly incidence, so
  capacity reads "≈N enrollable over 6 months," not "N exist today."

## Privacy boundary (stated plainly, not oversold)

A site's response carries **counts and a bottleneck reference — never patient rows**
(enforced by the `Response` shape). Patient rows live only in each site's own
`data/*.json`. On top of that structural boundary, any cross-site cell of **1–4 is
suppressed to `<5`** so a small subgroup can't be re-identified.

This is **counts-not-rows + small-cell suppression, not differential privacy.** A
determined complementary-release attack across the softening toggle could still leak a
suppressed cell; full DP and true federation (data never leaving origin) are **v2**. We
say exactly that much and no more.

---

## Data provenance (important)

- Patients are **programmatically generated** (seeded `mulberry32`) from realistic
  marginal prevalences with explicit correlations (stage↔prior-lines, diagnosis↔biomarker),
  then given cosmetic variation. **No LLM** is in the generation loop, so datasets are
  reproducible and committed.
- The population is **calibrated to breast-oncology epidemiology** (real HER2 prevalence,
  30–40% HER2 missingness among breast patients, mixed lab units). It is **not hand-fit to
  the protocol criteria** — the generator never reads the protocol. This is the defensible
  line between calibration and cheating.
- The **hero protocol** is modeled on the HER2+ mBC second-line setting (T-DXd /
  DESTINY-Breast program). **Its criteria are simplified and hand-transcribed for the
  demo — verify NCT `NCT03529110` and the eligibility text against ClinicalTrials.gov
  before using any figure in the pitch.**

---

## Architecture

```
Next.js (App Router, TS)
  /sponsor  post + aggregated counts + softening        /site  discover + match + submit
        └──────────────── shared service layer ─────────────────┘
                                 │
   pure matcher ── softening sim ── aggregation(+suppression) ── feasibility(funnel/rate)
                                 │
   data/*.json (patient rows, per site)   data/consultations.json + data/responses.json (marketplace store)
```

- **Persistence** is a committed JSON snapshot (`src/lib/store.ts`) — the spec calls for a
  lightweight consultations list, and a committed file *is* the frozen demo snapshot (no
  query engine, nothing live on the demo path). `prisma/schema.prisma` captures the same
  model as the **documented post-hackathon swap** to SQLite/Postgres (query code unchanged).
- **No frozen-vs-live mode branch.** The app always runs off the seeded snapshot; "parse a
  live protocol" would be one optional button allowed to fail off the critical path.

### Layout

| Path | What |
|---|---|
| `src/lib/matcher/` | types, units, pure engine, softening, aggregation |
| `src/lib/feasibility.ts` | funnel discount + incidence rate |
| `src/lib/service.ts` | shared computation (demo + app use the same code) |
| `src/lib/store.ts` | consultations/responses (counts-not-rows) |
| `src/data/hero-protocol.ts` | the verified hero `Criterion[]` |
| `scripts/generate-data.ts` | hybrid seeded synthetic-data generator |
| `scripts/demo.ts` | `npm run demo` headless proof |
| `src/app/` | landing, `/sponsor`, `/site`, `/scorecard` |
| `tests/matcher.test.ts` | 19 unit tests |

---

## Non-goals (v1)

No real patient data · no live EHR/ClinicalTrials.gov fetch · no auth/payments/open signup ·
no non-oncology · no real federation (v2) · no negotiation/contracting.

## Post-hackathon

Swap the store to Prisma/Postgres (`prisma/schema.prisma`), add real auth, host on a
persistent Node target, then tackle true federation and richer criterion logic.
