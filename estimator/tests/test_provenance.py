import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from trialbridge.provenance import Origin, Provenance, Provenanced, observed, imputed


def test_observed_has_no_model_fields():
    p = observed(42, as_of="2026-07-09")
    assert isinstance(p, Provenanced)
    assert p.value == 42
    assert p.provenance.origin is Origin.OBSERVED
    assert p.provenance.probability is None
    assert p.provenance.model_version is None


def test_imputed_carries_probability_ci_and_model():
    p = imputed(0.72, probability=0.72, ci=(0.66, 0.78),
                model_version="enrich-abc123", calibration_ref="SP-50-59-F")
    assert p.provenance.origin is Origin.IMPUTED
    assert p.provenance.probability == 0.72
    assert p.provenance.ci == (0.66, 0.78)
    assert p.provenance.model_version == "enrich-abc123"
    assert p.provenance.calibration_ref == "SP-50-59-F"


def test_observed_with_model_field_is_rejected():
    with pytest.raises(ValueError):
        Provenance(origin=Origin.OBSERVED, model_version="enrich-abc123")


def test_imputed_without_model_version_is_rejected():
    with pytest.raises(ValueError):
        Provenance(origin=Origin.IMPUTED, probability=0.5, ci=(0.4, 0.6))
