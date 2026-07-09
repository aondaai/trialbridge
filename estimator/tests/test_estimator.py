"""Method sanity checks. Run:  python -m pytest -q   (or)  python tests/test_estimator.py

These are the properties that make the estimate trustworthy:
  1. internal consistency: national total == sum of site estimates
  2. standardization reduces bias vs a naive overall rate
  3. softening is monotone: relaxing an inclusion criterion never shrinks the pool
  4. CIs widen when the proprietary sample is smaller
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trialbridge.data import SyntheticDataSUS, SyntheticProprietary
from trialbridge.estimator import estimate, national_total, rank_bottlenecks
from demo import demo_protocol, naive_national


def test_internal_consistency():
    p, ds, pr = demo_protocol(), SyntheticDataSUS(), SyntheticProprietary(seed=7)
    ests = estimate(p, ds, pr)
    nat = national_total(ests)[0]
    assert abs(nat - sum(s.est_eligible for s in ests)) < 1e-6


def test_standardization_reduces_bias():
    p, ds = demo_protocol(), SyntheticDataSUS()
    skewed = SyntheticProprietary(n_per_dx=1500, seed=7, young_skew=True)
    truth_ref = SyntheticProprietary(n_per_dx=40000, seed=999, young_skew=False)

    standardized = national_total(estimate(p, ds, skewed))[0]
    truth = national_total(estimate(p, ds, truth_ref))[0]
    naive = naive_national(p, ds, skewed)

    # standardized estimate must be closer to truth than the naive overall rate
    assert abs(standardized - truth) < abs(naive - truth)
    # and the naive one should be biased high (young-skewed sample => rosier)
    assert naive > truth


def test_softening_monotone():
    p, ds, pr = demo_protocol(), SyntheticDataSUS(), SyntheticProprietary(seed=7)
    baseline = national_total(estimate(p, ds, pr))[0]
    for c in p.depth():
        if c.type == "inclusion":
            softened = national_total(estimate(p, ds, pr, exclude_depth_ids={c.id}))[0]
            assert softened >= baseline - 1e-6, f"relaxing {c.id} shrank the pool"


def test_bottleneck_ranking_nonnegative_and_sorted():
    p, ds, pr = demo_protocol(), SyntheticDataSUS(), SyntheticProprietary(seed=7)
    bn = rank_bottlenecks(p, ds, pr)
    gains = [b.gain for b in bn]
    assert all(g >= -1e-6 for g in gains)
    assert gains == sorted(gains, reverse=True)


def test_ci_widens_with_smaller_sample():
    p, ds = demo_protocol(), SyntheticDataSUS()
    big = estimate(p, ds, SyntheticProprietary(n_per_dx=5000, seed=1))
    small = estimate(p, ds, SyntheticProprietary(n_per_dx=200, seed=1))
    width = lambda es: sum(s.ci_hi - s.ci_lo for s in es)
    assert width(small) > width(big)


def _run_all():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"  PASS  {fn.__name__}")
    print(f"\n{len(fns)} tests passed.")


if __name__ == "__main__":
    _run_all()
