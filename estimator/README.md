# TrialBridge — Feasibility Estimator (scaffold)

Validate the core method today, then swap synthetic data for DuckDB-over-OMOP without touching the estimator.

**The method:** `estimated eligible[site] = Σ_strata ( DataSUS_base_count[site, stratum] × depth_rate[stratum] )`

DataSUS gives the exact base cohort (by diagnosis, demographics, CNES site/region). The proprietary NLP→OMOP data supplies the per-stratum depth-eligibility rate (HER2, stage, ECOG, prior lines, negations). Because the proprietary rates are weighted by **DataSUS** stratum counts, the estimate is **direct-standardized** to the national population — the proprietary population's own mix drops out. Every estimate carries a 95% CI.

## Run

```bash
cd trialbridge_estimator
python3 demo.py                 # end-to-end demo (no dependencies)
python3 tests/test_estimator.py # 5 method sanity checks
```

No third-party packages required (pure standard library).

## What the demo shows

- Exact DataSUS base cohort per site, then estimated eligible + 95% CI.
- **Why standardization matters:** the engine's standardized estimate lands closer to the reference "truth" than a naive overall rate (which is biased by the proprietary population's younger age mix).
- **Protocol softening / bottleneck ranking:** how much the national pool grows if each criterion is relaxed (in the demo, HER2-positive is by far the tightest filter).

## Layout

```
trialbridge/
  schema.py       # Criterion / Protocol — the parser↔engine contract; checkable vs depth
  stats.py        # Wilson CI + empirical-Bayes shrinkage (no numpy)
  data.py         # BaseCohortSource / ProprietarySource interfaces + synthetic worlds
  enrichment.py   # fit joint depth rates per stratum, shrink thin strata
  estimator.py    # base × standardized rate × CI per site; softening; bottlenecks
demo.py           # runnable end-to-end
tests/            # internal consistency, standardization, monotone softening, CI width
```

## Going to real data (the only files that change)

Implement the two interfaces in `data.py` with DuckDB; nothing in `estimator.py` changes.

```python
class DuckDBDataSUS(BaseCohortSource):
    def records(self):
        # SELECT establishment/region, dx, age_band, sex, COUNT(DISTINCT person_id)
        # FROM datasus_omop  (condition_occurrence joined to person, by ICD→SNOMED)
        # GROUP BY 1,2,3,4,5   -> [BaseRecord(...), ...]  (apply min-cell suppression)
        ...

class DuckDBProprietary(ProprietarySource):
    def patients(self):
        # row-level proprietary OMOP: depth features from measurement (LOINC biomarkers/
        # labs), drug_exposure (RxNorm prior lines), condition/observation + assertion
        # -> [{dx, age_band, sex, her2, stage, ecog, prior_lines, autoimmune, ...}, ...]
        ...
```

## Method notes / honest limits (surface these in the pitch)

- **Transportability** is handled by standardizing to DataSUS strata — but strata where the proprietary data is thin *and* DataSUS is heavy (e.g. older patients) still carry residual bias via shrinkage. Good proprietary coverage of the older population tightens this.
- **Criteria dependence** is captured by fitting the **joint** depth rate per stratum (not a product of marginals).
- **Uncertainty**: Wilson CIs on rates, variance propagated to the site/national totals (normal approximation). Bootstrap is the production upgrade.
- The LLM parses criteria **once**; estimation is a pure, reproducible calculation over frozen rate tables.

## Real data is wired in (as of 2026-07-08)

`DuckDBDataSUS` and `RealProprietary` in `data.py` are implemented, not just sketched — see `demo_real.py`. Real national DataSUS base (63M person / 885M condition rows) × real HER2/ECOG/metastatic rates extracted from clinical NLP output across **all 14 hospitals with breast-cancer patients** (28,490 of 28,490 — full coverage of what the proprietary index identified, up from 1 hospital earlier the same day), end to end, producing a real estimate with CI:

```
National estimated eligible (HER2+, ECOG 0-1, metastatic breast cancer): 4,588  (95% CI 4,048-5,127)
  vs. DataSUS base cohort (breast cancer, female, 18+): 394,255  →  1.16% standardized eligible fraction
```

Coverage is real but lopsided — one hospital ('ha') supplies 67% of patients and nearly all of the HER2+ECOG complete cases; most of the other 13 barely document ECOG. That's disclosed in `RealProprietary`'s docstring, not smoothed over — it's exactly the kind of thin-strata situation the shrinkage in `enrichment.py`/`stats.py` exists to handle honestly.

## Live API (as of 2026-07-08, later same day)

`api.py` — FastAPI wrapper, real data both sides, no mock/dummy responses:

```bash
TB_DATASUS_DIR="$(pwd)/data/omop_full" TB_PROPRIETARY_GLOB="$(pwd)/data/proprietary_ha/*.parquet" \
  ~/.venvs/trialbridge_estimator/bin/uvicorn api:app --port 8421 --app-dir .
```

- `GET /health`, `GET /protocol`
- `POST /feasibility/estimate` — national + per-region **Estimated N** (standardized, CI) alongside per-site **Observed N** (direct row-level count from real patients, no model) — this is the deck's Slide 6 two-number split, minus the Rosetta Stone (see below).
- `POST /soften {"exclude_depth_ids": [...]}` — relaxes one or more depth criteria; both Estimated N and Observed N move together, consistently, off the same excluded set.

`DuckDBDataSUS.records()` and `RealProprietary.patients()` are now memoized per instance — `rank_bottlenecks()` calls `estimate()` 5 times internally (baseline + one per depth criterion), which was re-running the ~1.6s DataSUS scan from scratch every time (~8s per request). First call now ~1.5s, subsequent calls ~20ms.

## UI (as of 2026-07-09)

`ui/index.html`, served at `GET /` by `api.py`. Not a mockup — every number on the page comes from a live `/feasibility/estimate` or `/soften` call, verified in a real browser (not just curl): criteria panel with live softening checkboxes, Estimated N / Base cohort / Observed N stat tiles, a state-level heatmap grouped by the 5 official macro-regions (sequential blue ramp, values labeled in-cell per the accessibility relief rule — deliberately NOT a geographically-precise choropleth, see `data.py` for why), bottleneck bar chart, Observed N by site table, and the fill-speed table below. Dark mode verified, not just declared in CSS.

## Fill-speed (as of 2026-07-09)

`DuckDBDataSUS.monthly_incidence_by_region()` + `estimator.fill_speed()` / `national_fill_speed()`. Real DataSUS incidence (MIN(condition_start_date) per person = their first-ever-seen diagnosis date) × the same standardized eligible fraction `estimate()` already computes → months to enroll a target N, per region and nationally.

The window matters and isn't arbitrary: the raw first-diagnosis-date distribution has a massive backfill spike in 2023-01 (30,928 nationally vs. ~10-20k/month steady-state) from data onboarding, and recent months risk right-censoring (reporting lag). Used **2023-07 to 2025-07** (24 months) — verified stable and population-plausible in that window (SP ~2,401/mo, MG ~1,445/mo, ...). Documented in `DuckDBDataSUS.INCIDENCE_WINDOW`.

One real assumption, stated not hidden: newly-presenting patients are assumed to have the same standardized eligibility rate as the existing prevalent pool used to fit the depth rates. Incidence and prevalence populations aren't guaranteed identical.

## Data location & sync (as of 2026-07-09, relocated)

The local mirrors used to live under a session-scoped `/private/tmp/...` scratchpad
(ephemeral — cleared between sessions) — relocated here for durability:

```
data/omop_full/{person,condition_occurrence}/part-*.parquet   # 25G, DataSUS mirror
data/proprietary_ha/*.parquet                                  # 268K, per-hospital depth features
data/omop_sample/                                               # 213M, small subset for fast iteration
```

`data/` is gitignored (too large to commit). GCS (`gs://omop-sus/exports/ihealth_omop_sus/`)
remains the source of truth for DataSUS — DuckDB here can't authenticate `gs://` reads
directly in this environment (no HMAC key on the bucket), so `scripts/sync_datasus.sh`
mirrors `person` + `condition_occurrence` (the only two tables `DuckDBDataSUS` reads)
via `gcloud storage rsync`. Re-run it whenever the upstream export is refreshed:

```bash
./scripts/sync_datasus.sh
```

The Python venv also lives outside this repo, at `~/.venvs/trialbridge_estimator` —
`python3 -m venv` refuses to create a venv inside a path containing `:` (this project's
parent directory has one, same issue noted in the sibling Next.js app's README).

## Decided: standardization, not record linkage (resolves a real contradiction with the pitch deck)

`TrialBridge_pitch.md` (Slide 6) describes a different method — an imputation model calibrated on the **overlap** between DataSUS and the proprietary base (patients present in both, a "Rosetta Stone"). That's record linkage, and it directly contradicts this project's locked non-goal (`trialbridge-architecture-v2-enrichment.md`: *"No record linkage between DataSUS and proprietary patients... enrichment is statistical, not per-patient join"*).

Checked whether it's even possible: neither dataset carries a shared identifier. DataSUS `person.person_id` is a pipeline-assigned synthetic ID; the proprietary base's `unique_patient_id` is hospital-code + internal patient_id. No CPF/CNS/national key in either export as inspected. The overlap Slide 6 describes doesn't exist in the data on disk today.

**Decision: keep building on direct standardization (this file's method), not the overlap/imputation approach.** Slide 6 of the pitch deck needs to be rewritten to describe this method instead — flagged back to the deck owner, not silently changed here.
