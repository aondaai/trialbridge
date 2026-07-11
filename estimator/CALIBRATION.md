# Calibration — Trilha B, step 2 (design + prototype)

**Status:** prototype landed (`trialbridge/calibration.py`, `scripts/calibration_holdout.py`,
`tests/test_calibration.py`). Not wired into the live `/query` path yet — that flip is
gated on the geographic holdout (step 3) and, for the real estimand, the Rosetta Stone
linkage (step 1). This doc is the "why / what / how it plugs in" so the next step is a
small edit, not a rediscovery.

## The problem calibration solves

The estimator emits `Estimated N = Σ_stratum base_count[stratum] × depth_rate[stratum]`.
For that sum to be a *count* and not a vibe, `depth_rate` must be **calibrated**: among
the strata the model rates at `p ≈ 0.30`, about 30% must truly pass depth. Shrinkage
(`stats.shrink`) controls variance but does **not** guarantee calibration under **domain
shift** — the 35 proprietary hospitals are a reference/private-skewed sample, not a random
draw from the DataSUS national population the base counts describe. If the proprietary
depth rate is biased relative to the target population, every Estimated N inherits that bias.

## Estimands — what we can measure today vs. what needs Rosetta

| Estimand | Split it needs | Measurable now? |
|---|---|---|
| **In-distribution** — does the shrinkage rate match observed pass-rates on held-out patients of the *same* population? | random k-fold over proprietary | ✅ yes |
| **Cross-site transfer** — does a rate learned on some hospitals hold on an *unseen* hospital? (direct analogue of applying proprietary rates to a DataSUS site with no proprietary rows) | leave-one-hospital-out (LOHO) | ✅ yes |
| **Cross-state transfer** — does a rate learned in some states hold in an unseen state? (the step-3 UNIT, on proprietary labels) | leave-one-UF-out (LOUO), via the hospital→UF map | ✅ yes (added 2026-07-11) |
| **Cross-population transfer** — does the proprietary rate match the *DataSUS* target population per UF? (the estimand that makes Estimated N defensible) | per-UF geographic holdout with DataSUS depth labels | ❌ **needs Rosetta Stone linkage (step 1)** |

The machinery is identical across all three — only the source of the `(predicted, outcome)`
pairs changes. So the prototype built now against LOHO becomes the production calibrator by
swapping in the linkage-derived pairs. Nothing is throwaway.

## What the prototype found (real proprietary breast data, n=2,355 complete-case)

Run: `TB_CONCEPT_MAP=$PWD/concept-map.json python scripts/calibration_holdout.py data/proprietary_ha`
(artifact: `data/calibration_report.json`)

**In-distribution (random 5-fold): ECE ≈ 0.0002.** The shrinkage estimator is essentially
perfectly calibrated on its own population — the estimator machinery is sound.

**Cross-site (LOHO): the model over-predicts, and it's worst exactly where documentation is
most hospital-dependent.** Per-criterion cross-site ECE:

| criterion | base rate | ECE before | ECE after (isotonic) |
|---|---|---|---|
| HER2+ | 25.3% | 0.076 | 0.002 |
| ECOG ≤1 | 84.4% | **0.220** | 0.032 |
| metastatic | 8.8% | **0.183** | 0.000 |
| autoimmune-absent | 99.5% | 0.004 | 0.000 |
| full conjunction | 1.2% | 0.021 | 0.002 |

**Reading:** ECOG and metastatic transfer *badly* across sites (ECE 0.18–0.22) — consistent
with the known fact that ECOG documentation is concentrated in one hospital (`ha`, ~88% of
labeled patients). HER2 transfers moderately; autoimmune (mostly "never mentioned → passes")
is stable. This is the empirical argument for why coverage must be **earned per geography**,
not assumed: the cross-site gap is real and criterion-specific.

### Geographic holdout — leave-one-UF-out (step 3 structure, added 2026-07-11)

With the hospital→UF map (`hospital-uf.json`, `trialbridge/geo.py`), the harness now also
splits by **state** instead of hospital — the exact unit step 3 will calibrate on. Per-
criterion transfer error, cross-site (LOHO) vs cross-state (LOUO):

| criterion | base rate | ECE cross-site (LOHO) | ECE cross-state (LOUO) |
|---|---|---|---|
| HER2+ | 25.3% | 0.076 | 0.074 |
| ECOG ≤1 | 84.4% | **0.220** | **0.190** |
| metastatic | 8.8% | **0.184** | **0.104** |
| autoimmune | 99.5% | 0.004 | 0.005 |
| full conjunction | 1.2% | 0.021 | 0.001 |

**Reading:** aggregating hospitals into states averages out *some* within-state idiosyncrasy
(metastatic 0.18→0.10), but the **geographic gap stays large for ECOG (0.19) and metastatic
(0.10)** even at UF granularity. So per-UF calibration is genuinely necessary and won't be
trivial for those criteria — this is the defensible, quantified case for step 3.

**Map provenance:** `ha`→SP (Hospital de Amor/Barretos), `hac`→PR, `hmd`→RS confirmed by the
data owner; the rest inferred (owner-reviewed); `hsl` UF unconfirmed → its patients are
dropped from LOUO rather than guessed (`uf_for` returns None). `ha` alone is ~88% of the
depth-labeled patients (all SP), so LOUO is SP-dominated — same concentration caveat as LOHO,
now geographic.

**Caveats (also in the artifact):**
- The depth-labeled base is tiny and `ha`-dominated; per-fold numbers are directional, the
  pooled number is the headline.
- `ECE_after` is fit in-sample on the out-of-fold pairs — it is the *achievable-fit ceiling*,
  not a generalization estimate. Production needs a separate held-out eval fold.
- LOHO measures cross-*site*, not cross-*population*. The DataSUS gap can only be closed with
  linkage labels.

## The two calibrators

- **`PlattCalibrator`** — `sigmoid(a·logit(p)+b)`, fit by Newton/IRLS. Two params, smooth,
  identity at `(a=1,b=0)`. Best when miscalibration is a smooth stretch; stable on thin data.
- **`IsotonicCalibrator`** — monotone step function via weighted PAVA. No shape assumption;
  best when the miscalibration bends non-linearly but preserves order. Needs more data.

Both are pure-Python (no numpy), matching `stats.py`. `reliability()` produces the ECE / MCE /
Brier + per-bin table used above.

## How it wires into the existing system (the flip, when step 3 lands)

The scaffolding already anticipates this — minimal new surface:

1. **`provenance.Provenance.calibration_ref`** already exists and `imputed(..., calibration_ref=)`
   already accepts it. A calibrated Estimated N sets `calibration_ref = make_calibration_ref(...)`
   so every value points back at the report that earned it. **No provenance change needed.**
2. **`registry.ModelVersion.valid_ufs`** is the calibrated coverage set. `coverage.CalibratedCoverage.from_model(mv)`
   already reads it. The geographic-holdout report (step 3) produces the real `valid_ufs`;
   today `CALIBRATED_UFS_14` is a hand-typed placeholder.
3. **`estimator.estimate(...)`** would gain an optional `calibrator` and apply
   `rate.p → calibrator(rate.p)` before weighting (variance handling: recompute the interval
   post-calibration, or bootstrap — noted as the production upgrade).
4. **`api.py`** flips `_COVERAGE_IS_CALIBRATED = False → True` once `_coverage` is driven by a
   real `from_model(mv)` over a holdout report, instead of the placeholder set.

## Next actions (in order)

1. **Step 1 (Rosetta Stone)** — unblocks cross-population labels; needs DPO/LGPD sign-off. *(user)*
2. **Step 3 (geographic holdout)** — once labels exist, replace LOHO pairs with per-UF
   holdout pairs; `CalibratedCoverage.from_model` over the resulting report earns the real UF set.
3. Wire `calibrator` into `estimate()` + flip `_COVERAGE_IS_CALIBRATED`; re-verify `/query`.
4. **Step 4 (drift)** — re-run the harness per period; alert when per-stratum ECE drifts.
