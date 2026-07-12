"""Materialize the enriched PROSTATE aggregate — the asset's 2nd condition member.

Mirrors materialize_enriched_base.py (breast) for prostate: reads the persisted prostate
depth (scripts/extract_prostate_depth.py) + the real DataSUS C61 base, fits the joint depth
rate per (dx, age_band, sex) stratum, and standardizes to the DataSUS population. Same output
schema as the breast aggregate so the two are interchangeable members of the enriched asset.

Depth predicate (advanced/high-risk mCRPC-like): metastatic AND Gleason >= 8. Complete-case =
Gleason extracted. base_count OBSERVED (DataSUS), depth_rate/est_eligible IMPUTED (proprietary).

Run (from estimator/):
  TB_DATASUS_FULL_DIR='~/datasus omop mcp/data/raw' TB_CONCEPT_MAP=$PWD/concept-map.json \
  python scripts/materialize_enriched_prostate.py
"""
from __future__ import annotations

import json
import math
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import duckdb

from trialbridge.data import DuckDBDataSUS
from trialbridge.enrichment import EnrichmentModel
from trialbridge.registry import make_version
from trialbridge.stats import Z

REFERENCE_YEAR = 2025
SHRINK_ALPHA = 20.0
DX = "prostate_cancer"


def _age_band(age):
    if age is None or age < 18:
        return None
    return "18-39" if age <= 39 else "40-49" if age <= 49 else "50-59" if age <= 59 \
        else "60-69" if age <= 69 else "70+"


def _depth(p) -> bool:
    return bool(p["metastatic"]) and (p["gleason"] is not None and p["gleason"] >= 8)


def main() -> None:
    est_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ds_dir = os.path.expanduser(os.environ.get("TB_DATASUS_FULL_DIR", "~/datasus omop mcp/data/raw"))
    depth_pq = os.path.join(est_dir, "data/proprietary_prostate/depth.parquet")
    out_dir = os.path.join(est_dir, "data/enriched_base")
    os.makedirs(out_dir, exist_ok=True)

    con = duckdb.connect()
    con.execute("PRAGMA disable_progress_bar")
    rows = con.execute(f"SELECT site, birth_year, psa, gleason, metastatic "
                       f"FROM read_parquet('{depth_pq}')").fetchall()
    patients = []
    for site, birth_year, psa, gleason, metast in rows:
        if not birth_year:
            continue
        band = _age_band(REFERENCE_YEAR - birth_year)
        if band is None:
            continue
        patients.append({"dx": DX, "age_band": band, "sex": "M", "site": site,
                         "psa": psa, "gleason": gleason, "metastatic": bool(metast)})
    cc = [p for p in patients if p["gleason"] is not None]

    # DataSUS C61 base per (UF, age_band, sex=M) — exact, reuse the estimator's logic.
    datasus = DuckDBDataSUS(parquet_dir=ds_dir, dx_cid_prefixes={DX: ["C61"]})
    cells = defaultdict(int)
    for rec in datasus.records():
        if rec.dx == DX and rec.sex == "M":
            cells[(rec.region, rec.age_band)] += rec.count
    ufs = sorted({uf for uf, _ in cells})

    model = EnrichmentModel(cc, shrink_alpha=SHRINK_ALPHA)
    fitted = model.fit(_depth)
    mv = make_version(shrink_alpha=SHRINK_ALPHA, train_dx=[DX], valid_ufs=ufs,
                      trained_on="DataSUS OMOP C61 + proprietary NLP depth")

    out_rows = []
    nat_base = 0
    nat_est = nat_var = 0.0
    for (uf, band), base_count in sorted(cells.items()):
        rate = fitted.rate_for((DX, band, "M"))
        est = base_count * rate.p
        var = (base_count ** 2) * (rate.p * (1 - rate.p) / rate.n if rate.n > 0 else 0.0)
        half = Z * math.sqrt(var)
        out_rows.append({
            "uf": uf, "dx": DX, "age_band": band, "sex": "M",
            "base_count": base_count, "depth_rate": round(rate.p, 6),
            "depth_ci": [round(rate.lo, 6), round(rate.hi, 6)], "depth_eff_n": rate.raw_n,
            "est_eligible": round(est, 4),
            "est_ci": [round(max(0.0, est - half), 4), round(est + half, 4)],
        })
        nat_base += base_count
        nat_est += est
        nat_var += var

    provenance = {
        "as_of": os.environ.get("TB_AS_OF", "2026-07-12"), "asset": "prostate_enriched_aggregate",
        "grain": "uf x age_band x sex(M)", "dx": DX, "icd": "C61",
        "depth_predicate": "metastatic AND Gleason>=8 (advanced/high-risk)",
        "base": {"origin": "observed", "source": "DataSUS OMOP (C61)"},
        "depth": {"origin": "imputed", "source": "proprietary NLP->regex (PSA/Gleason/metastatic)",
                  "model_version": mv.version, "n_complete_case": len(cc),
                  "note": "NATIONAL depth rate applied per UF (direct standardization)"},
        "coverage_ufs": ufs, "n_cells": len(out_rows),
        "national": {"base_cohort": nat_base, "estimated_n": round(nat_est, 2),
                     "est_ci": [round(max(0.0, nat_est - Z * math.sqrt(nat_var)), 2),
                                round(nat_est + Z * math.sqrt(nat_var), 2)]},
    }
    with open(os.path.join(out_dir, "prostate_aggregate.json"), "w") as f:
        json.dump(out_rows, f, indent=1)
    with open(os.path.join(out_dir, "prostate_provenance.json"), "w") as f:
        json.dump(provenance, f, indent=2)

    print(f"wrote {len(out_rows)} cells -> {out_dir}/prostate_aggregate.json")
    print(f"prostate: base={nat_base:,}  Estimated N={nat_est:,.0f} "
          f"(95% CI {provenance['national']['est_ci'][0]:,.0f}-{provenance['national']['est_ci'][1]:,.0f})  "
          f"over {len(ufs)} UFs  (complete-case n={len(cc):,})")


if __name__ == "__main__":
    main()
