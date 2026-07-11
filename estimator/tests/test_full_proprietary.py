import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import duckdb

from trialbridge.data import FullProprietary

PREFIXES = {"breast_cancer": ["C50"], "lung_cancer": ["C33", "C34"]}


def _write_parquet(path, rows):
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE t(unique_patient_id VARCHAR, hospital VARCHAR, gender VARCHAR, "
        "birth_year INTEGER, primary_icd VARCHAR)"
    )
    con.executemany("INSERT INTO t VALUES (?,?,?,?,?)", rows)
    con.execute(f"COPY t TO '{path}' (FORMAT PARQUET)")
    con.close()


def test_gender_age_dx_mapping_and_distinct_counting():
    rows = [
        ("p1", "ha", "FEMALE", 1970, "C509"),   # breast F 50-59
        ("p1", "ha", "FEMALE", 1970, "C509"),   # duplicate document -> same patient, counts once
        ("p2", "ha", "MALE", 1970, "C509"),     # breast M 50-59
        ("p3", "ha", "FEMALE", 1965, "C349"),   # lung F 60-69 (2025-1965=60)
        ("p4", "ha", "UNKNOWN", 1970, "C509"),  # UNKNOWN gender -> dropped
        ("p5", "ha", "FEMALE", 9201, "C509"),   # dirty birth_year -> dropped
        ("p6", "ha", "FEMALE", 1970, "J45"),    # non-oncology -> dropped (dx NULL)
    ]
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "ihealth.parquet")
        _write_parquet(p, rows)
        recs = FullProprietary(parquet_glob=p, dx_cid_prefixes=PREFIXES, min_cell=1).records()
    got = {(r.dx, r.age_band, r.sex): r.count for r in recs}
    assert got == {
        ("breast_cancer", "50-59", "F"): 1,   # p1 (distinct, deduped)
        ("breast_cancer", "50-59", "M"): 1,   # p2 -> MALE mapped to M
        ("lung_cancer", "60-69", "F"): 1,     # p3
    }, got
    assert all(r.site == "ha" for r in recs)


def test_min_cell_suppression():
    rows = [("p%d" % i, "big", "FEMALE", 1970, "C509") for i in range(6)]   # 6 distinct
    rows += [("q1", "small", "FEMALE", 1970, "C509"), ("q2", "small", "FEMALE", 1970, "C509")]  # 2
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "ihealth.parquet")
        _write_parquet(p, rows)
        recs = FullProprietary(parquet_glob=p, dx_cid_prefixes=PREFIXES, min_cell=5).records()
    sites = {r.site: r.count for r in recs}
    assert sites == {"big": 6}   # 'small' (n=2) suppressed below min_cell=5
