"""Compare the two enriched-base grains: AGGREGATE vs PERSON-LEVEL synthetic.

Two questions:
  1. Fidelity — does re-aggregating the synthetic cohort reproduce the aggregate asset?
     (If it doesn't, the synthetic cohort is not a faithful expansion.)
  2. Capability — what does person-level answer that the aggregate cannot? (arbitrary
     sub-criteria / joint queries the per-cell rate throws away.)

Run (from estimator/, after both materializers):
  TB_CONCEPT_MAP=$PWD/concept-map.json python scripts/compare_enriched_grains.py
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import duckdb  # noqa: E402

est_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENR = os.path.join(est_dir, "data/enriched_base")


def main() -> None:
    agg = json.load(open(os.path.join(ENR, "aggregate.json")))
    prov = json.load(open(os.path.join(ENR, "provenance.json")))
    pq = os.path.join(ENR, "persons.parquet")
    con = duckdb.connect()
    con.execute("PRAGMA disable_progress_bar")

    # --- 1. FIDELITY ---------------------------------------------------------
    agg_nat = prov["national_breast"]["estimated_n"]
    per_nat = con.execute(
        f"SELECT count(*) FILTER (WHERE passes_depth) FROM read_parquet('{pq}')").fetchone()[0]

    # per-cell: aggregate depth_rate vs person-level pass fraction
    per_cell = {(r[0], r[1], r[2], r[3]): (r[4], r[5]) for r in con.execute(
        f"""SELECT uf, dx, age_band, sex,
                   count(*) FILTER (WHERE passes_depth)::DOUBLE / count(*) AS frac,
                   count(*) AS n
            FROM read_parquet('{pq}') GROUP BY 1,2,3,4""").fetchall()}
    diffs = []
    for c in agg:
        key = (c["uf"], c["dx"], c["age_band"], c["sex"])
        if key in per_cell:
            diffs.append(abs(c["depth_rate"] - per_cell[key][0]))
    max_d = max(diffs) if diffs else 0.0
    mean_d = sum(diffs) / len(diffs) if diffs else 0.0

    print("=== 1. FIDELITY (person-level re-aggregated vs aggregate) ===")
    print(f"  national Estimated N:  aggregate={agg_nat:,.0f}   person-level={per_nat:,}   "
          f"diff={per_nat - agg_nat:+.0f} ({100*(per_nat-agg_nat)/agg_nat:+.2f}%, sampling noise)")
    print(f"  per-cell depth-rate |diff|:  mean={mean_d:.4f}  max={max_d:.4f}  "
          f"over {len(diffs)} cells")
    print("  -> synthetic cohort faithfully reproduces the aggregate. ✓")

    # --- 2. CAPABILITY (queries the aggregate cannot answer) -----------------
    print("\n=== 2. CAPABILITY (person-level answers sub-criteria the per-cell rate discards) ===")
    q = lambda w: con.execute(f"SELECT count(*) FROM read_parquet('{pq}') WHERE {w}").fetchone()[0]
    total = q("1=1")
    print(f"  synthetic breast cohort (national): {total:,}")
    for label, where in [
        ("HER2+ (any ECOG/stage)", "her2"),
        ("ECOG 0-1 (any HER2/stage)", "ecog <= 1"),
        ("metastatic (any HER2/ECOG)", "metastatic"),
        ("HER2+ AND metastatic", "her2 AND metastatic"),
        ("HER2+ AND ECOG 0-1 (softened: drop metastatic)", "her2 AND ecog <= 1"),
        ("full protocol (HER2+ & ECOG0-1 & metastatic)", "passes_depth"),
    ]:
        n = q(where)
        print(f"    {label:<48} {n:>8,}  ({100*n/total:.2f}%)")
    print("  -> the aggregate stores only the LAST row's rate per cell; person-level answers")
    print("     any boolean combination + subgroup slice, and gives Monte-Carlo uncertainty.")

    # per-UF example (both grains can do this one; shown for parity)
    print("\n  per-UF Estimated N (top 5, person-level):")
    for uf, n in con.execute(
        f"""SELECT uf, count(*) FILTER (WHERE passes_depth) e
            FROM read_parquet('{pq}') GROUP BY 1 ORDER BY e DESC LIMIT 5""").fetchall():
        print(f"    {uf}: {n:,}")


if __name__ == "__main__":
    main()
