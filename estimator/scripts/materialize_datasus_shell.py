"""Materialize the FULL-SCALE DataSUS shell — the third asset's structural skeleton.

Where materialize_datasus.py materializes a base cohort for a HANDFUL of named diagnoses,
this scans the full DataSUS OMOP export (63M persons / 890M conditions) and materializes
the base cohort for EVERY condition, keyed by ICD-10 3-char (C50, C61, ...) x UF x
age_band x sex. It reuses DuckDBDataSUS's exact demographic logic (F/M, age>=18, UF
present, same age bands, same min-cell suppression) so a cell here matches the estimator's
breast base cell.

This is the "shell" of the crossed asset (DataSUS intelligence x proprietary depth): it
establishes the full national skeleton and records, per condition, whether proprietary
depth is AVAILABLE (breast today -> see data/enriched_base) or PENDING (everything else,
extractable from the proprietary free text we already hold). Depth is imputed onto the
shell per condition as extraction grows (prostate C61 next).

Counts only, aggregates only, min-cell suppressed — never patient rows.

Run (from estimator/):
  TB_DATASUS_FULL_DIR='~/datasus omop mcp/data/raw' python scripts/materialize_datasus_shell.py --as-of 2026-07-12
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import duckdb

from trialbridge.data import DuckDBDataSUS

REFERENCE_YEAR = 2025
MIN_CELL = 5

# Conditions for which proprietary depth is already extracted (-> enriched_base asset).
DEPTH_AVAILABLE = {
    "C50": "breast_cancer (HER2/ECOG/metastatic) — see data/enriched_base/aggregate.json",
    "C61": "prostate_cancer (PSA/Gleason/metastatic) — see data/enriched_base/prostate_aggregate.json",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--full-dir",
                    default=os.path.expanduser(os.environ.get("TB_DATASUS_FULL_DIR",
                                               "~/datasus omop mcp/data/raw")))
    ap.add_argument("--out-dir", default="data/datasus_shell")
    ap.add_argument("--as-of", required=True)
    args = ap.parse_args()
    full = args.full_dir.rstrip("/")
    os.makedirs(args.out_dir, exist_ok=True)

    spill = os.path.join(args.out_dir, "_spill")
    os.makedirs(spill, exist_ok=True)
    con = duckdb.connect()
    con.execute("PRAGMA threads=3")
    con.execute("SET memory_limit='5GB'")
    con.execute("SET preserve_insertion_order=false")  # big memory win for large group-bys
    con.execute(f"SET temp_directory='{spill}'")

    # Persons as a compact dim table (filtered, 4 cols) so the big scan streams against it.
    # AGE_BAND_SQL references a column named `age`, provided by the inner select.
    con.execute(f"""CREATE TABLE person_dim AS
        SELECT person_id, region, sex, {DuckDBDataSUS.AGE_BAND_SQL} AS age_band
        FROM (
            SELECT person_id, location_uf_value AS region, gender_source_value AS sex,
                   ({REFERENCE_YEAR} - year_of_birth) AS age
            FROM read_parquet('{full}/person/*.parquet')
            WHERE gender_source_value IN ('F','M') AND year_of_birth IS NOT NULL
              AND location_uf_value IS NOT NULL AND ({REFERENCE_YEAR} - year_of_birth) >= 18
        )""")

    t0 = time.time()
    # approx_count_distinct (HyperLogLog): bounded memory per group, ~2% error — right for
    # the structural shell (the EXACT breast counts live in the enriched_base asset). Avoids
    # the 570M-row global DISTINCT that OOMs. Joins the 890M condition scan to person_dim.
    sql = f"""
        SELECT d.region, substr(co.condition_source_value,1,3) AS icd3, d.age_band, d.sex,
               approx_count_distinct(co.person_id) AS n
        FROM read_parquet('{full}/condition_occurrence/*.parquet') co
        JOIN person_dim d USING (person_id)
        WHERE co.condition_source_value IS NOT NULL AND length(co.condition_source_value) >= 3
        GROUP BY 1, 2, 3, 4
    """
    rows = con.execute(sql).fetchall()
    scan_s = time.time() - t0

    # min-cell suppression, then persist as parquet via a temp relation.
    kept = [(r[0], r[1], r[2], r[3], int(r[4])) for r in rows if r[4] >= MIN_CELL]
    con.execute("CREATE TABLE shell(uf VARCHAR, icd3 VARCHAR, age_band VARCHAR, sex VARCHAR, base_count BIGINT)")
    con.executemany("INSERT INTO shell VALUES (?,?,?,?,?)", kept)
    pq = os.path.join(args.out_dir, "aggregate.parquet")
    con.execute(f"COPY shell TO '{pq}' (FORMAT PARQUET)")

    # summary + depth-availability map
    n_cells = len(kept)
    icds = sorted({k[1] for k in kept})
    ufs = sorted({k[0] for k in kept})
    top = con.execute("""SELECT icd3, sum(base_count) t FROM shell
                         GROUP BY 1 ORDER BY t DESC LIMIT 12""").fetchall()
    prov = {
        "as_of": args.as_of, "asset": "datasus_shell",
        "grain": "uf x icd3 x age_band x sex", "min_cell": MIN_CELL,
        "reconstructible_from": "Asset 1 (DataSUS OMOP full) + this script",
        "source": "DataSUS OMOP (condition_occurrence + person)",
        "n_cells": n_cells, "n_icd3": len(icds), "n_ufs": len(ufs),
        "depth_available": DEPTH_AVAILABLE,
        "depth_pending_icd3": [i for i in icds if i not in DEPTH_AVAILABLE][:50],
        "note": "Full national base skeleton, all conditions. Depth imputed per condition "
                "as proprietary extraction grows; breast (C50) available now.",
    }
    with open(os.path.join(args.out_dir, "provenance.json"), "w") as f:
        json.dump(prov, f, indent=2)

    print(f"[shell] scan+aggregate: {scan_s:.0f}s")
    print(f"[shell] wrote {n_cells:,} cells ({len(icds)} ICD-3 x {len(ufs)} UF) -> {pq}")
    print(f"[shell] top conditions by base cohort:")
    for icd3, t in top:
        tag = "  [depth ✓]" if icd3 in DEPTH_AVAILABLE else "  [depth pending]"
        print(f"    {icd3}: {t:,}{tag}")


if __name__ == "__main__":
    main()
