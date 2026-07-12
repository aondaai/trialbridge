from datetime import date
import duckdb
import pytest

from trialbridge.search_compiler import compile_proprietary_search
from trialbridge.search_spec import ClinicalSearchSpec


def spec():
    return ClinicalSearchSpec.model_validate({
        "version": 1, "consultation_id": "c1", "as_of": "2026-07-12", "reference_year": 2026,
        "diagnosis": {"concepts": ["breast_cancer"], "cid10_prefixes": ["C50"]},
        "stages": [
            {"id":"base", "kind":"INCLUSAO", "query":{"filter":[{"type":"sex","value":"FEMALE"},{"type":"age","min_age":18}]}},
            {"id":"her2", "kind":"INCLUSAO", "query":{"must":[{"type":"text","terms":["HER2 positivo","HER2+"],"operator":"or"}]}},
            {"id":"exclude", "kind":"EXCLUSAO", "query":{"must":[{"type":"text","terms":["gestante"],"operator":"or"}]}},
        ]})


def test_compiles_parameterized_patient_grain_sets():
    c = compile_proprietary_search(spec())
    assert "INTERSECT" in c.sql and "EXCEPT" in c.sql
    assert "HER2 positivo" not in c.sql
    assert "her2 positivo" in c.params
    assert c.stage_ids == ("base", "her2", "exclude")


def test_executes_expected_funnel():
    con=duckdb.connect()
    con.execute("CREATE TABLE proprietary_docs(unique_patient_id VARCHAR, primary_icd VARCHAR, gender VARCHAR, birth_year INTEGER, created_ts TIMESTAMP, texto VARCHAR)")
    rows=[("p1","C509","FEMALE",1970,"2025-01-01","HER2 positivo"),("p2","C509","FEMALE",1980,"2025-01-01","HER2 positivo gestante"),("p3","C349","FEMALE",1970,"2025-01-01","HER2 positivo")]
    con.executemany("INSERT INTO proprietary_docs VALUES (?,?,?,?,?,?)",rows)
    c=compile_proprietary_search(spec())
    assert con.execute(c.sql,c.params).fetchall()==[("p1",)]


def test_rejects_unsafe_cid_and_table():
    raw=spec().model_dump(); raw["diagnosis"]["cid10_prefixes"]=["C50'; DROP TABLE x;--"]
    with pytest.raises(ValueError): ClinicalSearchSpec.model_validate(raw)
    with pytest.raises(ValueError): compile_proprietary_search(spec(),"read_parquet('/tmp/x')")
