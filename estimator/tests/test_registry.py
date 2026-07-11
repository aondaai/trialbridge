import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from trialbridge.registry import ModelVersion, ModelRegistry, make_version


def test_version_is_deterministic():
    a = make_version(shrink_alpha=20.0, train_dx=["breast_cancer"], valid_ufs=["SP", "RJ"])
    b = make_version(shrink_alpha=20.0, train_dx=["breast_cancer"], valid_ufs=["RJ", "SP"])
    assert a.version == b.version  # order-insensitive params -> same id
    assert a.version.startswith("enrich-")


def test_different_params_give_different_version():
    a = make_version(shrink_alpha=20.0, train_dx=["breast_cancer"], valid_ufs=["SP"])
    b = make_version(shrink_alpha=10.0, train_dx=["breast_cancer"], valid_ufs=["SP"])
    assert a.version != b.version


def test_register_and_get_roundtrip():
    reg = ModelRegistry()
    mv = make_version(shrink_alpha=20.0, train_dx=["breast_cancer"], valid_ufs=["SP"])
    reg.register(mv)
    assert reg.get(mv.version) is mv
    assert reg.get(mv.version).valid_ufs == ("SP",)


def test_get_unknown_version_raises():
    with pytest.raises(KeyError):
        ModelRegistry().get("enrich-deadbeef")
