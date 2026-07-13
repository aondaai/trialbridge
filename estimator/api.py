"""TrialBridge Feasibility API — thin FastAPI wrapper around the real estimator.

Loads the real DataSUS base cohort and real proprietary depth data ONCE at startup
(both take low single-digit seconds against the local mirrors — see README), then
serves requests against the in-memory records. Nothing here recomputes the NLP
extraction or re-downloads anything; it's a read layer over what demo_real.py
already proved works.

Run:
  <scratch>/venv/bin/uvicorn api:app --reload --port 8420 \
      --app-dir . \
      --env-file /dev/null
  (DATASUS_DIR and PROPRIETARY_GLOB below are read from argv/env — see bottom of file)

Endpoints:
  GET  /health
  GET  /protocol                    -> the hero protocol's criteria (checkable + depth)
  POST /feasibility/estimate        -> {national, by_region[], observed_by_site[], bottlenecks[]}
  POST /soften                      -> same shape, with one or more depth criteria excluded
"""
from __future__ import annotations

import os
from typing import Any, List, Literal, Optional

from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from trialbridge.data import MaterializedDataSUS, MaterializedProprietary, RealProprietary
from trialbridge.estimator import (
    estimate, national_total, rank_bottlenecks, observed_n_by_site,
    fill_speed, national_fill_speed,
)
from trialbridge.protocols import hero_protocol_real
from trialbridge.auth import require_token
# Governance backbone — the /query layer routes through these (guardrail, coverage, registry).
from trialbridge.query import route, Intent, FindingOverImputedError
from trialbridge.coverage import CalibratedCoverage, CALIBRATED_UFS_14
from trialbridge.registry import make_version
from trialbridge.finding import finding_n_by_site
from trialbridge.schema import Criterion, Protocol
from pipeline.cma_service import CmaRunService
from pipeline.jobs import CmaJobStore, CmaRunRequest, CmaRunView

FILL_SPEED_TARGET_N = 50  # a typical single-region Phase II cohort size — illustrative default

# Asset 3 (materialized DataSUS base cohort) — small, reconstructible from the
# 163GB export by scripts/materialize_datasus.py. Read this instead of scanning
# live: national breast cohort ~394k, so the Estimated N is real (not 0 on a sample).
DATASUS_BASE_DIR = os.environ.get("TB_DATASUS_BASE_DIR", "data/datasus_base")
PROPRIETARY_GLOB = os.environ["TB_PROPRIETARY_GLOB"]

# docs_url/redoc_url/openapi_url disabled: once the access gate is on, leaving the
# auto-generated Swagger/OpenAPI schema public would disclose the full API surface to
# unauthenticated callers. Closed here rather than separately gated.
app = FastAPI(title="TrialBridge Feasibility API", version="0.2.0",
              docs_url=None, redoc_url=None, openapi_url=None)

# ---- access gate --------------------------------------------------------------
# Optional shared-secret bearer auth (see trialbridge/auth.py). Data endpoints carry
# `dependencies=_gated`; /health is left open so Render's health check keeps passing.
# The gate activates only when TB_ESTIMATOR_TOKEN is set on the service — the web app
# (src/lib/estimator/client.ts) sends the same token from its own TB_ESTIMATOR_TOKEN,
# so enabling it is a zero-downtime two-step (ship code, then set the env var on both).
_gated = [Depends(require_token)]

_cma_store = CmaJobStore(os.environ.get("TB_CMA_JOBS_DB", "/tmp/trialbridge-cma-jobs.sqlite3"))
_cma_service = CmaRunService(_cma_store, max_workers=int(os.environ.get("TB_CMA_WORKERS", "1")))


@app.on_event("startup")
def recover_cma_jobs() -> None:
    _cma_service.recover()

# Loaded once at import time. DataSUS side = Asset 3 (materialized aggregate);
# proprietary side = Asset 2 (row-level depth, backs Observed N).
_datasus = MaterializedDataSUS(base_dir=DATASUS_BASE_DIR)
_proprietary_complete = RealProprietary(parquet_paths=[PROPRIETARY_GLOB], complete_cases_only=True)
_proprietary_all = RealProprietary(parquet_paths=[PROPRIETARY_GLOB], complete_cases_only=False)
_protocol = hero_protocol_real()

# Full-base finding adapter (materialized from the 6.68M proprietary base; MaterializedProprietary
# exposes .records() so finding_n_by_site works without the 58GB in the image).
PROP_BASE_DIR = os.environ.get("TB_PROPRIETARY_BASE_DIR", "data/proprietary_base")
_prop_finding = MaterializedProprietary(base_dir=PROP_BASE_DIR)

# Calibrated coverage (data-driven from the materialized base's provenance) + a versioned
# model id — the governance stamped on every counted (imputed) number.
_coverage = CalibratedCoverage(
    ufs=frozenset(_datasus.provenance.get("coverage_ufs") or CALIBRATED_UFS_14)
)
_model_version = make_version(
    shrink_alpha=20.0, train_dx=["breast_cancer"], valid_ufs=list(_coverage.ufs),
    trained_on=_datasus.provenance.get("source", "materialized"),
).version


class RegionEstimate(BaseModel):
    region: str
    base_cohort: int
    est_eligible: float
    ci_lo: float
    ci_hi: float


class ObservedSiteOut(BaseModel):
    site: str
    n_patients: int
    observed_n: int


class FindingSiteOut(BaseModel):
    site: str
    with_dx: int
    finding_n: int


class BottleneckOut(BaseModel):
    criterion_id: str
    text: str
    gain: float


class FillSpeedOut(BaseModel):
    region: str
    monthly_incidence: float
    monthly_eligible: float
    months_to_fill: Optional[float]


class FeasibilityResponse(BaseModel):
    protocol_id: str
    national_estimated_n: float
    national_ci_lo: float
    national_ci_hi: float
    national_base_cohort: int
    by_region: List[RegionEstimate]
    observed_by_site: List[ObservedSiteOut]
    bottlenecks: List[BottleneckOut]
    excluded_criteria: List[str]
    fill_speed_target_n: int
    fill_speed_by_region: List[FillSpeedOut]
    national_months_to_fill: Optional[float]
    # Provenance for the DataSUS (Asset 3) side of the estimate.
    datasus_source: str
    datasus_as_of: Optional[str] = None
    coverage_ufs: List[str] = []
    # Aggregate-only finding layer over the full 6.68M proprietary base.
    proprietary_finding_total: int
    proprietary_finding_by_site: List[FindingSiteOut]
    proprietary_finding_source: str
    proprietary_finding_as_of: Optional[str] = None


class SoftenRequest(BaseModel):
    exclude_depth_ids: Optional[List[str]] = None


class ProtocolCriterionIn(BaseModel):
    id: str
    text: str
    type: Literal["inclusion", "exclusion"]
    kind: Literal["checkable", "depth"]
    field: str
    op: Literal["in", "eq", "lte", "gte", "between", "is_true", "is_false"]
    value: Any = None
    assertion: Literal["PRESENT", "ABSENT"] = "PRESENT"


class ProtocolIn(BaseModel):
    protocol_id: str
    criteria: List[ProtocolCriterionIn]


class EstimateRequest(BaseModel):
    protocol: Optional[ProtocolIn] = None


def _protocol_from_request(data: ProtocolIn) -> Protocol:
    allowed = {
        "checkable": {"dx", "age_band", "sex"},
        "depth": {"her2", "ecog", "metastatic", "stage", "prior_lines", "autoimmune"},
    }
    criteria = []
    for c in data.criteria:
        if c.field not in allowed[c.kind]:
            raise ValueError(f"field {c.field!r} is not available for {c.kind}")
        criteria.append(Criterion(c.id, c.text, c.type, c.kind, c.field, c.op,
                                   c.value, c.assertion))
    if not criteria:
        raise ValueError("protocol must contain at least one supported criterion")
    return Protocol(protocol_id=data.protocol_id, criteria=criteria)


# ---- semantic query layer: count (Asset 3) vs find (Asset 2) ----------------

class Provenance(BaseModel):
    """Every number the query layer returns is stamped with where it came from,
    so 'observed' (localizable, Asset 2) and 'estimated' (imputed, Asset 3) are
    never confused. See the data strategy: contar != encontrar."""
    origin: str            # "observed" | "estimated"
    asset: str             # "proprietary_pure" | "datasus_enriched"
    confidence: str        # human label
    source: str
    as_of: Optional[str] = None
    coverage_ufs: Optional[List[str]] = None   # count only
    ci: Optional[List[float]] = None           # [lo, hi], count only
    sites_with_data: Optional[int] = None      # find only
    model_version: Optional[str] = None        # count only — which versioned model produced it
    note: str


class QueryRequest(BaseModel):
    # "count" -> how many exist in the market (Asset 3, estimated, with CI).
    # "find"  -> how many are localizable now (Asset 2, observed). Never touches Asset 3.
    intent: str


class QueryResponse(BaseModel):
    intent: str
    protocol_id: str
    value: float
    provenance: Provenance


def _run(exclude_depth_ids: Optional[List[str]], protocol: Optional[Protocol] = None) -> FeasibilityResponse:
    active_protocol = protocol or _protocol
    exclude = set(exclude_depth_ids) if exclude_depth_ids else None
    ests = estimate(active_protocol, _datasus, _proprietary_complete, exclude_depth_ids=exclude)
    nat, lo, hi = national_total(ests)
    base_total = sum(e.base_cohort for e in ests)

    observed = observed_n_by_site(active_protocol, _proprietary_all, exclude_depth_ids=exclude)
    bottlenecks = rank_bottlenecks(active_protocol, _datasus, _proprietary_complete)
    findings = finding_n_by_site(active_protocol, _prop_finding)

    dx_criterion = next((c for c in active_protocol.checkable() if c.field == "dx"), None)
    dx_value = dx_criterion.value[0] if dx_criterion and isinstance(dx_criterion.value, list) else "breast_cancer"
    fspeed = fill_speed(active_protocol, _datasus, _proprietary_complete, dx=dx_value,
                         target_n=FILL_SPEED_TARGET_N, exclude_depth_ids=exclude)
    nat_months = national_fill_speed(fspeed, target_n=FILL_SPEED_TARGET_N)

    return FeasibilityResponse(
        protocol_id=active_protocol.protocol_id,
        national_estimated_n=nat,
        national_ci_lo=lo,
        national_ci_hi=hi,
        national_base_cohort=base_total,
        by_region=[
            RegionEstimate(region=e.region, base_cohort=e.base_cohort,
                            est_eligible=e.est_eligible, ci_lo=e.ci_lo, ci_hi=e.ci_hi)
            for e in ests
        ],
        observed_by_site=[
            ObservedSiteOut(site=s.site, n_patients=s.n_patients, observed_n=s.observed_n)
            for s in observed
        ],
        bottlenecks=[
            BottleneckOut(criterion_id=b.criterion_id, text=b.text, gain=b.gain)
            for b in bottlenecks
        ],
        excluded_criteria=sorted(exclude) if exclude else [],
        fill_speed_target_n=FILL_SPEED_TARGET_N,
        fill_speed_by_region=[
            FillSpeedOut(region=f.region, monthly_incidence=f.monthly_incidence,
                         monthly_eligible=f.monthly_eligible, months_to_fill=f.months_to_fill)
            for f in fspeed
        ],
        national_months_to_fill=nat_months,
        datasus_source=_datasus.provenance.get("source", "DataSUS (materialized)"),
        datasus_as_of=_datasus.provenance.get("as_of"),
        coverage_ufs=_datasus.provenance.get("coverage_ufs", []),
        proprietary_finding_total=sum(s.finding_n for s in findings),
        proprietary_finding_by_site=[
            FindingSiteOut(site=s.site, with_dx=s.with_dx, finding_n=s.finding_n)
            for s in findings if s.finding_n >= 5
        ],
        proprietary_finding_source=_prop_finding.provenance.get("source", "materialized 6.68M proprietary base"),
        proprietary_finding_as_of=_prop_finding.provenance.get("as_of"),
    )


# Honest coverage label: `coverage_ufs` today is every UF present in the DataSUS base
# (all 27), NOT a calibration-validated subset — so `covered_only` gates nothing yet. We
# say so plainly rather than claiming a gate that isn't real. A true calibrated gate
# (CalibratedCoverage.from_model over a holdout report) is Trilha B; until then the note
# must not imply the number is validated coverage.
_COVERAGE_IS_CALIBRATED = False  # flip to True once a real calibration/holdout report drives _coverage


def _imputed_response(intent_str: str, res, note: str,
                      confidence: str = "estimated (imputed, with CI)") -> QueryResponse:
    """Map a route() imputed result (Estimated N / findability) to the response shape."""
    pv = res.provenance
    return QueryResponse(
        intent=intent_str, protocol_id=_protocol.protocol_id,
        value=float(res.value) if res.value is not None else 0.0,
        provenance=Provenance(
            origin="estimated", asset="datasus_enriched", confidence=confidence,
            source=_datasus.provenance.get("source", "DataSUS (materialized)"),
            as_of=_datasus.provenance.get("as_of"),
            coverage_ufs=sorted(_coverage.ufs),
            ci=(list(pv.ci) if pv.ci else None),
            model_version=pv.model_version, note=note,
        ),
    )


def _observed_response(intent_str: str, res, sites, note: str, confidence: str,
                       asset: str = "proprietary_pure",
                       source: str = "Proprietary NLP->OMOP depth") -> QueryResponse:
    """Map a route() observed result (FIND / prevalence) to the response shape."""
    return QueryResponse(
        intent=intent_str, protocol_id=_protocol.protocol_id,
        value=float(res.value) if res.value is not None else 0.0,
        provenance=Provenance(
            origin="observed", asset=asset, confidence=confidence,
            source=source, sites_with_data=sites, note=note,
        ),
    )


_UI_PATH = Path(__file__).parent / "ui" / "index.html"


@app.get("/", dependencies=_gated)
def ui():
    return FileResponse(_UI_PATH)


@app.get("/health")
def health():
    return {"status": "ok", "protocol_id": _protocol.protocol_id}


@app.post("/cma/runs", response_model=CmaRunView, status_code=status.HTTP_202_ACCEPTED,
          dependencies=_gated)
def create_cma_run(payload: CmaRunRequest, retry_failed: bool = False):
    record, _ = _cma_service.start(payload, retry_failed=retry_failed)
    return record


@app.get("/cma/runs/{run_id}", response_model=CmaRunView, dependencies=_gated)
def get_cma_run(run_id: str):
    record = _cma_store.get(run_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CMA run not found")
    return record


@app.get("/protocol", dependencies=_gated)
def get_protocol():
    return {
        "protocol_id": _protocol.protocol_id,
        "checkable": [{"id": c.id, "text": c.text, "field": c.field} for c in _protocol.checkable()],
        "depth": [{"id": c.id, "text": c.text, "field": c.field} for c in _protocol.depth()],
    }


@app.post("/feasibility/estimate", response_model=FeasibilityResponse, dependencies=_gated)
def feasibility_estimate(req: EstimateRequest = EstimateRequest()):
    try:
        protocol = _protocol_from_request(req.protocol) if req.protocol else None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _run(exclude_depth_ids=None, protocol=protocol)


@app.post("/soften", response_model=FeasibilityResponse, dependencies=_gated)
def soften(req: SoftenRequest):
    return _run(exclude_depth_ids=req.exclude_depth_ids)


@app.post("/query", response_model=QueryResponse, dependencies=_gated)
def query(req: QueryRequest):
    """Semantic layer routed through trialbridge.query.route() — governance LIVE:
    FIND is structurally barred from the imputed pathway (guardrail), Estimated N is
    coverage-gated + model-versioned, every number carries provenance. Intents:
    count | find | prevalence | findability | feasibility."""
    intent = (req.intent or "").strip().lower()
    try:
        if intent in ("count", "market_size"):
            res = route(Intent.MARKET_SIZE, protocol=_protocol, proprietary=_proprietary_complete,
                        datasus=_datasus, coverage=_coverage, model_version=_model_version)
            gate = ("coverage-gated to a calibrated subset" if _COVERAGE_IS_CALIBRATED
                    else f"over all {len(_coverage.ufs)} UFs present in the base — coverage NOT yet "
                         "calibration-validated (placeholder)")
            return _imputed_response(
                "count", res, confidence="estimated (with CI)",
                note=f"Standardized Estimated N {gate}, model-versioned. Counting, not finding — "
                     "not individually localizable patients.")
        if intent == "find":
            res = route(Intent.FIND, protocol=_protocol, proprietary=_proprietary_all)
            sites = len(observed_n_by_site(_protocol, _proprietary_all))
            return _observed_response(
                "find", res, sites, confidence="observed (row-level, localizable)",
                note="Direct count over real proprietary patients passing the full protocol. Finding, "
                     "not counting — each is a real, localizable record. The imputed Asset 3 is "
                     "STRUCTURALLY unreachable here (route() guardrail), not merely avoided by convention.")
        if intent == "prevalence":
            res = route(Intent.PREVALENCE, protocol=_protocol, proprietary=_proprietary_complete,
                        datasus=_datasus)
            return _observed_response(
                "prevalence", res, None, asset="datasus_pure",
                source=_datasus.provenance.get("source", "DataSUS (materialized)"),
                confidence="observed (aggregate denominator, exact — not localizable rows)",
                note="DataSUS national denominator after the protocol's checkable criteria. An exact "
                     "population aggregate, not individually localizable patients.")
        if intent == "findability":
            res = route(Intent.FINDABILITY, protocol=_protocol, proprietary=_proprietary_complete,
                        datasus=_datasus, coverage=_coverage, model_version=_model_version,
                        observed_proprietary=_proprietary_all)
            return _imputed_response(
                "findability", res, confidence="ratio (observed / estimated)",
                note="Observed N (localizable, Asset 2) divided by Estimated N (imputed market, Asset 3). "
                     "A RATE in [0,1], not a headcount — the fraction of the addressable market localizable "
                     "today. Inherits the model's uncertainty via the denominator.")
        if intent == "feasibility":
            sites = finding_n_by_site(_protocol, _prop_finding)  # FullProprietary via materialized adapter
            total = sum(s.finding_n for s in sites)
            return QueryResponse(
                intent="feasibility", protocol_id=_protocol.protocol_id, value=float(total),
                provenance=Provenance(
                    origin="observed", asset="proprietary_pure",
                    confidence="observed finding (checkable-level, site feasibility)",
                    source=_prop_finding.provenance.get("source", "proprietary finding base"),
                    as_of=_prop_finding.provenance.get("as_of"),
                    sites_with_data=len(sites),
                    note="Real breast-cancer patients matching demographics per site, over the full "
                         "6.68M proprietary base. Finding, not counting — localizable records.",
                ),
            )
    except FindingOverImputedError as e:
        raise HTTPException(status_code=400, detail=f"golden rule violated: {e}")
    raise HTTPException(status_code=400,
                        detail="intent must be count|find|prevalence|findability|feasibility")
