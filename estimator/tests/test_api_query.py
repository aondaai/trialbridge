import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trialbridge.data import SyntheticDataSUS, SyntheticProprietary
from trialbridge.coverage import CalibratedCoverage
from trialbridge.registry import make_version
from trialbridge.query import route, Intent
from demo import demo_protocol


def test_route_market_size_shape_for_api():
    # This mirrors exactly what the /query endpoint will assemble.
    P, DS, PR = demo_protocol(), SyntheticDataSUS(), SyntheticProprietary(seed=7)
    cov = CalibratedCoverage(ufs=frozenset({"SP", "RJ", "RS"}))
    mv = make_version(20.0, ["breast_cancer"], ["SP", "RJ", "RS"])
    res = route(Intent.MARKET_SIZE, protocol=P, proprietary=PR, datasus=DS,
                coverage=cov, model_version=mv.version)
    assert res.provenance.origin.value == "imputed"
    assert res.provenance.model_version == mv.version
    lo, hi = res.provenance.ci
    assert lo <= res.value <= hi
