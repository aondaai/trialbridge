import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trialbridge.coverage import CalibratedCoverage, CALIBRATED_UFS_14
from trialbridge.registry import make_version


def test_default_has_14_ufs():
    cov = CalibratedCoverage.default()
    assert len(cov.ufs) == 14
    assert cov.is_covered("SP") is True


def test_uncovered_uf_is_rejected():
    cov = CalibratedCoverage.default()
    # "ZZ" is not a real UF and is never in the calibrated set
    assert cov.is_covered("ZZ") is False


def test_coverage_from_model_uses_model_valid_ufs():
    mv = make_version(shrink_alpha=20.0, train_dx=["breast_cancer"], valid_ufs=["SP", "RJ"])
    cov = CalibratedCoverage.from_model(mv)
    assert cov.is_covered("SP") is True
    assert cov.is_covered("MG") is False


def test_calibrated_constant_is_a_tuple_of_strings():
    assert isinstance(CALIBRATED_UFS_14, tuple)
    assert all(isinstance(u, str) for u in CALIBRATED_UFS_14)
