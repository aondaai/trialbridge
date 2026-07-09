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
from typing import List, Optional

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from pydantic import BaseModel

from trialbridge.data import DuckDBDataSUS, RealProprietary
from trialbridge.estimator import (
    estimate, national_total, rank_bottlenecks, observed_n_by_site,
    fill_speed, national_fill_speed,
)
from trialbridge.protocols import hero_protocol_real

FILL_SPEED_TARGET_N = 50  # a typical single-region Phase II cohort size — illustrative default

DATASUS_DIR = os.environ["TB_DATASUS_DIR"]
PROPRIETARY_GLOB = os.environ["TB_PROPRIETARY_GLOB"]

app = FastAPI(title="TrialBridge Feasibility API", version="0.1.0")

# Loaded once at import time — see module docstring. `datasus.records()` and
# `proprietary.patients()` are cheap (~1.6s / <1s locally) but re-running the DuckDB
# scan on every request would still add unnecessary latency to a live demo.
_datasus = DuckDBDataSUS(parquet_dir=DATASUS_DIR, dx_cid_prefixes={"breast_cancer": ["C50"]})
_proprietary_complete = RealProprietary(parquet_paths=[PROPRIETARY_GLOB], complete_cases_only=True)
_proprietary_all = RealProprietary(parquet_paths=[PROPRIETARY_GLOB], complete_cases_only=False)
_protocol = hero_protocol_real()


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


class SoftenRequest(BaseModel):
    exclude_depth_ids: Optional[List[str]] = None


def _run(exclude_depth_ids: Optional[List[str]]) -> FeasibilityResponse:
    exclude = set(exclude_depth_ids) if exclude_depth_ids else None
    ests = estimate(_protocol, _datasus, _proprietary_complete, exclude_depth_ids=exclude)
    nat, lo, hi = national_total(ests)
    base_total = sum(e.base_cohort for e in ests)

    observed = observed_n_by_site(_protocol, _proprietary_all, exclude_depth_ids=exclude)
    bottlenecks = rank_bottlenecks(_protocol, _datasus, _proprietary_complete)

    fspeed = fill_speed(_protocol, _datasus, _proprietary_complete, dx="breast_cancer",
                         target_n=FILL_SPEED_TARGET_N, exclude_depth_ids=exclude)
    nat_months = national_fill_speed(fspeed, target_n=FILL_SPEED_TARGET_N)

    return FeasibilityResponse(
        protocol_id=_protocol.protocol_id,
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
    )


_UI_PATH = Path(__file__).parent / "ui" / "index.html"


@app.get("/")
def ui():
    return FileResponse(_UI_PATH)


@app.get("/health")
def health():
    return {"status": "ok", "protocol_id": _protocol.protocol_id}


@app.get("/protocol")
def get_protocol():
    return {
        "protocol_id": _protocol.protocol_id,
        "checkable": [{"id": c.id, "text": c.text, "field": c.field} for c in _protocol.checkable()],
        "depth": [{"id": c.id, "text": c.text, "field": c.field} for c in _protocol.depth()],
    }


@app.post("/feasibility/estimate", response_model=FeasibilityResponse)
def feasibility_estimate():
    return _run(exclude_depth_ids=None)


@app.post("/soften", response_model=FeasibilityResponse)
def soften(req: SoftenRequest):
    return _run(exclude_depth_ids=req.exclude_depth_ids)
