import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trialbridge.findability import findability, StratumFindability


def test_rate_is_observed_over_estimated():
    obs = {"SP": 8000, "RJ": 1000}
    est = {"SP": 40000.0, "RJ": 5000.0}
    rows = {r.stratum: r for r in findability(obs, est)}
    assert abs(rows["SP"].rate - 0.20) < 1e-9
    assert abs(rows["RJ"].rate - 0.20) < 1e-9


def test_missing_observed_counts_as_zero():
    rows = {r.stratum: r for r in findability({}, {"SP": 40000.0})}
    assert rows["SP"].observed_n == 0
    assert rows["SP"].rate == 0.0


def test_zero_estimated_gives_none_rate():
    rows = {r.stratum: r for r in findability({"SP": 5}, {"SP": 0.0})}
    assert rows["SP"].rate is None


def test_sorted_lowest_findability_first():
    obs = {"A": 900, "B": 100}
    est = {"A": 1000.0, "B": 1000.0}  # A: 0.9, B: 0.1
    rows = findability(obs, est)
    assert [r.stratum for r in rows] == ["B", "A"]  # biggest gap (lowest rate) first
