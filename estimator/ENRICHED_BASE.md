# Enriched Base — the crossed asset (DataSUS intelligence × proprietary depth)

**The third asset:** the DataSUS national skeleton (63.2M persons, real demographics /
geography / diagnoses) fused with the proprietary base's clinical *depth* (6.68M patients'
HER2 / ECOG / stage / biomarkers, which DataSUS lacks). Neither base alone answers "how many
eligible patients per state"; crossed, they do. This productizes the estimator's transfer as
a reusable dataset.

**Honest by construction:** the demographic/geographic skeleton is OBSERVED (DataSUS); the
depth is IMPUTED (proprietary model), always flagged as such (`imputed_depth` / provenance).
Estimated N is never confused with a real localizable count.

## Three layers, three files

| Layer | Grain | File / script | Status |
|---|---|---|---|
| **Shell** | UF × ICD-3 × age × sex, ALL conditions | `data/datasus_shell/` · `materialize_datasus_shell.py` | ✅ full national skeleton (267k cells, 1,986 conditions) |
| **Enriched — aggregate** | UF × stratum, depth-imputed | `data/enriched_base/aggregate.json` · `materialize_enriched_base.py` | ✅ breast |
| **Enriched — person-level** | synthetic patient | `data/enriched_base/persons.parquet` · `materialize_enriched_persons.py` | ✅ breast (380,517) |

### Shell (structural skeleton, all conditions)
`materialize_datasus_shell.py` scans the full export (890M conditions × 63M persons, ~21s)
and emits the base cohort for EVERY condition, keyed by ICD-3. Uses `approx_count_distinct`
(HyperLogLog, ~2% error — validated: shell C50 female 381,657 vs exact 380,517, **+0.3%**) to
stay in memory. Each condition is tagged depth-**available** (breast today) or depth-**pending**
(everything else — extractable from proprietary free text we already hold). Headline cohorts:
C50 breast 396k · C61 prostate 233k · all C## neoplasms 3.14M.

### Enriched (depth-imputed, breast today)
Aggregate = per cell: `base_count` (observed) + `depth_rate`/`est_eligible` (imputed, CI,
model-versioned). Reconciles to the live estimator (N=4,588). Person-level = 380,517 synthetic
patients, each with a depth tuple sampled from the proprietary JOINT distribution per stratum
(preserves HER2×ECOG×stage correlation), `imputed_depth=true`. `compare_enriched_grains.py`
verifies the two agree (re-aggregation +0.38% sampling noise) and shows the person-level
answers arbitrary boolean/subgroup queries the aggregate can't.

## Payer correction (SUS-only)
DataSUS is 100% SUS; the proprietary base mixes SUS + private. `split_depth_by_payer.py` joins
depth back to the full base on `<site>_<patient_id> = unique_patient_id` (no NLP re-extraction)
and classifies payer by `convenio`. Full breast cohort 83.4% SUS / 16.6% private; private
patients are sicker (33% metastatic vs 8%). Restricting to SUS — representativeness-correct for
the all-SUS DataSUS target — raises the national estimate: **SUS-only 4,757 vs all-comers 4,588
(+3.7%)**. (The depth signal is dominated by Hospital de Amor / Barretos, a SUS reference center
— so "SUS-representative" today is closer to "Barretos-representative"; broadening extraction +
Trilha B calibration is what makes it nationally robust.)

## Roadmap — the asset grows per condition
The ceiling is not data or method (both proven) but **how many conditions have proprietary depth
extracted**. Breast (C50) is done end-to-end. Each new condition is an extraction job over text we
already hold, then a re-run of the same pipeline:
1. **Breast (C50)** — ✅ done (aggregate + person-level + SUS axis).
2. **Prostate (C61, 233k DataSUS cohort · 16.7k proprietary)** — next: extract PSA / Gleason / stage.
3. Cervical, lung, then chronic conditions (hypertension I10 1.4M, etc.).
The shell already lists every pending condition, so adding one is: extract depth → point the
enriched materializers at it → the shell flips that ICD to depth-available.

## Regenerate (from estimator/)
```
# shell (full scale, ~21s)
TB_DATASUS_FULL_DIR='~/datasus omop mcp/data/raw' python scripts/materialize_datasus_shell.py --as-of <date>
# payer split -> SUS-only depth
python scripts/split_depth_by_payer.py
# enriched grains (add TB_PROPRIETARY_GLOB=data/proprietary_ha_sus/*.parquet for SUS-only)
python scripts/materialize_enriched_base.py
python scripts/materialize_enriched_persons.py
python scripts/compare_enriched_grains.py
```

## Notes / honesty
- Shell counts are approximate (HLL, ~±2%); the EXACT breast counts live in the enriched
  aggregate. The `000` ICD bucket (~44M) is unmapped/administrative DataSUS codes, not a condition.
- Person-level rows are SYNTHETIC (imputed depth) — never localizable patients; the observed,
  localizable count is the estimator's separate `find`/`feasibility` path over real proprietary rows.
- Depth today ≈ Barretos-weighted SUS; national robustness depends on Trilha B (calibration /
  geographic holdout) + broader extraction. See CALIBRATION.md, ROSETTA.md.
