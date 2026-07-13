from pipeline.cma_service import pack_to_national_estimate, run_status_for_pack
from pipeline.jobs import CmaJobStore, CmaRunRequest, CmaRunView
from pipeline.schemas import (FeasibilityPack, UFEstimate, SearchSpec, FunnelStage, BoolQuery,
                              TextClause, ProprietaryCounts, PayerCounts)
from pipeline.handlers.datasus import query_materialized_datasus, build_pack
from pipeline.handlers.proprietary import search_proprietary
import duckdb
from datetime import date
from pathlib import Path
import json


def request():
    return CmaRunRequest(
        consultation_id="consultation-1", nct="NCT06253871",
        protocol_text="Inclusion Criteria: breast cancer",
        verified_criteria=[{"kind": "inclusion", "field": "diagnosis"}],
        criteria_hash="sha256:" + "a" * 64,
    )


def test_jobs_are_idempotent_and_recoverable(tmp_path):
    store = CmaJobStore(tmp_path / "jobs.sqlite3")
    first, created = store.create_or_get(request())
    second, duplicate = store.create_or_get(request())
    assert created is True and duplicate is False and first.id == second.id
    assert "request" not in CmaRunView.model_validate(first.model_dump()).model_dump()
    assert store.claim(first.id) is True
    store.update(first.id, "datasus_running")
    assert store.recover_interrupted() == [first.id]


def test_failed_job_needs_explicit_requeue(tmp_path):
    store = CmaJobStore(tmp_path / "jobs.sqlite3")
    record, _ = store.create_or_get(request())
    assert store.claim(record.id)
    store.update(record.id, "failed", error="temporary")
    assert store.requeue_failed(record.id)
    assert store.get(record.id).status == "queued"


def test_pack_maps_to_web_contract():
    pack = FeasibilityPack(
        nct="NCT06253871",
        per_uf_eligible=[UFEstimate(uf="SP", base_cohort=100, est_eligible=25, ci_lo=20, ci_hi=30)],
        national={"est_eligible": 25, "ci_lo": 20, "ci_hi": 30},
        private_population_signal={"n": 7, "note": "aggregate"},
        provenance={"datasus": {"source": "fixture"}}, coverage_caveat="proxy",
    )
    result = pack_to_national_estimate(pack, "consultation-1")
    assert result["protocol_id"] == "consultation-1"
    assert result["national_base_cohort"] == 100
    assert result["proprietary_finding_total"] == 7
    assert result["datasus_source"] == "fixture"


def test_ignored_criteria_make_run_partial():
    pack = FeasibilityPack(
        nct="NCT06253871", per_uf_eligible=[],
        national={"est_eligible": 0, "ci_lo": 0, "ci_hi": 0},
        private_population_signal={"n": 0, "note": "aggregate"},
        provenance={"proprietary": {"ignored_criteria": ["renal function"]}},
        coverage_caveat="criterion unavailable",
    )
    assert run_status_for_pack(pack) == "partial"


def test_materialized_datasus_uses_national_c50_cohort():
    base_dir = Path(__file__).parents[1] / "data" / "datasus_base"
    spec = SearchSpec(
        nct="NCT06982521",
        dx={"concepts": ["breast_cancer"], "cid_prefixes": ["C50"]},
        stages=[],
    )
    result = query_materialized_datasus(spec, base_dir=str(base_dir))
    assert sum(item.base_cohort for item in result.by_uf) == 394255
    assert len(result.by_uf) == 27
    assert result.provenance["source_type"] == "materialized_national_aggregate"
    assert result.provenance["matched_concepts"] == ["breast_cancer"]


def test_materialized_datasus_selects_ipf_j841(tmp_path):
    (tmp_path / "records.json").write_text(json.dumps([
        {"site": "DataSUS — SP", "region": "SP",
         "dx": "idiopathic_pulmonary_fibrosis", "age_band": "60-69",
         "sex": "F", "count": 17},
    ]))
    (tmp_path / "incidence.json").write_text("{}")
    (tmp_path / "provenance.json").write_text(json.dumps({
        "source": "DataSUS OMOP test",
        "dx_cid_prefixes": {"idiopathic_pulmonary_fibrosis": ["J841"]},
    }))
    spec = SearchSpec(
        nct="NCT07687459",
        dx={"concepts": ["idiopathic_pulmonary_fibrosis"], "cid_prefixes": ["J841"]},
        stages=[],
    )

    result = query_materialized_datasus(spec, base_dir=str(tmp_path))

    assert sum(item.base_cohort for item in result.by_uf) == 17
    assert result.provenance["matched_concepts"] == ["idiopathic_pulmonary_fibrosis"]


def test_preselected_candidates_do_not_become_an_eligibility_fraction():
    base_dir = Path(__file__).parents[1] / "data" / "datasus_base"
    spec = SearchSpec(
        nct="NCT06982521",
        dx={"concepts": ["breast_cancer"], "cid_prefixes": ["C50"]},
        stages=[],
    )
    datasus = query_materialized_datasus(spec, base_dir=str(base_dir))
    proprietary = ProprietaryCounts(
        n_total=585,
        by_payer=PayerCounts(sus=0, private=0, unknown=585),
        by_site=[],
        depth_ratios={},
        provenance={"source_type": "nct_preselected_elasticsearch_cohort"},
    )
    pack = build_pack(spec, datasus, proprietary, depth_ratio=None)
    assert pack.provenance["estimation"] == {
        "kind": "base_cohort_only",
        "eligibility_fraction_applied": False,
        "eligibility_fraction": None,
    }
    assert pack.private_population_signal["n"] == 585
    assert run_status_for_pack(pack) == "partial"


def test_vendored_structured_depth_schema_is_supported(tmp_path):
    path = tmp_path / "structured.parquet"
    con = duckdb.connect()
    con.execute("CREATE TABLE depth(patient_id VARCHAR, sex VARCHAR, birth_year INTEGER, "
                "her2 BOOLEAN, ecog INTEGER, metastatic BOOLEAN, autoimmune BOOLEAN)")
    con.execute("INSERT INTO depth VALUES ('p1','F',1960,true,1,true,false), "
                "('p2','F',1970,false,1,true,false), ('p3','M',1980,true,2,false,false)")
    con.execute(f"COPY depth TO '{path}' (FORMAT parquet)")
    breast = TextClause(terms=["breast cancer"], tier=1)
    spec = SearchSpec(nct="NCT03529110", dx={"cid_prefixes": ["C50"]}, stages=[
        FunnelStage(kind="INCLUSAO", query=BoolQuery(must=[breast])),
        FunnelStage(kind="INCLUSAO", query=BoolQuery(must=[
            TextClause(terms=["her2 positive"], tier=2, label="HER2-positive")
        ])),
    ])
    result = search_proprietary(spec, parquet_glob=str(path), reference_year=2025,
                                as_of=date(2025, 7, 1))
    assert result.n_total == 2
    assert result.depth_ratios["ratio_basis"].startswith("overall_structured")
