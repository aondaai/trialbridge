import json

import pytest

from pipeline.demo_cases import (DemoCaseError, load_datasus_capture,
                                 load_proprietary_capture, resolve_demo_case)
from pipeline.schemas import Tier2Item


NCTS = [
    "NCT06982521", "NCT06253871", "NCT07687459", "NCT07276724",
    "NCT07359846", "NCT05544019", "NCT06898450",
]


def _write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def test_manifest_routes_all_demo_ncts_and_solairia_pair(tmp_path):
    cases = []
    for index, nct in enumerate(NCTS):
        if nct == "NCT07359846":
            continue
        ncts = [nct, "NCT07359846"] if nct == "NCT07276724" else [nct]
        slug = f"case-{index}"
        _write(tmp_path / slug / "proprietary.json", {
            "ncts": ncts, "shallow_n": 10, "full_n": 5,
        })
        _write(tmp_path / slug / "datasus.json", {"ncts": ncts, "by_uf": []})
        cases.append({
            "slug": slug, "ncts": ncts,
            "proprietary": {"type": "capture", "path": f"{slug}/proprietary.json"},
            "datasus_capture": f"{slug}/datasus.json",
        })
    _write(tmp_path / "manifest.json", {"version": 1, "cases": cases})
    resolved = {nct: resolve_demo_case(str(tmp_path / "manifest.json"), nct) for nct in NCTS}
    assert resolved["NCT07276724"].slug == resolved["NCT07359846"].slug
    with pytest.raises(DemoCaseError, match="not configured"):
        resolve_demo_case(str(tmp_path / "manifest.json"), "NCT00000000")


def test_capture_loaders_validate_and_return_aggregate_contracts(tmp_path):
    prop_path = tmp_path / "prop.json"
    ds_path = tmp_path / "ds.json"
    _write(prop_path, {
        "ncts": ["NCT06982521"], "shallow_n": 100, "full_n": 25,
        "by_payer": {"sus": 10, "private": 10, "unknown": 5},
        "by_site": [{"hospital": "site-a", "n": 25}], "as_of": "2026-07-12",
    })
    _write(ds_path, {
        "ncts": ["NCT06982521"],
        "by_uf": [{"uf": "SP", "base_cohort": 1000}],
    })
    tier2 = [Tier2Item(criterion="PIK3CA", tier=2, method="structured", confidence="high")]
    prop = load_proprietary_capture(str(prop_path), expected_nct="NCT06982521",
                                    tier2_items=tier2)
    datasus = load_datasus_capture(str(ds_path), expected_nct="NCT06982521")
    assert prop.n_total == 25
    assert prop.depth_ratios["sus_depth_ratio"] == 0.25
    assert prop.depth_ratios["shallow_n"] == 100
    assert prop.provenance["demo_case"] is True
    assert datasus.by_uf[0].base_cohort == 1000


def test_invalid_capture_never_silently_clamps_counts(tmp_path):
    path = tmp_path / "invalid.json"
    _write(path, {"ncts": ["NCT06982521"], "shallow_n": 10, "full_n": 11})
    with pytest.raises(DemoCaseError, match="full_n"):
        load_proprietary_capture(str(path), expected_nct="NCT06982521", tier2_items=[])


def test_pipeline_rejects_agent_changing_locked_nct(tmp_path, monkeypatch):
    from pipeline import orchestrator

    monkeypatch.setattr(orchestrator, "load_agent_ids", lambda: {
        "intake": "a", "proprietary": "b", "datasus_enrich": "c", "environment": "e",
    })
    monkeypatch.setattr(orchestrator, "run_agent", lambda *args, **kwargs: {
        "json": {"nct": "NCT06982521", "dx": {"cid_prefixes": ["C50"]}, "stages": []},
        "tool_results": {},
    })
    with pytest.raises(RuntimeError, match="changed locked NCT"):
        orchestrator.run_pipeline(
            "verified protocol", client=object(), nct="NCT06253871",
            parquet_glob=str(tmp_path / "unused.parquet"), datasus_dir=str(tmp_path),
        )
