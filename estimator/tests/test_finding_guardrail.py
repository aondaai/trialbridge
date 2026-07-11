import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

import trialbridge.query as query
from trialbridge.query import route, Intent, FindingOverImputedError
from trialbridge.data import SyntheticDataSUS, SyntheticProprietary
from trialbridge.coverage import CalibratedCoverage
from demo import demo_protocol

P = demo_protocol()
PR = SyntheticProprietary(seed=7)
DS = SyntheticDataSUS()
COV = CalibratedCoverage(ufs=frozenset({"SP", "RJ", "RS"}))


def test_find_does_not_call_estimate(monkeypatch):
    """FIND must never invoke the imputation model. If it does, fail loudly."""
    def boom(*a, **k):
        raise AssertionError("FIND reached estimate() — regra de ouro violated")
    monkeypatch.setattr(query, "estimate", boom)

    res = route(Intent.FIND, protocol=P, proprietary=PR)  # no datasus -> observed only
    assert res.provenance.origin.value == "observed"


def test_find_with_imputed_source_raises_not_estimates(monkeypatch):
    """Passing an imputed source under FIND must raise, never silently estimate."""
    def boom(*a, **k):
        raise AssertionError("FIND reached estimate() — regra de ouro violated")
    monkeypatch.setattr(query, "estimate", boom)

    with pytest.raises(FindingOverImputedError):
        route(Intent.FIND, protocol=P, proprietary=PR, datasus=DS)


def test_market_size_does_call_estimate():
    """Sanity: the imputed path IS exercised for MARKET_SIZE (guardrail isn't vacuous)."""
    res = route(Intent.MARKET_SIZE, protocol=P, proprietary=PR, datasus=DS,
                coverage=COV, model_version="enrich-test01")
    assert res.provenance.origin.value == "imputed"
