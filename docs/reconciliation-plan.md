# Reconciliation plan — engineering spec ⟶ existing TypeScript app

**Context.** Two specs were handed in (`docs/plans/trialbridge-scorecard-spec.md` — product/strategy;
the engineering spec — a build-ready design). The engineering spec describes a **greenfield
Python/FastAPI modular monolith** (`backend/app/engine`, Postgres+PostGIS, ARQ, a Pydantic
`Metric` value object, an 8-section report assembler). But `trialbridge/` is already a **mature
Next.js 15 / TypeScript app** solving the same product, with a Python FastAPI *estimator* as a
subcomponent.

**Decision (user, 2026-07-10):** *Reconcile onto the existing TypeScript codebase.* Treat the
engineering spec as a **target architecture**, gap-analyse each module against what exists, and
**extend the TS app**. Nothing is thrown away; the Python estimator and its in-flight
provenance/query layer are preserved.

---

## Gap analysis — spec module → existing TS

| Spec module (eng spec §) | Existing TS equivalent | Status |
|---|---|---|
| Criterion model (§5.2) | `src/lib/matcher/types.ts` `Criterion` | **DONE** (field names differ slightly; keep TS as source) |
| MatchMaking → eligibility funnel (§5) | `matcher/engine` + `service` + `feasibility` + `modeledPrevalence` + `enrichmentEstimator` | **STRONG** — synthetic-cohort matching + Wilson-CI enrichment estimator; no formal `EligibilityFunnel` typed output yet |
| Protocol softening (§5.6) | `matcher/soften` (`softenCriterion`, `rankBottlenecks`) | **DONE** |
| Prevalence library (§5.3) | `modeledPrevalence.ts` | **PARTIAL** (marginals; no cited joint-adjustment library) |
| **`Metric` value object (§4.4, §2.4)** | *none* — `parse` has `confidence`, intake has `trust`, enrichment has CIs | **MISSING** ← foundation |
| Constants library, cited (Appendix C) | `docs/citations.md` (prose) | **PARTIAL** (not typed/auditable) |
| Normalizers + weights + profiles (§6.1–6.2, App. D) | *none* | **MISSING** |
| Country scorecard, 7 dims (§6.3) | *none* (region breakdown only) | **MISSING** |
| Site scorecard, 9 comps (§6.4–6.7) | *none* (per-site feasibility only) | **MISSING** |
| Guard-rails / hard flags (§6.7) | *none* | **MISSING** |
| Report assembler, 8 sections + provenance gate (§8) | `/scorecard` page (simpler rollup) | **MISSING** as a typed Report |
| Supply/Demand ratios (§11) | `regionBreakdown` (partial) | **MISSING** as ratios |
| KOL map (§10) | *none* | **MISSING** |
| Connectors (§7): CT.gov, IBGE, CNES, INCA, DATASUS, ReBEC, PubMed, ORCID, ANS | `ctgov/` (done), estimator=DataSUS, intake adapters | **PARTIAL** (CT.gov + DataSUS only) |

### Two provenance vocabularies — complementary, not conflicting
- **Estimator (Python, in-flight):** `observed | imputed` — *data origin* (real patient fact vs model estimate),
  with `provenance.py`, `registry.py` (model versions), `coverage.py` (calibrated UFs), `findability.py`.
- **Scorecard spec (this plan):** `peer_reviewed | registry_gov | site_declared | modeled | vendor` — *source credibility*
  of each displayed metric (Appendix B).

They live at different layers. The TS report `Metric` uses the 5-seal credibility model; when the report
consumes estimator output, `observed`→`registry_gov`/`site_declared` and `imputed`→`modeled` (carrying the
estimator's CI + `model_version` into `Metric.note`/`source_refs`).

---

## Reconciled build order (TS-first, additive)

Each step ends green (typecheck + `vitest run` + `next build`) before the next, matching the repo's
existing `progress.md` discipline. P0 = R0–R6 (maps to eng spec §16 P0). P1 = R7–R9.

> **Status (2026-07-10):** **P0 (R0–R6) DONE** — the pure engine + the report UI, built on branch
> `feat/scorecard-engine` in an isolated worktree (concurrent intake edits were live in the main
> checkout). Full suite **249 passing**, `tsc` clean, `next build` clean. R6 was **browser-verified**
> live: `/scorecard?view=engine` renders the 8-section report with correct provenance dots, no console
> errors. Next up: R7 (supply/demand) · R8 (KOL) · R9 (connector breadth) — all P1.
>
> **Running the engine view locally (worktree gotcha):** `preview_start` / the launch config resolves
> its cwd to the **project root**, not this worktree, so it serves the main checkout's code. To see the
> engine branch, run the dev server *from the worktree dir* (`./node_modules/.bin/next dev -p <port>`)
> and copy a populated DB in first (`cp <main>/prisma/data/dev.db prisma/data/dev.db`; `dev.db` is
> gitignored). Then open `/scorecard?view=engine&c=hero-her2-mbc`.

- **R0 ✅ Metric foundation (cross-cutting).** `src/lib/metric.ts`: `Provenance` (5 seals), `Confidence`,
  `SourceRef`, `Metric`, constructors, `assertProvenanced()` gate, `buildProvenanceIndex()`, Appendix-B seal→colour map. Eng spec §4.4 + §2.4 rule 2.
- **R1 ✅ Constants library.** `src/lib/constants.ts`: cited benchmark constants as `Metric`s (Tufts enrolment/zero-enroller/timeline/dropout;
  startup 45 vs 145d; Qiao 59%-of-NA; amendment $141k/$535k; FDA GCP OAI 4.1%; Lei 14.874 30/90/15d; trials-per-million anchors;
  Demografia Médica). Sealed honestly per `docs/citations.md` (L.E.K. 65% = vendor, not peer-reviewed). Eng spec App. C.
- **R2 ✅ Scoring primitives.** `src/lib/scoring/normalize.ts` (benchmark-relative / absolute-anchored / categorical / checklist)
  + `src/lib/scoring/weights.ts` (country 7-dim + site 9-comp defaults + 5 profiles as renormalized multipliers; sum-to-1 CI test). Eng spec §6.1–6.2, App. D.
- **R3 ✅ Country scorecard.** `src/lib/scoring/country.ts` — 7 dimensions, composite, Go/Conditional/No-Go rule, hard flags, `brazilCountryInput()` Tier-1 path. Eng spec §6.3, §5.2.
- **R4 ✅ Site scorecard.** `src/lib/scoring/site.ts` — 9 components, confidence roll-up, `rankSites` tie-break; `guardrails.ts` demotion. Eng spec §6.4–6.7.
- **R5 ✅ Report assembler.** `src/lib/report/{types,assemble}.ts` — typed 8-section `Report`, provenance index, provenance gate enforced. Eng spec §8.
- **R6 ✅ Report UI.** `components/MetricChip.tsx` + `components/report/EngineReport.tsx` + `lib/report/buildReport.ts` resolver, wired into `/scorecard?view=engine`. Every number renders through MetricChip. Eng spec §13.
- **R7 ✅ Supply/Demand ratios.** `src/lib/supplydemand/ratios.ts` — per-region pool÷trials ratio, under-penetration, opportunity flag, IBGE macro-region populations; wired into report §4. Competing-trials is a MODELED placeholder until R9. Eng spec §11. *(on `feat/scorecard-p1`)*
- **R8 KOL service + map.** `src/lib/kol/score.ts` + PubMed/ORCID connectors. Eng spec §10, §7.9. **Pure scorer is quick, but the map is only demonstrable once R9 supplies investigator data.**
- **R9 Connector breadth.** IBGE / CNES / INCA / ReBEC / ANS + CT.gov investigator/competition TS connectors (or bridge to the Python estimator for DataSUS). Eng spec §7. **This is the real-data lift** — it replaces the R7/site MODELED placeholders with registry data and lifts sites above LOW confidence. Involves live external APIs (NCBI E-utilities key optional; ORCID token).

### Branch state
- **`feat/scorecard-engine`** → P0 (R0–R6) + review fixes → **PR #3** (open, against `main`).
- **`feat/scorecard-p1`** → stacked on the above; R7 landed. Not yet pushed.

### How to wire the engine to real data (R6+)
The engine takes typed inputs; the resolvers that fill them are the wiring points:
- **Funnel/site pool** → from the existing `service.ts`/`feasibility.ts`/`enrichmentEstimator.ts` (or the Python estimator over DataSUS).
- **Country input** → `brazilCountryInput()` (cited constants) + national eligible pool from the funnel.
- **Site input** → `SiteMeta` + CNES `infra` + the declared-capacity overlay (seeds §15).
- **Estimator provenance bridge** → `observed`→`registry_gov`/`site_declared`, `imputed`→`modeled` (carry CI + model_version into the `Metric`).

### Purity rule (ported from eng spec §2.4 / CLAUDE.md)
`src/lib/scoring/**`, `src/lib/report/**`, `matcher/**` stay **pure** — no `fetch`, no Prisma, no `Date.now()`.
Reference data comes in as typed inputs; scores go out as typed outputs. (Enforced by convention + tests; the
existing `enrichmentEstimator`/`feasibility`/`modeledPrevalence` already follow this.)
