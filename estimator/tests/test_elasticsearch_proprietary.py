from datetime import date
from unittest.mock import patch

import pytest

from pipeline.handlers.elasticsearch_proprietary import (
    ElasticsearchError,
    FieldProfile,
    _adapt_reviewed_query,
    _plan_patients,
    _run_funnel,
    _validated_plan_stages,
    resolve_fields,
    search_reviewed_plan_elasticsearch,
    stage_query,
)
from pipeline.schemas import (
    AgeClause,
    BoolQuery,
    FunnelStage,
    PayerCounts,
    SearchSpec,
    SexClause,
    TextClause,
)


def profile():
    return FieldProfile(
        patient="unique_patient_id.keyword",
        gender="gender.keyword",
        birthdate="birthdate.keyword",
        created_at="created_at.keyword",
        primary_icd="primary_icd.keyword",
        hospital="provider.keyword",
        payer="health_insurance_source.keyword",
        candidate_ncts=None,
    )


def test_resolve_fields_supports_current_jsonl_mapping():
    caps = {
        "unique_patient_id": {"text": {}},
        "unique_patient_id.keyword": {"keyword": {}},
        "gender.keyword": {"keyword": {}},
        "birthdate.keyword": {"keyword": {}},
        "created_at.keyword": {"keyword": {}},
        "primary_icd.keyword": {"keyword": {}},
        "provider.keyword": {"keyword": {}},
        "health_insurance_source.keyword": {"keyword": {}},
    }
    fields = resolve_fields(caps)
    assert fields.patient == "unique_patient_id.keyword"
    assert fields.hospital == "provider.keyword"
    assert fields.payer == "health_insurance_source.keyword"


def test_stage_query_compiles_demographics_text_and_dx_filter():
    query = stage_query(
        BoolQuery(must=[
            AgeClause(min_age=40),
            SexClause(value="FEMALE"),
            TextClause(terms=["fibrose pulmonar", "IPF"], operator="or", tier=2),
        ]),
        profile(),
        date(2026, 7, 13),
        [{"prefix": {"primary_icd.keyword": {"value": "J84"}}}],
    )
    bool_query = query["bool"]
    assert bool_query["filter"]
    assert len(bool_query["must"]) == 3
    assert bool_query["must"][0]["range"]["birthdate.keyword"]["lte"] == "1986-07-13"


def test_patient_funnel_intersects_inclusions_and_subtracts_exclusions():
    spec = SearchSpec(nct="NCT1", dx={}, stages=[
        FunnelStage(kind="INCLUSAO", query=BoolQuery(must=[TextClause(terms=["base"])])),
        FunnelStage(kind="INCLUSAO", query=BoolQuery(must=[TextClause(terms=["include"])])),
        FunnelStage(kind="EXCLUSAO", query=BoolQuery(must=[TextClause(terms=["exclude"])])),
    ])
    matches = iter([{"p1", "p2", "p3"}, {"p2", "p3"}, {"p3"}])
    with patch(
        "pipeline.handlers.elasticsearch_proprietary._patients_for_query",
        side_effect=lambda *_: next(matches),
    ):
        result = _run_funnel(object(), spec, profile(), date(2026, 7, 13))
    assert result == {"p2"}


def test_reviewed_query_is_adapted_to_the_live_keyword_mapping():
    query = {"bool": {"must": [], "filter": [
        {"range": {"birthdate": {"lte": "now-18y/d"}}},
        {"term": {"gender": "FEMALE"}},
    ], "should": []}}
    adapted = _adapt_reviewed_query(query, profile(), date(2026, 7, 13))
    filters = adapted["bool"]["filter"]
    assert filters[0] == {"range": {"birthdate.keyword": {"lte": "2008-07-13"}}}
    assert filters[1] == {"term": {"gender.keyword": "FEMALE"}}


def test_reviewed_plan_skips_manual_stages_instead_of_hard_gating_them():
    plan = {
        "schemaVersion": "elasticsearch-funnel.v1",
        "reviewedAt": "2026-07-13T00:00:00Z",
        "stages": [
            {"criterionId": "age", "criterionText": "Adult", "stageType": "INCLUSION",
             "automation": "AUTOMATED", "query": {"bool": {"must": [], "filter": [], "should": []}}},
            {"criterionId": "ecog", "criterionText": "ECOG", "stageType": "INCLUSION",
             "automation": "ASSISTED", "query": {"bool": {"must": [], "filter": [], "should": []}}},
            {"criterionId": "consent", "criterionText": "Consent", "stageType": "INCLUSION",
             "automation": "MANUAL_REVIEW", "query": {"bool": {"must": [], "filter": [], "should": []}}},
        ],
    }
    stages = _validated_plan_stages(plan)
    matches = iter([{"p1", "p2"}, {"p2"}])
    with patch(
        "pipeline.handlers.elasticsearch_proprietary._patients_for_query",
        side_effect=lambda *_: next(matches),
    ):
        result = _plan_patients(
            object(), stages, profile(), "NCT06982521", {"AUTOMATED", "ASSISTED"},
            date(2026, 7, 13),
        )
    assert result == {"p2"}


def test_preselected_index_returns_nct_scoped_candidates_without_claiming_eligibility():
    plan = {
        "schemaVersion": "elasticsearch-funnel.v1",
        "reviewedAt": "2026-07-13T00:00:00Z",
        "stages": [{
            "criterionId": "dx", "criterionText": "Breast cancer",
            "stageType": "INCLUSION", "automation": "ASSISTED",
            "query": {"bool": {"must": [{"match_phrase": {"preds.text": {"query": "breast cancer"}}}], "filter": [], "should": []}},
        }],
    }
    with (
        patch("pipeline.handlers.elasticsearch_proprietary.ElasticsearchClient.field_caps", return_value={
            "unique_patient_id.keyword": {"keyword": {}},
            "candidate_ncts": {"keyword": {}},
        }),
        patch("pipeline.handlers.elasticsearch_proprietary.ElasticsearchClient.index_metadata", return_value={
            "ncts": "NCT06982521", "cohort_type": "preselected_candidates",
        }),
        patch("pipeline.handlers.elasticsearch_proprietary._patients_for_query", return_value={"p1", "p2"}),
        patch("pipeline.handlers.elasticsearch_proprietary._dimensions", return_value=(
            PayerCounts(sus=1, private=1, unknown=0), [], [],
        )),
    ):
        result = search_reviewed_plan_elasticsearch(
            plan, nct="NCT06982521", url="http://elasticsearch:9200", index="clinical-demo"
        )
    assert result.n_total == 2
    assert result.provenance["eligibility_status"] == "unverified"
    assert result.provenance["source_type"] == "nct_preselected_elasticsearch_cohort"
    assert result.provenance["ignored_criteria"] == ["Breast cancer"]


def test_preselected_index_refuses_unscoped_cross_trial_count():
    plan = {
        "schemaVersion": "elasticsearch-funnel.v1",
        "reviewedAt": "2026-07-13T00:00:00Z",
        "stages": [{
            "criterionId": "dx", "criterionText": "Breast cancer",
            "stageType": "INCLUSION", "automation": "ASSISTED",
            "query": {"bool": {"must": [], "filter": [], "should": []}},
        }],
    }
    with (
        patch("pipeline.handlers.elasticsearch_proprietary.ElasticsearchClient.field_caps", return_value={
            "unique_patient_id.keyword": {"keyword": {}},
        }),
        patch("pipeline.handlers.elasticsearch_proprietary.ElasticsearchClient.index_metadata", return_value={
            "ncts": "NCT06982521", "cohort_type": "preselected_candidates",
        }),
    ):
        with pytest.raises(ElasticsearchError, match="unscoped cross-trial count"):
            search_reviewed_plan_elasticsearch(
                plan, nct="NCT06982521", url="http://elasticsearch:9200", index="clinical-demo"
            )
