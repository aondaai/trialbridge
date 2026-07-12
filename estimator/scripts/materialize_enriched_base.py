"""Materialize the ENRICHED DataSUS base — a new asset (proposed 2026-07-11).

The DataSUS base (Asset 3) is a real national demographic/geographic skeleton but has NO
depth (HER2/ECOG/metastatic). The proprietary base (Asset 2) has depth but is not
population-representative. This asset fuses them: the DataSUS UF x stratum skeleton with
the proprietary-learned depth distribution imputed onto each cell — i.e. the estimator's
transfer, materialized as a reusable dataset.

Honesty by construction: `base_count` is OBSERVED (DataSUS); `depth_rate` / `est_eligible`
are IMPUTED (proprietary model), model-versioned, with a CI. The two are never merged into
one undifferentiated number. Depth today is the NATIONAL rate applied per UF (direct
standardization) — per-UF calibrated depth is Trilha B step 3.

This writes the AGGREGATE grain (per UF x dx x age_band x sex). The person-level synthetic
cohort (scripts/materialize_enriched_persons.py) samples from these same cells, and
scripts/compare_enriched_grains.py checks the two agree (fidelity) + what each enables.

Run (from estimator/):
  TB_CONCEPT_MAP=$PWD/concept-map.json python scripts/materialize_enriched_base.py
"""
from __future__ import annotations

import glob
import json
import math
import os
import sys
from collections import defaultdict
from typing import Dict, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trialbridge.data import MaterializedDataSUS, RealProprietary  # noqa: E402
from trialbridge.enrichment import EnrichmentModel  # noqa: E402
from trialbridge.protocols import hero_protocol_real  # noqa: E402
from trialbridge.registry import make_version  # noqa: E402
from trialbridge.stats import Z  # noqa: E402

SHRINK_ALPHA = 20.0
Stratum = Tuple[str, str, str]  # (dx, age_band, sex)


def main() -> None:
    est_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    base_dir = os.environ.get("TB_DATASUS_BASE_DIR", os.path.join(est_dir, "data/datasus_base"))
    prop_glob = os.environ.get("TB_PROPRIETARY_GLOB",
                               os.path.join(est_dir, "data/proprietary_ha/*.parquet"))
    out_dir = os.path.join(est_dir, "data/enriched_base")
    os.makedirs(out_dir, exist_ok=True)

    protocol = hero_protocol_real()
    datasus = MaterializedDataSUS(base_dir=base_dir)
    prop_paths = sorted(glob.glob(prop_glob)) or [prop_glob]
    proprietary = RealProprietary(parquet_paths=prop_paths, complete_cases_only=True)

    # Fit the joint depth rate per stratum (P(all depth criteria | dx, age, sex)).
    model = EnrichmentModel(proprietary.patients(), shrink_alpha=SHRINK_ALPHA)
    fitted = model.fit(protocol.depth_predicate())

    ufs = sorted({r.region for r in datasus.records()})
    mv = make_version(shrink_alpha=SHRINK_ALPHA, train_dx=["breast_cancer"],
                      valid_ufs=ufs, trained_on=datasus.provenance.get("source", "materialized"))

    # Aggregate: collapse base records to (UF, dx, age_band, sex) cells, attach depth.
    # Apply the protocol's CHECKABLE criteria (dx, sex) first so the asset reconciles with
    # the estimator's national count (base cohort = after checkable) rather than counting,
    # e.g., male breast cancer that the protocol excludes.
    checkable = protocol.checkable()
    cells: Dict[Tuple[str, str, str, str], int] = defaultdict(int)
    for r in datasus.records():
        rec = {"dx": r.dx, "age_band": r.age_band, "sex": r.sex}
        if all(c.test(rec) for c in checkable):
            cells[(r.region, r.dx, r.age_band, r.sex)] += r.count

    rows = []
    nat_base = 0
    nat_est = 0.0
    nat_var = 0.0
    for (uf, dx, age, sex), base_count in sorted(cells.items()):
        rate = fitted.rate_for((dx, age, sex))
        est = base_count * rate.p
        # variance of count*p with p estimated on eff sample n (base treated as fixed)
        var = (base_count ** 2) * (rate.p * (1 - rate.p) / rate.n if rate.n > 0 else 0.0)
        half = Z * math.sqrt(var)
        rows.append({
            "uf": uf, "dx": dx, "age_band": age, "sex": sex,
            "base_count": base_count,              # OBSERVED (DataSUS)
            "depth_rate": round(rate.p, 6),        # IMPUTED (proprietary model)
            "depth_ci": [round(rate.lo, 6), round(rate.hi, 6)],
            "depth_eff_n": rate.raw_n,             # proprietary sample backing the rate
            "est_eligible": round(est, 4),         # IMPUTED = base_count * depth_rate
            "est_ci": [round(max(0.0, est - half), 4), round(est + half, 4)],
        })
        if dx == "breast_cancer":
            nat_base += base_count
            nat_est += est
            nat_var += var

    provenance = {
        "as_of": datasus.provenance.get("as_of"),
        "asset": "datasus_enriched_aggregate",
        "grain": "uf x dx x age_band x sex",
        "base": {"origin": "observed", "source": datasus.provenance.get("source"),
                 "note": "DataSUS national base cohort counts (real)"},
        "depth": {"origin": "imputed", "source": "proprietary NLP->OMOP depth (complete-case)",
                  "model_version": mv.version, "shrink_alpha": SHRINK_ALPHA,
                  "convenio_filter": "all-comers (SUS + private) — SUS-only variant pending re-extraction",
                  "note": "NATIONAL depth rate applied per UF (direct standardization); "
                          "per-UF calibrated depth is Trilha B step 3"},
        "coverage_ufs": ufs,
        "n_cells": len(rows),
        "national_breast": {
            "base_cohort": nat_base,
            "estimated_n": round(nat_est, 2),
            "est_ci": [round(max(0.0, nat_est - Z * math.sqrt(nat_var)), 2),
                       round(nat_est + Z * math.sqrt(nat_var), 2)],
        },
    }

    with open(os.path.join(out_dir, "aggregate.json"), "w") as f:
        json.dump(rows, f, indent=1)
    with open(os.path.join(out_dir, "provenance.json"), "w") as f:
        json.dump(provenance, f, indent=2)

    print(f"wrote {len(rows)} cells -> {out_dir}/aggregate.json")
    print(f"national breast: base={nat_base:,}  Estimated N={nat_est:,.0f} "
          f"(95% CI {provenance['national_breast']['est_ci'][0]:,.0f}"
          f"-{provenance['national_breast']['est_ci'][1]:,.0f})  over {len(ufs)} UFs")
    print("sample cells:")
    for row in rows[:4]:
        print(f"  {row['uf']} {row['dx']} {row['age_band']} {row['sex']}: "
              f"base={row['base_count']} depth={row['depth_rate']:.3f} est={row['est_eligible']:.1f}")


if __name__ == "__main__":
    main()
