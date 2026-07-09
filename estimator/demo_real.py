"""End-to-end demo on REAL data: real DataSUS base cohort x real proprietary depth rates.

Base cohort: DuckDBDataSUS over the full national ihealth_omop_sus export
  (person + condition_occurrence, 63M / 885M rows, mirrored locally).
Depth rates: RealProprietary over NLP-extracted HER2/ECOG from all 14 hospitals
  with breast-cancer patients (28,490 real patients nationally; 2,355 with both
  HER2 and ECOG stated — coverage is heavily concentrated in one hospital, 'ha').

Run:  <scratch>/venv/bin/python3 demo_real.py
"""
import sys

from trialbridge.data import DuckDBDataSUS, RealProprietary
from trialbridge.estimator import estimate, national_total, rank_bottlenecks, observed_n_by_site
from trialbridge.protocols import hero_protocol_real

DATASUS_DIR = sys.argv[1] if len(sys.argv) > 1 else None
PROPRIETARY_PARQUET = sys.argv[2] if len(sys.argv) > 2 else None
assert DATASUS_DIR and PROPRIETARY_PARQUET, "usage: demo_real.py <datasus_parquet_dir> <proprietary_parquet_path>"


def main() -> None:
    protocol = hero_protocol_real()
    datasus = DuckDBDataSUS(
        parquet_dir=DATASUS_DIR,
        dx_cid_prefixes={"breast_cancer": ["C50"]},
    )
    proprietary = RealProprietary(parquet_paths=[PROPRIETARY_PARQUET])

    pts = proprietary.patients()
    print(f"Proprietary (real, 14 hospitals, complete-case HER2+ECOG): {len(pts)} patients")
    her2_rate = sum(1 for p in pts if p["her2"]) / len(pts)
    ecog01_rate = sum(1 for p in pts if p["ecog"] <= 1) / len(pts)
    met_rate = sum(1 for p in pts if p["metastatic"]) / len(pts)
    print(f"  raw (unstandardized) rates in this sample: "
          f"HER2+={her2_rate:.1%}  ECOG 0-1={ecog01_rate:.1%}  metastatic-flagged={met_rate:.1%}")

    ai_present = sum(1 for p in pts if p["autoimmune"] is True)
    ai_absent = sum(1 for p in pts if p["autoimmune"] is False)
    ai_unmentioned = sum(1 for p in pts if p["autoimmune"] is None)
    print(f"  autoimmune assertion (exclusion-criterion validation): "
          f"present/history={ai_present}  explicitly-absent={ai_absent}  "
          f"never mentioned={ai_unmentioned} (treated as passing, per assertion='ABSENT')")

    print("\nDataSUS base cohort (real, national, breast cancer, age>=18):")
    recs = datasus.records()
    total_base = sum(r.count for r in recs if r.dx == "breast_cancer")
    print(f"  {len(recs)} suppressed (state x age_band x sex) cells, {total_base:,} patients total")

    print(f"\nEstimating '{protocol.protocol_id}' (checkable: "
          f"{', '.join(c.field for c in protocol.checkable())}; "
          f"depth: {', '.join(c.field for c in protocol.depth())})...")
    ests = estimate(protocol, datasus, proprietary)
    print(f"\nTop 10 states by estimated eligible:")
    for s in ests[:10]:
        print("  " + str(s))

    nat, lo, hi = national_total(ests)
    print(f"\nNational Estimated N (addressable, standardized): {nat:,.0f}  (95% CI {lo:,.0f}-{hi:,.0f})")
    print(f"  vs. DataSUS base cohort (breast cancer, female, 18+): {total_base:,}")
    print(f"  implied standardized eligible fraction: {nat/total_base:.2%}")

    print("\nObserved N by site (direct row-level count, no model — Slide 6/11's site feasibility number):")
    sites = observed_n_by_site(protocol, RealProprietary(parquet_paths=[PROPRIETARY_PARQUET], complete_cases_only=False))
    for s in sites:
        if s.observed_n > 0:
            print(f"  {s}")
    zero_sites = [s.site for s in sites if s.observed_n == 0]
    print(f"  ({len(zero_sites)} more sites with observed_N=0: {', '.join(zero_sites)})")

    print("\nBottleneck ranking (pool gain if each depth criterion is relaxed):")
    for b in rank_bottlenecks(protocol, datasus, proprietary):
        print(f"  {b.criterion_id:<10} {b.text:<45} +{b.gain:,.0f}  "
              f"({b.baseline_total:,.0f} -> {b.softened_total:,.0f})")


if __name__ == "__main__":
    main()
