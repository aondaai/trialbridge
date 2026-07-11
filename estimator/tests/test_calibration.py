"""Calibration machinery tests (Trilha B, step 2).

These validate the math in isolation on synthetic data — the real reliability numbers
come from the holdout harness over proprietary data (scripts/calibration_holdout.py).
"""
from __future__ import annotations

import math

from trialbridge.calibration import (
    IsotonicCalibrator,
    PlattCalibrator,
    make_calibration_ref,
    reliability,
)


def test_reliability_perfect_calibration_has_zero_ece():
    # predicted prob equals the true generating rate in each bin -> ~0 ECE
    pairs = []
    for p in (0.1, 0.3, 0.5, 0.7, 0.9):
        # 1000 draws whose observed rate is exactly p
        k = int(round(p * 1000))
        pairs += [(p, 1)] * k + [(p, 0)] * (1000 - k)
    rep = reliability(pairs, n_bins=10)
    assert rep.ece < 1e-6
    assert rep.n == 5000


def test_reliability_detects_miscalibration():
    # model always says 0.9 but truth is 0.5 -> gap 0.4
    pairs = [(0.9, 1)] * 500 + [(0.9, 0)] * 500
    rep = reliability(pairs, n_bins=10)
    assert abs(rep.mce - 0.4) < 1e-9
    assert abs(rep.ece - 0.4) < 1e-9


def test_isotonic_is_monotone_nondecreasing():
    # truth increases with p but predictions are compressed; PAVA should recover order
    pairs = []
    for p in (0.2, 0.4, 0.6, 0.8):
        truth = p  # observed rate tracks p
        k = int(round(truth * 200))
        pairs += [(p, 1)] * k + [(p, 0)] * (200 - k)
    cal = IsotonicCalibrator.fit(pairs)
    grid = [i / 20 for i in range(21)]
    out = [cal(x) for x in grid]
    for a, b in zip(out, out[1:]):
        assert b >= a - 1e-9  # non-decreasing


def test_isotonic_corrects_overconfident_predictions():
    # model predicts 0.9 but real rate is 0.5; isotonic should pull calibrated ~0.5
    pairs = [(0.9, 1)] * 500 + [(0.9, 0)] * 500
    cal = IsotonicCalibrator.fit(pairs)
    assert abs(cal(0.9) - 0.5) < 0.02


def test_platt_reduces_ece_on_overconfident_data():
    # generate a smooth miscalibration: true prob = sigmoid(0.5*logit(p)) (under-confident-ish)
    def true_rate(p):
        lp = math.log(p / (1 - p))
        return 1 / (1 + math.exp(-(0.5 * lp)))

    pairs = []
    preds = [0.05, 0.15, 0.3, 0.5, 0.7, 0.85, 0.95]
    for p in preds:
        tr = true_rate(p)
        k = int(round(tr * 400))
        pairs += [(p, 1)] * k + [(p, 0)] * (400 - k)
    before = reliability(pairs, n_bins=10)
    cal = PlattCalibrator.fit(pairs)
    after_pairs = [(cal(p), y) for p, y in pairs]
    after = reliability(after_pairs, n_bins=10)
    assert after.ece < before.ece
    # recovered slope should be near 0.5 (the true stretch)
    assert 0.3 < cal.a < 0.7


def test_platt_identity_on_wellcalibrated_data():
    pairs = []
    for p in (0.2, 0.5, 0.8):
        k = int(round(p * 300))
        pairs += [(p, 1)] * k + [(p, 0)] * (300 - k)
    cal = PlattCalibrator.fit(pairs)
    # near identity: a~1, b~0, so cal(p)~p
    for p in (0.2, 0.5, 0.8):
        assert abs(cal(p) - p) < 0.05


def test_calibration_ref_is_deterministic_and_sensitive():
    a = make_calibration_ref("platt", "leave-one-hospital-out", 2000, "enrich-abc123")
    b = make_calibration_ref("platt", "leave-one-hospital-out", 2000, "enrich-abc123")
    c = make_calibration_ref("isotonic", "leave-one-hospital-out", 2000, "enrich-abc123")
    assert a == b
    assert a != c
    assert a.startswith("calib-")


def test_empty_inputs_are_safe():
    assert reliability([]).n == 0
    assert PlattCalibrator.fit([]).n_train == 0
    iso = IsotonicCalibrator.fit([])
    assert iso(0.5) == 0.5  # identity fallback
