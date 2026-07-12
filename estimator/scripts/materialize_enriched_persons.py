"""Materialize the ENRICHED base at PERSON-LEVEL (synthetic cohort) — the second grain.

Same fusion as materialize_enriched_base.py (aggregate), but instead of a rate per cell it
expands each DataSUS (UF x stratum) cell into `base_count` synthetic patients. Each patient's
depth attributes (her2, ecog, metastatic, autoimmune) are sampled by drawing a REAL
proprietary patient from the same stratum and copying their depth tuple — which preserves the
JOINT distribution (the correlation between criteria), not just the marginals. Strata with no
proprietary patients fall back to the dx-level pool.

Provenance: the demographic skeleton (uf, age_band, sex) is OBSERVED-derived (DataSUS); the
depth tuple is IMPUTED (sampled from the proprietary model). Every synthetic row is flagged
`imputed_depth=true` so it is never mistaken for a real localizable patient.

Why both grains: the aggregate is compact and is what the estimator consumes; the person-level
is larger but answers arbitrary sub-criteria/subgroup queries and propagates uncertainty via
Monte Carlo. compare_enriched_grains.py checks they agree (fidelity) and shows what each adds.

Deterministic: fixed RNG seed, so re-runs are identical (matches the repo's timestamp-free rule).
Output is large -> written to data/enriched_base/persons.parquet (gitignored), not the repo.

Run (from estimator/):
  TB_CONCEPT_MAP=$PWD/concept-map.json python scripts/materialize_enriched_persons.py
"""
from __future__ import annotations

import glob
import json
import os
import random
import sys
from collections import defaultdict
from typing import Dict, List, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import duckdb  # noqa: E402

from trialbridge.data import MaterializedDataSUS, RealProprietary  # noqa: E402
from trialbridge.protocols import hero_protocol_real  # noqa: E402

SEED = 7
Stratum = Tuple[str, str, str]


def main() -> None:
    est_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    base_dir = os.environ.get("TB_DATASUS_BASE_DIR", os.path.join(est_dir, "data/datasus_base"))
    prop_glob = os.environ.get("TB_PROPRIETARY_GLOB",
                               os.path.join(est_dir, "data/proprietary_ha/*.parquet"))
    out_dir = os.path.join(est_dir, "data/enriched_base")
    os.makedirs(out_dir, exist_ok=True)

    protocol = hero_protocol_real()
    predicate = protocol.depth_predicate()
    checkable = protocol.checkable()
    datasus = MaterializedDataSUS(base_dir=base_dir)
    prop_paths = sorted(glob.glob(prop_glob)) or [prop_glob]
    patients = RealProprietary(parquet_paths=prop_paths, complete_cases_only=True).patients()

    # Group proprietary depth tuples by stratum + a dx-level pool for fallback.
    by_stratum: Dict[Stratum, List[dict]] = defaultdict(list)
    by_dx: Dict[str, List[dict]] = defaultdict(list)
    depth_keys = ("her2", "ecog", "metastatic", "autoimmune")
    for p in patients:
        tup = {k: p[k] for k in depth_keys}
        s = (p["dx"], p["age_band"], p["sex"])
        by_stratum[s].append(tup)
        by_dx[p["dx"]].append(tup)

    rng = random.Random(SEED)
    jsonl_path = os.path.join(out_dir, "persons.jsonl")
    n_written = 0
    n_fallback = 0
    with open(jsonl_path, "w") as out:
        for r in datasus.records():
            rec = {"dx": r.dx, "age_band": r.age_band, "sex": r.sex}
            if not all(c.test(rec) for c in checkable):
                continue
            pool = by_stratum.get((r.dx, r.age_band, r.sex)) or by_dx.get(r.dx)
            if not pool:
                continue
            fallback = (r.dx, r.age_band, r.sex) not in by_stratum
            for _ in range(r.count):
                tup = pool[rng.randrange(len(pool))]
                row = {"uf": r.region, "dx": r.dx, "age_band": r.age_band, "sex": r.sex,
                       **tup, "passes_depth": bool(predicate({**rec, **tup})),
                       "imputed_depth": True, "stratum_fallback": fallback}
                out.write(json.dumps(row) + "\n")
                n_written += 1
                if fallback:
                    n_fallback += 1

    # Convert to parquet (compact) and drop the JSONL.
    pq_path = os.path.join(out_dir, "persons.parquet")
    con = duckdb.connect()
    con.execute("PRAGMA disable_progress_bar")
    con.execute(f"COPY (SELECT * FROM read_json_auto('{jsonl_path}')) "
                f"TO '{pq_path}' (FORMAT PARQUET)")
    os.remove(jsonl_path)

    prov = {
        "asset": "datasus_enriched_persons", "grain": "synthetic patient",
        "n_persons": n_written, "n_stratum_fallback": n_fallback, "seed": SEED,
        "note": "Synthetic cohort: DataSUS demographic skeleton x proprietary joint depth "
                "sample. imputed_depth=true on every row — NOT localizable patients.",
    }
    with open(os.path.join(out_dir, "persons_provenance.json"), "w") as f:
        json.dump(prov, f, indent=2)

    passes = con.execute(f"SELECT count(*) FILTER (WHERE passes_depth), count(*) "
                         f"FROM read_parquet('{pq_path}')").fetchone()
    print(f"wrote {n_written:,} synthetic persons -> {pq_path}")
    print(f"  passing full depth: {passes[0]:,}  ({100*passes[0]/passes[1]:.2f}%)  "
          f"| stratum-fallback rows: {n_fallback:,}")


if __name__ == "__main__":
    main()
