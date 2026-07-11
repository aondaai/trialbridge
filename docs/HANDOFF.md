# TrialBridge scorecard — session handoff

Snapshot for a fresh session to resume without re-deriving anything. Written 2026-07-11.

## TL;DR of where we are
The TrialBridge feasibility **engine + real-data layer** is built, tested (**331 passing**),
and deployed (local prod + two GitHub PRs). It renders a full 8-section country+site
decision report at `/scorecard?view=engine` from **real** data — CT.gov trials/investigators,
397 real ABRACRO/ACESSE sites with CNES, deep-web-researched physician profiles and site
infrastructure (Parallel Task API, `ultra-fast`) — every number sealed by provenance, nothing
fabricated.

## Branches & PRs (globaltrialbridge/trialbridge)
- **`feat/scorecard-engine`** → **PR #3** (base `main`): P0 — the pure engine (R0–R6) + review fixes.
- **`feat/scorecard-p1`** → **PR #4** (base `feat/scorecard-engine`, **stacked**): P1 — all the real-data
  work (R7–R9, Parallel pipe, site directory, cross-reference, real sites in rankings, CNES infra, max-power).
  **This is the active branch.** 18 commits over P0. Retarget PR #4 to `main` once #3 merges.
- Both PRs are up to date with local. Working tree clean.

## How to RESUME (do this first in a new session)
This work lives in a **git worktree**, not the main checkout (a concurrent session was editing
`src/lib/intake/` in the main tree). Two gotchas cost real time — see
[[trialbridge-worktree-deploy-notes]] memory:
1. **Work in the worktree:** `cd ".../trialbridge/.claude/worktrees/scorecard-engine"` (branch `feat/scorecard-p1`).
   If it's gone, recreate: `git worktree add <path> feat/scorecard-p1` from the trialbridge submodule.
2. **`preview_start` runs the dev server from the PROJECT ROOT, not the worktree** — it serves the
   *main checkout's* code, so your edits won't appear. Run the server **from the worktree dir** instead:
   `./node_modules/.bin/next build && ./node_modules/.bin/next start -p 4020` (dev overwrites the prod
   `.next`, so build before start). Open `/scorecard?view=engine&c=hero-her2-mbc`.
3. `node_modules` is symlinked into the worktree; don't reinstall.

## Regenerating the (gitignored) data — a fresh env needs these
None of the generated data is committed (contacts / paid-API output / DB). Rebuild with:
- `cp <main>/prisma/data/dev.db prisma/data/dev.db` — seeded DB (hero consultation id `hero-her2-mbc`).
- `npm run import-sites` → `data/site-directory.json` (397 sites; reads the two .xlsx in ~/Downloads).
- `npm run enrich-kols -- "breast cancer" 6` → `data/kol-enrichment.json` (needs `PARALLEL_API_KEY` in `.env.local`).
- `npm run enrich-sites -- 6 2090236 3006522 27049 6963048 2077369 2748223` → `data/site-infra.json`.
- The enrichment scripts use the **`ultra-fast`** processor (max power) — ~1–10 min/item, run in background.

## What's built (feature map)
| Layer | Files | Status |
|---|---|---|
| Metric value object + provenance gate | `src/lib/metric.ts` | ✅ |
| Cited constants | `src/lib/constants.ts` | ✅ |
| Scoring (normalizers, weights, country 7-dim, site 9-comp, guardrails) | `src/lib/scoring/*` | ✅ |
| Report assembler (8 sections) | `src/lib/report/{types,assemble,buildReport}.ts` | ✅ |
| Report UI + MetricChip | `src/components/report/*`, `src/components/MetricChip.tsx`, `/scorecard?view=engine` | ✅ |
| Supply/demand ratios | `src/lib/supplydemand/ratios.ts` | ✅ |
| CT.gov competition (paginated) | `src/lib/ctgov/competition.ts` | ✅ |
| Parallel pipe (Task + Search) | `src/lib/parallel/{client,deepSearch,search}.ts` | ✅ `ultra-fast` |
| KOL scoring + enrichment + store | `src/lib/kol/*` | ✅ |
| Site directory (ABRACRO/ACESSE) | `src/lib/sites/directory.ts`, `scripts/import-sites.ts` | ✅ 397 sites |
| Cross-reference (investigator→CNES) | `src/lib/sites/crossref.ts` | ✅ |
| Real sites in rankings | `src/lib/sites/toSiteInput.ts` | ✅ |
| Site infra enrichment (Part B) | `src/lib/sites/infraEnrich.ts`, `scripts/enrich-sites.ts` | ✅ |

## Golden rules (from CLAUDE.md / reconciliation)
- `src/lib/scoring/**`, `report/**`, `matcher/**` are **pure** (no I/O/clock). Resolvers (`buildReport`,
  the page) do I/O and pass typed inputs in.
- **Every surfaced number is a `Metric`** with provenance + confidence; the assembler throws on a bare
  number. Unwired signals are honest `modeled` placeholders (→ LOW confidence), never fabricated.
- Vendor/CRO figures are `vendor_benchmark`, never `peer_reviewed`.
- Weights match the scorecard spec; every profile sums to 1.0 (CI test).

## Roadmap — what's NEXT (value order)
See `docs/reconciliation-plan.md` for the full R0–R9 track. Remaining:
1. **INCA/DATASUS real patient pools** — the last big `modeled` placeholder. Replace the synthetic
   patient cohorts / PI-count pool proxy with real eligible counts (there's a Python estimator on Render —
   see [[estimator-render-deploy]] — and DataSUS mirrors, see [[datasus-full-mirror-location]] /
   [[proprietary-full-base-location]]). This lifts site/country confidence off LOW.
2. **ReBEC** — completes the competition layer (trials not on CT.gov).
3. **ANS** — SUS→total pool correction.
4. **Parallel FindAll** — discover *emerging* KOLs/sites beyond CT.gov (the long-tail differentiator).
5. **Parallel Monitor** — auto-watch the risk register's live risks (ADI 7875, ANVISA) via webhooks.
6. **Productionize** — Task Group + webhooks instead of the precompute scripts; cloud deploy; real
   Postgres/PostGIS; auth + site-side onboarding.

## Verify-it-works checklist (green as of handoff)
- `npm run typecheck` → 0 errors · `npm test` → 331 passing · `npm run build` → clean
- `/scorecard?view=engine&c=hero-her2-mbc` → HTTP 200, all 8 sections, 0 console errors, real data
  (NO-GO, 20 ranked real sites, real PIs with pubs/CNES/citations, infra-fit %).
