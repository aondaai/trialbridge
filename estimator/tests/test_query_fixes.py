import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trialbridge.data import SyntheticDataSUS, SyntheticProprietary
from trialbridge.estimator import estimate
from trialbridge.coverage import CalibratedCoverage
from trialbridge.query import route, Intent
from demo import demo_protocol


def test_market_size_probability_is_none():
    P, DS, PR = demo_protocol(), SyntheticDataSUS(), SyntheticProprietary(seed=7)
    cov = CalibratedCoverage(ufs=frozenset({"SP", "RJ", "RS"}))
    res = route(Intent.MARKET_SIZE, protocol=P, proprietary=PR, datasus=DS,
                coverage=cov, model_version="enrich-test01")
    assert res.provenance.probability is None
    assert res.value > 0  # the count is in value, not probability


def test_findability_probability_is_none():
    P, DS, PR = demo_protocol(), SyntheticDataSUS(), SyntheticProprietary(seed=7)
    cov = CalibratedCoverage(ufs=frozenset({"SP", "RJ", "RS"}))
    res = route(Intent.FINDABILITY, protocol=P, proprietary=PR, datasus=DS,
                coverage=cov, model_version="enrich-test01")
    assert res.provenance.probability is None


def test_findability_uses_observed_proprietary_source():
    P, DS = demo_protocol(), SyntheticDataSUS()
    cov = CalibratedCoverage(ufs=frozenset({"SP", "RJ", "RS"}))
    PR_small = SyntheticProprietary(n_per_dx=300, seed=1)
    PR_big = SyntheticProprietary(n_per_dx=3000, seed=2)
    # denominator (estimate) fixed to PR_small in both; only the observed numerator source changes
    r_small = route(Intent.FINDABILITY, protocol=P, proprietary=PR_small, datasus=DS,
                    coverage=cov, model_version="m", observed_proprietary=PR_small)
    r_big = route(Intent.FINDABILITY, protocol=P, proprietary=PR_small, datasus=DS,
                  coverage=cov, model_version="m", observed_proprietary=PR_big)
    # bigger observed pool -> bigger numerator -> higher findability rate
    assert r_big.value > r_small.value
    # default (no observed_proprietary) falls back to `proprietary`
    r_default = route(Intent.FINDABILITY, protocol=P, proprietary=PR_small, datasus=DS,
                      coverage=cov, model_version="m")
    assert abs(r_default.value - r_small.value) < 1e-9


def test_prevalence_applies_checkable_criteria():
    P, DS, PR = demo_protocol(), SyntheticDataSUS(), SyntheticProprietary(seed=7)
    res = route(Intent.PREVALENCE, protocol=P, proprietary=PR, datasus=DS)
    all_records_total = sum(r.count for r in DS.records())
    base_cohort_total = sum(e.base_cohort for e in estimate(P, DS, PR))
    assert res.value == base_cohort_total       # matches the estimator's national base cohort
    assert res.value < all_records_total          # checkable filtered out non-matching rows
