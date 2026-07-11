import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trialbridge.data import SyntheticDataSUS, SyntheticProprietary
from trialbridge.estimator import estimate, national_total, covered_only
from trialbridge.coverage import CalibratedCoverage
from demo import demo_protocol


def test_estimates_carry_model_version():
    p, ds, pr = demo_protocol(), SyntheticDataSUS(), SyntheticProprietary(seed=7)
    ests = estimate(p, ds, pr, model_version="enrich-test01")
    assert ests, "expected at least one site estimate"
    assert all(e.model_version == "enrich-test01" for e in ests)


def test_coverage_marks_only_calibrated_regions():
    # SyntheticDataSUS regions are SP, RJ, RS. Cover only SP.
    p, ds, pr = demo_protocol(), SyntheticDataSUS(), SyntheticProprietary(seed=7)
    cov = CalibratedCoverage(ufs=frozenset({"SP"}))
    ests = estimate(p, ds, pr, coverage=cov, model_version="enrich-test01")
    covered = {e.region for e in ests if e.covered}
    uncovered = {e.region for e in ests if not e.covered}
    assert covered == {"SP"}
    assert "RJ" in uncovered and "RS" in uncovered


def test_covered_only_national_total_is_smaller():
    p, ds, pr = demo_protocol(), SyntheticDataSUS(), SyntheticProprietary(seed=7)
    cov = CalibratedCoverage(ufs=frozenset({"SP"}))
    ests = estimate(p, ds, pr, coverage=cov, model_version="enrich-test01")
    all_total = national_total(ests)[0]
    cov_total = national_total(ests, covered_only=True)[0]
    assert cov_total < all_total
    assert cov_total == national_total(covered_only(ests))[0]


def test_default_behavior_unchanged_when_no_coverage():
    # No coverage passed -> every estimate covered, back-compat with existing suite.
    p, ds, pr = demo_protocol(), SyntheticDataSUS(), SyntheticProprietary(seed=7)
    ests = estimate(p, ds, pr)
    assert all(e.covered for e in ests)
