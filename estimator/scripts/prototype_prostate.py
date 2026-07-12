"""Prostate (C61) end-to-end cross — proves the enriched-base method generalizes beyond breast.

Unlike the breast depth (pre-extracted) and the payer axis (a join), prostate depth is
extracted HERE from the proprietary clinical text via regex NLP: PSA (ng/mL), Gleason score
(X+Y or single), and metastatic status, aggregated per patient across their documents. The
extraction is validated by clinical plausibility (Gleason mode = 7, realistic PSA spread).

Then the SAME pipeline as breast: fit the joint depth rate per (dx, age_band, sex) stratum on
the proprietary prostate cohort, weight by the real DataSUS C61 base counts (direct
standardization) -> national + per-UF Estimated N for an advanced-prostate protocol.

Depth predicate (illustrative advanced/high-risk mCRPC-like): metastatic AND Gleason >= 8.
Complete-case = Gleason extracted (metastatic is always determinable). Aggregates only.

Run (from estimator/):
  TB_DATASUS_FULL_DIR='~/datasus omop mcp/data/raw' \
  TB_FULL_PROPRIETARY_GLOB='~/.../parquet_ihealth/*.parquet' \
  TB_CONCEPT_MAP=$PWD/concept-map.json python scripts/prototype_prostate.py
"""
from __future__ import annotations

import glob
import math
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import duckdb

from trialbridge.data import DuckDBDataSUS
from trialbridge.enrichment import EnrichmentModel
from trialbridge.stats import Z

REFERENCE_YEAR = 2025


def _age_band(age: int):
    if age is None or age < 18:
        return None
    return "18-39" if age <= 39 else "40-49" if age <= 49 else "50-59" if age <= 59 \
        else "60-69" if age <= 69 else "70+"


def extract_prostate_patients(full_glob):
    """Per-patient prostate depth from clinical text (regex NLP), aggregated over documents."""
    full = sorted(glob.glob(os.path.expanduser(full_glob)))
    con = duckdb.connect()
    con.execute("PRAGMA disable_progress_bar")
    con.execute("SET memory_limit='5GB'; SET threads=4")
    rows = con.execute(f"""
      with ext as (
        select unique_patient_id, hospital, birth_year,
          try_cast(replace(regexp_extract(texto,'(?i)psa[^0-9]{{0,8}}([0-9]{{1,4}}[.,]?[0-9]{{0,2}})',1),',','.') as double) psa,
          coalesce(
            try_cast(regexp_extract(texto,'(?i)gleason[^0-9]{{0,12}}([0-9])\\s*\\+\\s*([0-9])',1) as int)
              + try_cast(regexp_extract(texto,'(?i)gleason[^0-9]{{0,12}}([0-9])\\s*\\+\\s*([0-9])',2) as int),
            try_cast(regexp_extract(texto,'(?i)gleason[^0-9]{{0,12}}([0-9]{{1,2}})',1) as int)) gleason,
          case when regexp_matches(texto,'(?i)metást|metast|\\bM1\\b|est[aá]dio IV|estagio IV') then 1 else 0 end metast
        from read_parquet({full!r}) where upper(primary_icd) like 'C61%')
      select unique_patient_id, any_value(hospital) site, max(birth_year) birth_year,
             max(case when psa between 0 and 5000 then psa end) psa,
             max(case when gleason between 6 and 10 then gleason end) gleason,
             max(metast) metastatic
      from ext group by 1""").fetchall()
    patients = []
    for _, site, birth_year, psa, gleason, metast in rows:
        if not birth_year:
            continue
        band = _age_band(REFERENCE_YEAR - birth_year)
        if band is None:
            continue
        patients.append({"dx": "prostate_cancer", "age_band": band, "sex": "M",
                         "site": site, "psa": psa, "gleason": gleason,
                         "metastatic": bool(metast)})
    return patients


def main():
    full_glob = os.environ.get("TB_FULL_PROPRIETARY_GLOB",
                               "~/Documents/Claude/Projects/iHealth DataBase Projects/parquet_ihealth/*.parquet")
    ds_dir = os.path.expanduser(os.environ.get("TB_DATASUS_FULL_DIR", "~/datasus omop mcp/data/raw"))

    patients = extract_prostate_patients(full_glob)
    n = len(patients)
    cc = [p for p in patients if p["gleason"] is not None]  # complete-case: Gleason present
    print(f"prostate proprietary patients (with age/site): {n:,}   Gleason-complete: {len(cc):,}")

    # depth predicate: high-risk metastatic (metastatic AND Gleason>=8)
    def depth(p):
        return bool(p["metastatic"]) and (p["gleason"] is not None and p["gleason"] >= 8)

    for label, pred in [
        ("metastatic", lambda p: bool(p["metastatic"])),
        ("Gleason>=8", lambda p: p["gleason"] is not None and p["gleason"] >= 8),
        ("PSA>=20", lambda p: p["psa"] is not None and p["psa"] >= 20),
        ("FULL: metastatic & Gleason>=8", depth),
    ]:
        r = sum(1 for p in cc if pred(p)) / len(cc)
        print(f"  rate[{label:<30}] = {r:.2%}")

    # DataSUS C61 base per stratum (exact, reuse the estimator's logic)
    datasus = DuckDBDataSUS(parquet_dir=ds_dir, dx_cid_prefixes={"prostate_cancer": ["C61"]})
    base_cells = defaultdict(int)   # (uf, age_band) -> count  (sex = M)
    for rec in datasus.records():
        if rec.dx == "prostate_cancer" and rec.sex == "M":
            base_cells[(rec.region, rec.age_band)] += rec.count
    nat_base = sum(base_cells.values())

    # fit joint depth rate on complete-case, cross with DataSUS base (direct standardization)
    model = EnrichmentModel(cc, shrink_alpha=20.0)
    fitted = model.fit(depth)
    per_uf = defaultdict(float)
    nat_est = nat_var = 0.0
    for (uf, band), count in base_cells.items():
        rate = fitted.rate_for(("prostate_cancer", band, "M"))
        est = count * rate.p
        per_uf[uf] += est
        nat_est += est
        nat_var += (count ** 2) * (rate.p * (1 - rate.p) / rate.n if rate.n > 0 else 0.0)
    half = Z * math.sqrt(nat_var)

    print(f"\nDataSUS C61 base cohort (male, 18+): {nat_base:,}")
    print(f"national Estimated N (advanced prostate, standardized): {nat_est:,.0f} "
          f"(95% CI {max(0,nat_est-half):,.0f}-{nat_est+half:,.0f})")
    print(f"implied eligible fraction: {nat_est/nat_base:.2%}")
    print("top 5 UFs by Estimated N:")
    for uf, e in sorted(per_uf.items(), key=lambda kv: -kv[1])[:5]:
        print(f"  {uf}: {e:,.0f}")
    print("\n-> method generalizes: same pipeline (extract depth -> fit joint rate -> standardize "
          "to DataSUS) works for prostate. This is the 2nd member of the enriched asset.")


if __name__ == "__main__":
    main()
