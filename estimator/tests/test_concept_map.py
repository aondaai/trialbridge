"""F003 — the Python half of the shared concept map.

Proves the SAME concept-map.json the Next app writes reaches the estimator and
supplies dx_cid_prefixes, deterministically and WITHOUT the DataSUS parquet lake
(construction stores args; no duckdb query is run here).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trialbridge.concept_map import load_concept_map, dx_cid_prefixes, concept_map_path
from trialbridge.data import DuckDBDataSUS

# The golden truth, mirrored on the Python side (matches the TS golden gate).
HAND_TYPED_TRUTH = {"breast_cancer": ["C50"], "lung_cancer": ["C33", "C34"]}


def test_concept_map_exists_and_parses():
    p = concept_map_path()
    assert p.exists(), f"concept-map.json missing at {p} (build it first)"
    cm = load_concept_map()
    assert "dxPrefixes" in cm and "entries" in cm
    assert len(cm["entries"]) > 0


def test_dx_prefixes_match_hand_typed_truth():
    assert dx_cid_prefixes() == HAND_TYPED_TRUTH


def test_duckdb_datasus_wires_derived_prefixes_without_the_lake():
    # A path that does not exist — construction must NOT touch it (graceful absence).
    ds = DuckDBDataSUS(parquet_dir="/nonexistent/lake", dx_cid_prefixes=dx_cid_prefixes())
    assert ds.dx_cid_prefixes == HAND_TYPED_TRUTH
    # breast_cancer is the hero dx and must be present for the estimator to run.
    assert ds.dx_cid_prefixes["breast_cancer"] == ["C50"]
