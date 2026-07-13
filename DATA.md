# Data & Rights

*This document exists for open-source compliance and for the judging panel. It states
exactly what is public and shipped in this repository versus what is a local, private
enrichment that is **not** distributed here.*

## What is public — and shipped in this repo

| Source | What it is | How it is used | License / rights |
|---|---|---|---|
| **DataSUS** | Brazil's unified public-health dataset — condition and person records (890M-row condition table, 63M-row person table; ~163GB raw). | Materialized into **small, cell-suppressed, PHI-safe JSON aggregates** (by diagnosis, demographics, region/site). Only these aggregates are shipped. | Public government data. |
| **ClinicalTrials.gov** | Trial protocols & eligibility criteria (public REST API v2). | Fetched by NCT id at parse time; a cached hero fixture is bundled for offline demo. | Public (U.S. NIH/NLM). |

The served aggregates are designed to be **k-anonymous**: small cells are suppressed
(shown as `<5`) and no cell is derived solely from the private base.

## What is private — and deliberately NOT in this repo

| Source | What it is | Why it is not here |
|---|---|---|
| **iHealth proprietary base** | ~6.68M patients across 35 hospitals (~58GB), doc-level clinical NLP. Supplies per-stratum *depth-eligibility rates* (e.g. HER2, ECOG, stage) for oncology. | We do **not** hold redistribution rights, and it contains sensitive clinical data. It stays **local and gitignored**. The repo references it only as an **optional enrichment path**; nothing derived at row level is published. |

The depth rates the estimator uses are **weighted by public DataSUS stratum counts**, so the
private population's own composition drops out of the published estimate (direct standardization).
No individual-level record from the private base is reconstructable from anything in this repo.

## Before making this repository public

A full-repository leak grep must pass (no hospital names, no `parquet_ihealth`/proprietary
paths, no row-level private data). See the release checklist in the project notes. The MIT
[`LICENSE`](LICENSE) applies to the **code and the public aggregates only**.
