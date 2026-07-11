"""Calibration holdout harness (Trilha B, step 2 — prototype).

Produces the (predicted, outcome) pairs the calibrator needs, from HELD-OUT proprietary
patients, and reports reliability before/after calibration. Two split strategies:

  * leave-one-hospital-out (LOHO) — train the enrichment model on all hospitals but one,
    predict the per-stratum depth rate, evaluate against the held-out hospital's real
    patients. This is the direct analogue of what the estimator does in production:
    apply a rate learned on some sites to a site with no proprietary rows of its own.
    It measures cross-SITE transfer — the honest dress rehearsal for the cross-POPULATION
    transfer (proprietary -> DataSUS) that the Rosetta Stone linkage will finally let us
    measure per-UF.

  * random k-fold — in-distribution check: does the shrinkage estimator match observed
    pass-rates on held-out patients from the SAME population? Isolates estimator/calibration
    correctness from domain shift.

HONEST LIMITS (surfaced, not hidden):
  * The depth-labeled proprietary base is tiny (2,355 complete-case) and dominated by one
    hospital ('ha', ~88%). LOHO folds for the small hospitals evaluate on a handful of
    patients; treat per-fold numbers as directional, the pooled number as the headline.
  * ECE_after is fit on the same out-of-fold pairs it is scored on (in-sample for the
    calibrator) — it is the achievable-fit ceiling, not a generalization estimate. A
    production calibrator needs its own held-out eval fold. Labeled as such below.

Run (from estimator/, with the test venv):
  TB_CONCEPT_MAP=$PWD/concept-map.json python scripts/calibration_holdout.py data/proprietary_ha
"""
from __future__ import annotations

import glob
import json
import os
import sys
from collections import Counter
from typing import Dict, List, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trialbridge.calibration import (  # noqa: E402
    IsotonicCalibrator,
    PlattCalibrator,
    CalibrationReport,
    make_calibration_ref,
    reliability,
)
from trialbridge.data import RealProprietary  # noqa: E402
from trialbridge.enrichment import EnrichmentModel  # noqa: E402
from trialbridge.protocols import hero_protocol_real  # noqa: E402
from trialbridge.geo import uf_for  # noqa: E402

Pair = Tuple[float, int]
SHRINK_ALPHA = 20.0


def _single_criterion_predicates(protocol):
    """Per-criterion depth predicates, so we can exercise the reliability curve on
    criteria with real spread (HER2 ~18%, ECOG ~70%) rather than only the full
    conjunction (rare, single-bin). Each shows how well THAT criterion's rate transfers
    across sites — a per-criterion cross-site calibration profile."""
    probes = {"__full__": protocol.depth_predicate()}
    for c in protocol.depth():
        probes[c.field] = (lambda crit: (lambda p: crit.test(p)))(c)
    return probes


def _predict_eval_pairs(train: List[dict], test: List[dict], predicate) -> List[Pair]:
    """Fit enrichment on `train`, emit (predicted stratum rate, real outcome) for each
    patient in `test`. The prediction is the per-stratum depth rate the estimator would
    apply; the outcome is whether THIS held-out patient actually passes depth."""
    model = EnrichmentModel(train, shrink_alpha=SHRINK_ALPHA)
    fitted = model.fit(predicate)
    pairs: List[Pair] = []
    for p in test:
        stratum = (p["dx"], p["age_band"], p["sex"])
        pred = fitted.rate_for(stratum).p
        outcome = 1 if predicate(p) else 0
        pairs.append((pred, outcome))
    return pairs


def leave_one_hospital_out(patients: List[dict], predicate) -> Tuple[List[Pair], Dict[str, dict]]:
    by_site: Dict[str, List[dict]] = {}
    for p in patients:
        by_site.setdefault(p["site"], []).append(p)
    pooled: List[Pair] = []
    per_fold: Dict[str, dict] = {}
    for held in sorted(by_site):
        train = [p for s, ps in by_site.items() if s != held for p in ps]
        test = by_site[held]
        if not train or not test:
            continue
        pairs = _predict_eval_pairs(train, test, predicate)
        pooled.extend(pairs)
        rep = reliability(pairs, n_bins=10)
        per_fold[held] = {"n_test": len(test), "n_train": len(train), "ece": rep.ece,
                          "obs_rate": sum(y for _, y in pairs) / len(pairs)}
    return pooled, per_fold


def leave_one_uf_out(patients: List[dict], predicate
                     ) -> Tuple[List[Pair], Dict[str, dict], int]:
    """Geographic holdout (Trilha B step 3 structure): group patients by UF via the
    hospital->UF map, train on all-but-one UF, evaluate on the held-out UF. This is the
    per-UF analogue of leave-one-hospital-out — it measures how a depth rate learned in
    some states transfers to an unseen state, which is exactly what a per-UF Estimated N
    assumes. Patients whose hospital has no confirmed UF are dropped (kept out, not
    guessed). When the Rosetta linkage lands, the SAME split gains DataSUS target labels
    and this becomes the real coverage-earning holdout.

    Returns (pooled pairs, per-UF fold stats, count of dropped unknown-UF patients)."""
    by_uf: Dict[str, List[dict]] = {}
    dropped = 0
    for p in patients:
        uf = uf_for(p.get("site", ""))
        if uf is None:
            dropped += 1
            continue
        by_uf.setdefault(uf, []).append(p)
    pooled: List[Pair] = []
    per_uf: Dict[str, dict] = {}
    for held in sorted(by_uf):
        train = [p for u, ps in by_uf.items() if u != held for p in ps]
        test = by_uf[held]
        if not train or not test:
            continue
        pairs = _predict_eval_pairs(train, test, predicate)
        pooled.extend(pairs)
        rep = reliability(pairs, n_bins=10)
        per_uf[held] = {"n_test": len(test), "n_train": len(train), "ece": rep.ece,
                        "obs_rate": sum(y for _, y in pairs) / len(pairs)}
    return pooled, per_uf, dropped


def random_kfold(patients: List[dict], predicate, k: int = 5) -> List[Pair]:
    # deterministic fold assignment by stable index (no RNG — reproducible)
    folds: List[List[dict]] = [[] for _ in range(k)]
    for i, p in enumerate(patients):
        folds[i % k].append(p)
    pooled: List[Pair] = []
    for f in range(k):
        test = folds[f]
        train = [p for g in range(k) if g != f for p in folds[g]]
        if not train or not test:
            continue
        pooled.extend(_predict_eval_pairs(train, test, predicate))
    return pooled


def _fit_and_report(pairs: List[Pair], split: str, notes: str) -> Dict[str, CalibrationReport]:
    before = reliability(pairs, n_bins=10)
    out: Dict[str, CalibrationReport] = {}
    for name, cal in (("platt", PlattCalibrator.fit(pairs)),
                      ("isotonic", IsotonicCalibrator.fit(pairs))):
        after = reliability([(cal(p), y) for p, y in pairs], n_bins=10)
        ref = make_calibration_ref(name, split, cal.n_train)
        out[name] = CalibrationReport(
            method=name, calibration_ref=ref, before=before, after=after,
            n_train=cal.n_train, n_eval=len(pairs), split=split, notes=notes,
        )
    return out


def main() -> None:
    data_dir = sys.argv[1] if len(sys.argv) > 1 else "data/proprietary_ha"
    paths = sorted(glob.glob(os.path.join(data_dir, "*.parquet")))
    if not paths:
        sys.exit(f"no parquet under {data_dir}")

    protocol = hero_protocol_real()
    predicate = protocol.depth_predicate()
    patients = RealProprietary(parquet_paths=paths).patients()
    depth_rate = sum(1 for p in patients if predicate(p)) / len(patients)

    print(f"proprietary depth-labeled patients: {len(patients)}  "
          f"(sites: {dict(Counter(p['site'] for p in patients))})")
    print(f"overall depth-pass rate (all criteria): {depth_rate:.3%}")
    print(f"depth criteria: {', '.join(c.field for c in protocol.depth())}\n")

    # --- per-criterion transfer profile: cross-SITE (LOHO) vs cross-STATE (LOUO) ---
    # The full conjunction is too rare (single bin) to show structure; per-criterion with
    # real spread reveals WHICH criteria fail to transfer, and whether aggregating
    # hospitals into states (the step-3 unit) helps or hides the gap.
    print("=== per-criterion transfer profile: ECE_before by holdout unit ===")
    print(f"  {'criterion':<12} {'base_rate':>9} {'ECE_site(LOHO)':>15} {'ECE_state(LOUO)':>16}")
    probe_summary: Dict[str, dict] = {}
    for field, pred in _single_criterion_predicates(protocol).items():
        base = sum(1 for p in patients if pred(p)) / len(patients)
        lo_pairs, _ = leave_one_hospital_out(patients, pred)
        uf_pairs, _, _ = leave_one_uf_out(patients, pred)
        ece_site = reliability(lo_pairs, n_bins=10).ece
        ece_state = reliability(uf_pairs, n_bins=10).ece
        iso = IsotonicCalibrator.fit(lo_pairs)
        ece_after = reliability([(iso(p), y) for p, y in lo_pairs], n_bins=10).ece
        probe_summary[field] = {"base_rate": base, "ece_site_loho": ece_site,
                                "ece_state_louo": ece_state, "ece_after_iso": ece_after}
        print(f"  {field:<12} {base:>9.1%} {ece_site:>15.4f} {ece_state:>16.4f}")
    print()

    # --- LOHO: cross-site transfer (full protocol) ---
    loho_pairs, per_fold = leave_one_hospital_out(patients, predicate)
    print("=== leave-one-hospital-out (cross-site transfer) ===")
    for site, s in sorted(per_fold.items(), key=lambda kv: -kv[1]["n_test"]):
        print(f"  hold {site:<10} n_test={s['n_test']:>5}  obs_rate={s['obs_rate']:.3f}  "
              f"fold_ECE={s['ece']:.3f}")
    loho = _fit_and_report(
        loho_pairs, "leave-one-hospital-out",
        "cross-site transfer; dominated by 'ha' hospital; after=achievable-fit ceiling")
    for name in ("platt", "isotonic"):
        print("\n" + str(loho[name]))

    # --- LOUO: geographic (per-UF) transfer — Trilha B step 3 structure ---
    louo_pairs, per_uf, dropped = leave_one_uf_out(patients, predicate)
    print("\n=== leave-one-UF-out (geographic transfer, step 3 structure) ===")
    for uf, s in sorted(per_uf.items(), key=lambda kv: -kv[1]["n_test"]):
        print(f"  hold {uf:<3} n_test={s['n_test']:>5}  obs_rate={s['obs_rate']:.3f}  fold_ECE={s['ece']:.3f}")
    if dropped:
        print(f"  ({dropped} patients dropped — hospital has no confirmed UF)")
    louo = _fit_and_report(
        louo_pairs, "leave-one-UF-out",
        "geographic transfer; SP-dominated (Barretos 'ha'); after=achievable-fit ceiling")
    for name in ("platt", "isotonic"):
        print("\n" + str(louo[name]))

    # --- random k-fold: in-distribution ---
    print("\n=== random 5-fold (in-distribution) ===")
    rk_pairs = random_kfold(patients, predicate, k=5)
    rk = _fit_and_report(rk_pairs, "random-5fold", "in-distribution; after=achievable-fit ceiling")
    for name in ("platt", "isotonic"):
        print("\n" + str(rk[name]))

    # --- persist a machine-readable artifact ---
    def serialize(cr: CalibrationReport) -> dict:
        return {
            "method": cr.method, "calibration_ref": cr.calibration_ref, "split": cr.split,
            "n_train": cr.n_train, "n_eval": cr.n_eval,
            "ece_before": cr.before.ece, "ece_after": cr.after.ece,
            "mce_before": cr.before.mce, "mce_after": cr.after.mce,
            "brier_before": cr.before.brier, "brier_after": cr.after.brier,
            "notes": cr.notes,
        }

    artifact = {
        "protocol": protocol.protocol_id,
        "n_patients": len(patients),
        "overall_depth_rate": depth_rate,
        "loho": {k: serialize(v) for k, v in loho.items()},
        "louo": {k: serialize(v) for k, v in louo.items()},
        "random_5fold": {k: serialize(v) for k, v in rk.items()},
        "per_criterion_loho": probe_summary,
        "per_fold_loho": per_fold,
        "per_uf_louo": per_uf,
        "louo_dropped_unknown_uf": dropped,
        "caveats": [
            "depth-labeled base tiny + 'ha'-dominated; per-fold numbers directional only",
            "ECE_after fit in-sample on out-of-fold pairs = achievable-fit ceiling, not generalization",
            "cross-POPULATION (proprietary->DataSUS) calibration still needs Rosetta Stone linkage",
        ],
    }
    out_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "data", "calibration_report.json")
    with open(out_path, "w") as f:
        json.dump(artifact, f, indent=2)
    print(f"\nwrote {out_path}")


if __name__ == "__main__":
    main()
