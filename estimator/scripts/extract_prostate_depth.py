"""Extract + PERSIST prostate (C61) depth from the proprietary clinical text.

Turns the prototype's in-memory extraction into a reusable asset: one row per prostate
patient with the regex-NLP depth (max PSA, max Gleason, any metastatic) aggregated over
their documents, plus site + birth_year. Written to data/proprietary_prostate/depth.parquet
(same role proprietary_ha plays for breast). Aggregates over free text; persists structured
fields only — no raw clinical narrative leaves the extractor.

Validated by clinical plausibility (Gleason mode = 7). Regenerable from the full base.

Run (from estimator/):
  TB_FULL_PROPRIETARY_GLOB='~/.../parquet_ihealth/*.parquet' python scripts/extract_prostate_depth.py
"""
from __future__ import annotations

import glob
import os

import duckdb

est_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(est_dir, "data/proprietary_prostate")
FULL_GLOB = os.path.expanduser(os.environ.get(
    "TB_FULL_PROPRIETARY_GLOB",
    "~/Documents/Claude/Projects/iHealth DataBase Projects/parquet_ihealth/*.parquet"))


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    full = sorted(glob.glob(FULL_GLOB))
    if not full:
        raise SystemExit(f"no full base parquet at {FULL_GLOB}")

    con = duckdb.connect()
    con.execute("PRAGMA disable_progress_bar")
    con.execute("SET memory_limit='5GB'; SET threads=4")
    out = os.path.join(OUT_DIR, "depth.parquet")
    con.execute(f"""
      COPY (
        WITH ext AS (
          SELECT unique_patient_id, hospital, birth_year,
            try_cast(replace(regexp_extract(texto,'(?i)psa[^0-9]{{0,8}}([0-9]{{1,4}}[.,]?[0-9]{{0,2}})',1),',','.') AS DOUBLE) psa,
            coalesce(
              try_cast(regexp_extract(texto,'(?i)gleason[^0-9]{{0,12}}([0-9])\\s*\\+\\s*([0-9])',1) AS INT)
                + try_cast(regexp_extract(texto,'(?i)gleason[^0-9]{{0,12}}([0-9])\\s*\\+\\s*([0-9])',2) AS INT),
              try_cast(regexp_extract(texto,'(?i)gleason[^0-9]{{0,12}}([0-9]{{1,2}})',1) AS INT)) gleason,
            CASE WHEN regexp_matches(texto,'(?i)metást|metast|\\bM1\\b|est[aá]dio IV|estagio IV') THEN 1 ELSE 0 END metast
          FROM read_parquet({full!r}) WHERE upper(primary_icd) LIKE 'C61%'
        )
        SELECT unique_patient_id AS patient_id, any_value(hospital) AS site, 'M' AS sex,
               max(birth_year) AS birth_year,
               max(CASE WHEN psa BETWEEN 0 AND 5000 THEN psa END) AS psa,
               max(CASE WHEN gleason BETWEEN 6 AND 10 THEN gleason END) AS gleason,
               max(metast) AS metastatic
        FROM ext GROUP BY 1
      ) TO '{out}' (FORMAT PARQUET)""")

    r = con.execute(f"""SELECT count(*), count(psa), count(gleason), sum(metastatic)
                        FROM read_parquet('{out}')""").fetchone()
    print(f"wrote {r[0]:,} prostate patients -> {out}")
    print(f"  PSA present: {r[1]:,}  Gleason present: {r[2]:,}  metastatic: {r[3]:,}")


if __name__ == "__main__":
    main()
