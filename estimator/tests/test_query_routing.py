import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from trialbridge.data import SyntheticDataSUS, SyntheticProprietary
from trialbridge.provenance import Origin
from trialbridge.query import route, Intent, FindingOverImputedError
from trialbridge.coverage import CalibratedCoverage
from demo import demo_protocol

P = demo_protocol()
DS = SyntheticDataSUS()
PR = SyntheticProprietary(seed=7)
COV = CalibratedCoverage(ufs=frozenset({"SP", "RJ", "RS"}))


def test_find_returns_observed_provenance():
    res = route(Intent.FIND, protocol=P, proprietary=PR)
    assert res.provenance.origin is Origin.OBSERVED
    # value is the observed-N total across sites (an int)
    assert isinstance(res.value, int) and res.value >= 0


def test_market_size_returns_imputed_provenance_with_model_version():
    res = route(Intent.MARKET_SIZE, protocol=P, proprietary=PR, datasus=DS,
                coverage=COV, model_version="enrich-test01")
    assert res.provenance.origin is Origin.IMPUTED
    assert res.provenance.model_version == "enrich-test01"
    assert res.provenance.ci is not None


def test_market_size_without_coverage_is_rejected():
    with pytest.raises(ValueError):
        route(Intent.MARKET_SIZE, protocol=P, proprietary=PR, datasus=DS,
              coverage=None, model_version="enrich-test01")


def test_find_never_reaches_datasus_even_if_passed():
    # Guardrail: a FIND request must not consume the imputed pathway. Passing datasus
    # under FIND is a misuse and must raise, not silently estimate.
    with pytest.raises(FindingOverImputedError):
        route(Intent.FIND, protocol=P, proprietary=PR, datasus=DS)


def test_findability_returns_rate_between_0_and_1():
    res = route(Intent.FINDABILITY, protocol=P, proprietary=PR, datasus=DS,
                coverage=COV, model_version="enrich-test01")
    # value is the national findability rate (float in [0,1]) or None
    assert res.value is None or (0.0 <= res.value <= 1.0)
