"""Materialize the DataSUS base cohort — Asset 3's reconstructible base.

Scans the full DataSUS OMOP export (Asset 1, ~163GB, read-only) ONCE and writes a
tiny per-stratum aggregate (UF x age_band x sex x dx -> count) plus monthly
incidence and a provenance stamp. That aggregate is what the query layer reads at
runtime — small, fast, ships in the image, and is 100% reconstructible from
Asset 1 by re-running this script.

Per the data strategy: Asset 3 is a DERIVED product, never a source of truth. This
script is how it is derived. It counts (never finds) — it emits aggregates only, no
patient rows.

Run (native, against the full mirror):
  TB_DATASUS_FULL_DIR=data/omop_full \
  python scripts/materialize_datasus.py --as-of 2026-07-09
"""
from __future__ import annotations

import argparse
import json
import os
from dataclasses import asdict
from pathlib import Path

from trialbridge.data import DuckDBDataSUS

# Diagnoses we materialize a base cohort for. Add a CID-10 prefix family here to
# make that diagnosis queryable (the scan is ~1-2s each over the full export).
DX_CID_PREFIXES = {
    "breast_cancer": ["C50"],
    "lung_cancer": ["C33", "C34"],
    # J84.1 is the specific fibrosing-ILD/IPF cohort. The source export stores
    # condition_source_value without dots, so the executable prefix is J841.
    "idiopathic_pulmonary_fibrosis": ["J841"],
    # Trial NCT05544019's mature B-cell scope: follicular/non-follicular and
    # other B-cell NHL, immunoproliferative disease, plus B-cell CLL. C84 is
    # intentionally excluded because it is the T/NK-cell lymphoma category.
    "mature_b_cell_malignancy": ["C82", "C83", "C85", "C88", "C911"],
}

MIN_CELL = 5  # small-cell suppression carried through to the derived asset


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--full-dir", default=os.environ.get("TB_DATASUS_FULL_DIR", "data/omop_full"))
    ap.add_argument("--out-dir", default="data/datasus_base")
    ap.add_argument("--as-of", required=True, help="snapshot date, e.g. 2026-07-09")
    args = ap.parse_args()

    datasus = DuckDBDataSUS(parquet_dir=args.full_dir, dx_cid_prefixes=DX_CID_PREFIXES, min_cell=MIN_CELL)

    records = datasus.records()
    incidence = {dx: datasus.monthly_incidence_by_region(dx) for dx in DX_CID_PREFIXES}

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    with (out / "records.json").open("w") as f:
        json.dump([asdict(r) for r in records], f)
    with (out / "incidence.json").open("w") as f:
        json.dump(incidence, f)

    # National base cohort per dx (sum over strata) — a headline figure + a coverage check.
    national = {}
    coverage_ufs = sorted({r.region for r in records})
    for dx in DX_CID_PREFIXES:
        national[dx] = sum(r.count for r in records if r.dx == dx)

    provenance = {
        "origin": "estimated",
        "asset": "datasus_enriched_base",
        "source": "DataSUS OMOP (omop_full)",
        "reconstructible_from": "Asset 1 (omop_full) + this script",
        "as_of": args.as_of,
        "min_cell": MIN_CELL,
        "dx_cid_prefixes": DX_CID_PREFIXES,
        "coverage_ufs": coverage_ufs,
        "national_base_cohort": national,
        "strata": len(records),
    }
    with (out / "provenance.json").open("w") as f:
        json.dump(provenance, f, indent=2)

    print(f"[materialize] wrote {len(records)} strata to {out}/records.json")
    print(f"[materialize] coverage: {len(coverage_ufs)} UFs")
    for dx, n in national.items():
        print(f"[materialize] national base cohort — {dx}: {n:,}")


if __name__ == "__main__":
    main()
