"""Application service for durable CMA jobs and sponsor-facing result adaptation."""
from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor

from .jobs import CmaJobStore, CmaRunRequest
from .orchestrator import run_pipeline
from .schemas import FeasibilityPack, SearchSpec
from .demo_cases import resolve_demo_case
from .handlers.elasticsearch_proprietary import search_reviewed_plan_elasticsearch
from .handlers.datasus import query_datasus, query_materialized_datasus, build_pack


def run_status_for_pack(pack: FeasibilityPack) -> str:
    """A result is partial whenever the data adapter could not apply criteria."""
    proprietary = (pack.provenance or {}).get("proprietary") or {}
    ignored = proprietary.get("ignored_criteria", []) if isinstance(proprietary, dict) else []
    estimation = (pack.provenance or {}).get("estimation") or {}
    no_eligibility_fraction = estimation.get("eligibility_fraction_applied") is False
    return "partial" if ignored or no_eligibility_fraction else "complete"


def pack_to_national_estimate(pack: FeasibilityPack, consultation_id: str) -> dict:
    """Keep the existing Next.js NationalEstimate wire contract without inventing data."""
    national = pack.national
    provenance = pack.provenance or {}
    private = pack.private_population_signal or {}
    datasus_provenance = provenance.get("datasus") or {}
    estimation = provenance.get("estimation") or {}
    if not isinstance(datasus_provenance, dict):
        datasus_provenance = {"source": str(datasus_provenance)}
    return {
        "protocol_id": consultation_id,
        "national_estimated_n": float(national.get("est_eligible", 0)),
        "national_ci_lo": float(national.get("ci_lo", 0)),
        "national_ci_hi": float(national.get("ci_hi", 0)),
        "national_base_cohort": sum(item.base_cohort for item in pack.per_uf_eligible),
        "by_region": [
            {
                "region": item.uf,
                "base_cohort": item.base_cohort,
                "est_eligible": item.est_eligible,
                "ci_lo": item.ci_lo,
                "ci_hi": item.ci_hi,
            }
            for item in pack.per_uf_eligible
        ],
        "national_months_to_fill": None,
        "observed_by_site": [],
        "bottlenecks": [],
        "fill_speed_by_region": [],
        "datasus_source": datasus_provenance.get("source", provenance.get("source", "DataSUS/OMOP")),
        "datasus_as_of": datasus_provenance.get("as_of", provenance.get("as_of")),
        "proprietary_finding_total": int(private.get("n", 0)),
        "proprietary_finding_by_site": [],
        "proprietary_finding_source": private.get("note", "aggregate proprietary signal"),
        "proprietary_finding_as_of": provenance.get("as_of"),
        "coverage_caveat": pack.coverage_caveat,
        "estimate_kind": estimation.get("kind", "eligible_estimate"),
        "eligibility_fraction_applied": estimation.get("eligibility_fraction_applied", True),
        "eligibility_fraction": estimation.get("eligibility_fraction"),
        "cma_nct": pack.nct,
    }


class CmaRunService:
    def __init__(self, store: CmaJobStore, *, max_workers: int = 1):
        self.store = store
        self.executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="cma-run")

    def start(self, request: CmaRunRequest, *, retry_failed: bool = False):
        record, created = self.store.create_or_get(request)
        if not created and retry_failed and record.status == "failed":
            self.store.requeue_failed(record.id)
            record = self.store.get(record.id) or record
        if created or record.status == "queued":
            self.executor.submit(self._execute, record.id)
        return record, created

    def recover(self) -> None:
        for run_id in self.store.recover_interrupted():
            self.executor.submit(self._execute, run_id)

    def _execute(self, run_id: str) -> None:
        if not self.store.claim(run_id):
            return
        record = self.store.get(run_id)
        if record is None:
            return
        try:
            execution_mode = os.environ.get("TB_CMA_EXECUTION_MODE", "managed").lower()
            if execution_mode == "local":
                if not record.request.elasticsearch_plan:
                    raise ValueError("local CMA execution requires a sponsor-reviewed Elasticsearch plan")
                elasticsearch_url = os.environ["TB_ELASTICSEARCH_URL"]
                elasticsearch_index = os.environ["TB_ELASTICSEARCH_INDEX"]
                datasus_base_dir = os.environ["TB_DATASUS_BASE_DIR"]
                local_spec = SearchSpec(
                    nct=record.request.nct,
                    dx=record.request.dx,
                    stages=[],
                )
                self.store.update(run_id, "proprietary_running")
                proprietary = search_reviewed_plan_elasticsearch(
                    record.request.elasticsearch_plan,
                    nct=record.request.nct,
                    url=elasticsearch_url,
                    index=elasticsearch_index,
                )
                self.store.update(run_id, "datasus_running")
                datasus = query_materialized_datasus(local_spec, base_dir=datasus_base_dir)
                pack = build_pack(local_spec, datasus, proprietary, depth_ratio=None)
                result = pack_to_national_estimate(pack, record.request.consultation_id)
                self.store.update(run_id, run_status_for_pack(pack), result=result)
                return
            if execution_mode != "managed":
                raise ValueError(f"unsupported CMA execution mode: {execution_mode!r}")
            proprietary_backend = os.environ.get("TB_PROPRIETARY_SEARCH_BACKEND", "duckdb").lower()
            parquet_glob = None
            if proprietary_backend == "duckdb":
                parquet_glob = (os.environ.get("TB_FULL_PROPRIETARY_GLOB") or
                                os.environ["TB_PROPRIETARY_GLOB"])
            datasus_dir = os.environ["TB_DATASUS_DIR"]
            proprietary_capture = None
            proprietary_inventory = None
            datasus_capture = None
            demo_manifest = os.environ.get("TB_DEMO_CASES_MANIFEST")
            if demo_manifest:
                sources = resolve_demo_case(demo_manifest, record.request.nct)
                if sources.proprietary_type == "parquet":
                    parquet_glob = sources.proprietary_path
                elif sources.proprietary_type == "capture":
                    proprietary_capture = sources.proprietary_path
                else:
                    proprietary_inventory = sources.proprietary_path
                datasus_capture = sources.datasus_capture_path
            pack = run_pipeline(
                record.request.protocol_text,
                nct=record.request.nct,
                verified_criteria=record.request.verified_criteria,
                proprietary_backend=proprietary_backend,
                elasticsearch_url=os.environ.get("TB_ELASTICSEARCH_URL"),
                elasticsearch_index=os.environ.get("TB_ELASTICSEARCH_INDEX"),
                parquet_glob=parquet_glob,
                datasus_dir=datasus_dir,
                proprietary_capture=proprietary_capture,
                proprietary_inventory=proprietary_inventory,
                datasus_capture=datasus_capture,
                progress=lambda stage: self.store.update(run_id, stage),
            )
            result = pack_to_national_estimate(pack, record.request.consultation_id)
            self.store.update(run_id, run_status_for_pack(pack), result=result)
        except Exception as exc:
            self.store.update(run_id, "failed", error=f"{type(exc).__name__}: {exc}")
