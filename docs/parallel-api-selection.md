# Parallel.ai — which API for which TrialBridge need

Read of the full docs ([overview](https://docs.parallel.ai/getting-started/overview) + [cookbook](https://github.com/parallel-web/parallel-cookbook)). Parallel is not one API — it's six, split by **latency** (synchronous seconds vs. async minutes–hours) and **output shape** (ranked excerpts vs. structured JSON + per-field citations). Picking the wrong one is what made the KOL page hang for 90s.

## The six products

| API | Latency | Output | Endpoint |
|---|---|---|---|
| **Search** | seconds (sync) | ranked, citation-aware **excerpts** | `POST /v1/search` |
| **Extract** | seconds (sync) | a URL → clean markdown | `POST /v1/extract` |
| **Entity Search** | seconds (sync) | fast people/company list (recall-optimized) | — |
| **Task** (Enrichment / Deep Research) | minutes (async) | **structured JSON + per-field basis/citations** | `POST /v1/tasks/runs` → poll |
| **FindAll** | minutes–hours (async) | discovered + **verified** entity list | — |
| **Monitor** | scheduled + webhooks | change events over time | — |

Task processor tiers (cost/quality/latency): Enrichment `lite`(~2 fields) · `base`(~5) · `core`(~10) · `pro`(~20) · `ultra`(~25); Deep-Research `pro`(~10 min) · `ultra`(up to 2 h, webhooks required).

## Recommended mapping for TrialBridge

| Need | Best API | Why |
|---|---|---|
| **KOL enrichment** — pubs, society roles, guideline authorship per physician (R8) | **Task API · Enrichment · `base`** | 3 structured fields with citations. `base` (~5 fields) is the right tier — `core` was 5× slower for no benefit. **Precompute** it (below), don't call it in a render. |
| **Batch-enrich many KOLs/sites** | **Task Group API** | Purpose-built for concurrent entity enrichment (replaces our hand-rolled `pooledMap` at scale); cookbook's "enqueue → fetch → merge with retry". |
| **Fast grounding inside a request** — a quick fact, a site's page, "recent news on X" | **Search API** (added, `src/lib/parallel/search.ts`) | Seconds, synchronous, cited excerpts. The right tool whenever we must resolve *during* a page render. |
| **Read one known page** (a site's site, a guideline PDF) | **Extract API** | Handles JS-rendered pages + PDFs → markdown. Natural follow-up to a Search hit. |
| **Discover emerging KOLs / sites beyond CT.gov** — "Brazilian breast-cancer trial sites not yet in registries" | **FindAll** (discover+verify) or **Entity Search** (fast, filter downstream) | Directly serves TrialBridge's *long-tail emerging-site* thesis — the differentiator vs. incumbents. |
| **Regulatory watch** — ADI 7875, ANVISA steady-state, IMP windows (our Risk Register's "live risks to re-check") | **Monitor API** | Exactly its use case: scheduled NL query + material-change detection → webhook auto-updates the register. Replaces a cron+diff pipeline. |

## The architecture lesson (why the page hung)

**Never call the Task API synchronously inside an SSR render.** Even `base` is ~45–90s per physician for KOL-depth research; `core` is minutes. The docs/cookbook are explicit: precompute (KV/cron/"Daily Insights"), use **webhooks** for completion, and reserve **Search** for anything that must be fast and synchronous.

We implement the precompute pattern (mirrors this repo's `vocab-index`):
- **`npm run enrich-kols -- "<condition>" <N>`** → fetches CT.gov investigators, deep-researches the top N via Task/`base`, writes `data/kol-enrichment.json` (gitignored).
- The report page reads that store **instantly** (`enrichmentsForNames`) and applies it; investigators without an entry stay trial-experience-only. No live Task call on the request path.
- Production upgrade path: swap the manual script for a **Task Group + webhook** job (or a scheduled routine) that keeps the store warm.

## What we built here
- `src/lib/parallel/client.ts` — Task API client (create → poll → result, `basis` → provenance).
- `src/lib/parallel/deepSearch.ts` — concurrent pipe (`pooledMap` / `deepSearchMany`).
- `src/lib/parallel/search.ts` — **Search API** client (fast synchronous grounding).
- `src/lib/kol/enrich.ts` — KOL enrichment (`base` processor, cited).
- `src/lib/kol/enrichmentStore.ts` + `scripts/enrich-kols.ts` — the precompute store + job.

Next candidates, in value order: **FindAll** for emerging-site discovery, **Monitor** for the regulatory risk register, **Search/Extract** to enrich site profiles on demand.
