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

## Posting a protocol (where Claude runs)

At `/sponsor/new`, either **fetch a real protocol from ClinicalTrials.gov by NCT id**
(`src/lib/ctgov/` — live call to the public CT.gov REST API v2, falls back to the
cached hero fixture if the network's unavailable) or paste protocol text directly →
**Claude (`claude-opus-4-8`) parses it into typed `Criterion[]`** via structured
outputs → you verify and correct the flagged low-confidence rows → post. Set
`ANTHROPIC_API_KEY` to run the live parse; without a key it falls back to the cached,
human-verified criteria (clearly labelled) so the flow always works — this is ADR
Decision 3B (parse offline, cache, verify) in action. Correcting a low-confidence row
on screen is the trust moment: the LLM's weakest step is made human-auditable before
anything reaches the deterministic matcher.

```bash
cp .env.example .env.local
# then edit .env.local — every var is optional, the app works with none of them set
```

## OMOP coding layer (toward OMOP-native matching)

`src/lib/omop/` turns a parsed `Criterion[]` into `OmopCriterion[]` — each criterion
coded to an OMOP CDM domain/table, a standard vocabulary concept (SNOMED/LOINC/RxNorm),
and a clinical assertion (`PRESENT`/`ABSENT`, inclusion/exclusion respectively). This
is the artifact PRD v4's OMOP-native matching engine needs to eventually query real
OMOP databases (DataSUS national aggregate, DoctorAssistant NLP→OMOP row-level)
instead of only the synthetic patients — see `/sponsor/new`'s "OMOP mapping preview."

**No fabricated concept_ids.** Every `conceptId` is `0` (`needsMapping: true`) unless
verified — either the one hardcoded OMOP Gender mapping, or a real match from your own
Athena vocabulary bundle (`npm run build-vocab-index` — see
[`docs/omop-vocabulary-mapping.md`](docs/omop-vocabulary-mapping.md) for the how-to and
why-no-live-API-exists).

**`src/lib/omop/datasource/`** is a port (`OmopDataSource`) + one concrete adapter
(DuckDB reading OMOP parquet over GCS, matching PRD v4's description of DataSUS) for
querying a *real* OMOP database, plus stub adapters and an in-memory mock for tests.
This is unconnected plumbing, not a wired feature — there are no DataSUS/DoctorAssistant
credentials in this repo. Fill `.env.local` (`.env.example` documents every var) and
`npm install duckdb` yourself when you have real access to test against.

## What makes the matches trustworthy

The **matcher is a pure, deterministic function** — the LLM is only ever used to parse
free-text criteria into a typed schema (parsed live at `/sponsor/new`, verified, then
the demo path replays the cached verified artifact). Arithmetic and
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

## LatAm Site Map

`/map` renders ~29k physical clinical-trial sites across Brazil, Mexico, Chile,
and Argentina (ClinicalTrials.gov registry data; city-level coordinates), colored
by activity status with per-country filters. The payload
(`public/data/latam-sites.json`) is generated from the SiteMapTool pipeline
(github.com/aondaai/trialbridge branch `feat/latam-site-map` holds the full
pipeline) via:

    npm run build-latam-map-data -- <path-to-full-sites.json>

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
- The **hero protocol** `NCT03529110` is **verified as DESTINY-Breast03** (T-DXd vs
  T-DM1, HER2+ unresectable/metastatic breast cancer) — HER2-positive, ECOG and
  LVEF<50% are genuine eligibility gates, so HER2 is a legitimate softenable
  bottleneck. Criteria are simplified for the demo (organ-function cutoffs are
  illustrative). **Before the pitch, read [`docs/citations.md`](docs/citations.md)** —
  it sources every macro stat (several in the original spec are misattributed; the
  "86%" figure in particular should be dropped) and details the protocol simplifications.

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
| `src/lib/ctgov/` | fetch a real protocol from ClinicalTrials.gov by NCT id |
| `src/lib/omop/` | `Criterion[] → OmopCriterion[]` OMOP coding layer |
| `src/lib/omop/datasource/` | `OmopDataSource` port + DuckDB/GCS, stub, and mock adapters (unwired plumbing — see above) |
| `scripts/generate-data.ts` | hybrid seeded synthetic-data generator |
| `scripts/build-vocab-index.ts` | matches `FIELD_CONCEPT_MAP` against a real Athena bundle |
| `scripts/demo.ts` | `npm run demo` headless proof |
| `src/app/` | landing, `/sponsor`, `/site`, `/scorecard` |
| `tests/` | unit tests (matcher, parse, ctgov, omop transform/vocab/datasource) |

---

## Non-goals (v1)

No real patient data · no live EHR feed or wired OMOP database (ClinicalTrials.gov
fetch + OMOP coding *are* implemented — DataSUS/DoctorAssistant connectivity is not) ·
no auth/payments/open signup · no non-oncology · no real federation (v2) ·
no negotiation/contracting.

## Post-hackathon

Swap the store to Prisma/Postgres (`prisma/schema.prisma`), add real auth, host on a
persistent Node target, then tackle true federation and richer criterion logic.
