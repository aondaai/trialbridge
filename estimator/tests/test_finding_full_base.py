import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trialbridge.data import BaseRecord
from trialbridge.finding import finding_n_by_site, SiteFinding
from trialbridge.schema import Criterion, Protocol


def _src(records):
    class _S:
        def records(self):
            return records
    return _S()


def _protocol():
    return Protocol("t", [
        Criterion("dx", "breast", "inclusion", "checkable", "dx", "in", ["breast_cancer"]),
        Criterion("sex", "F", "inclusion", "checkable", "sex", "eq", "F"),
        Criterion("age", "18-69", "inclusion", "checkable", "age_band", "in",
                  ["18-39", "40-49", "50-59", "60-69"]),
    ])


def test_applies_checkable_and_groups_by_site():
    recs = [
        BaseRecord("ha", "ha", "breast_cancer", "50-59", "F", 100),
        BaseRecord("ha", "ha", "breast_cancer", "50-59", "M", 3),    # male -> excluded by sex=F
        BaseRecord("ha", "ha", "breast_cancer", "70+", "F", 50),      # age 70+ -> excluded
        BaseRecord("hmv", "hmv", "breast_cancer", "40-49", "F", 20),
    ]
    out = {s.site: s for s in finding_n_by_site(_protocol(), _src(recs))}
    assert out["ha"].with_dx == 153          # all breast strata at ha (100+3+50)
    assert out["ha"].finding_n == 100         # only F/50-59 passes checkable
    assert out["hmv"].finding_n == 20


def test_sorted_by_finding_n_desc():
    recs = [
        BaseRecord("small", "small", "breast_cancer", "40-49", "F", 5),
        BaseRecord("big", "big", "breast_cancer", "40-49", "F", 500),
    ]
    order = [s.site for s in finding_n_by_site(_protocol(), _src(recs))]
    assert order == ["big", "small"]


def test_other_dx_excluded_from_both_with_dx_and_finding_n():
    # A multi-dx source must not mix other diagnoses into with_dx (the bug: lung leaking
    # into a breast protocol's "patients with the diagnosis").
    recs = [
        BaseRecord("ha", "ha", "lung_cancer", "50-59", "F", 40),   # not breast -> excluded from both
        BaseRecord("ha", "ha", "breast_cancer", "50-59", "F", 10),
    ]
    out = {s.site: s for s in finding_n_by_site(_protocol(), _src(recs))}
    assert out["ha"].with_dx == 10     # breast only, NOT 50 (lung excluded)
    assert out["ha"].finding_n == 10
