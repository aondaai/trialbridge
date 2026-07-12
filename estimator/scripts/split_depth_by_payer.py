"""Annotate the breast depth data with payer (SUS vs private) and write a SUS-only copy.

No NLP re-extraction: the depth records join back to the full proprietary base on
`<site>_<patient_id>` == `unique_patient_id`, and each patient is classified SUS / private
by the majority of their documents' `convenio`. We then write a SUS-only copy of each depth
file (same schema as data/proprietary_ha) so the existing materializers/estimator can run
against it unchanged, via TB_PROPRIETARY_GLOB.

Why: DataSUS is 100% SUS; the proprietary depth mixes SUS + private. Restricting depth to the
SUS subset removes the private-payer skew before transferring rates to the DataSUS population.
(Finding: the complete-case breast cohort is ~96% SUS already, so the shift is small — but this
makes it explicit and lets the estimate claim SUS-representativeness.)

Run (from estimator/):
  TB_FULL_PROPRIETARY_GLOB='~/.../parquet_ihealth/*.parquet' python scripts/split_depth_by_payer.py
"""
from __future__ import annotations

import glob
import os
import re
import sys

import duckdb

est_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HA_DIR = os.path.join(est_dir, "data/proprietary_ha")
OUT_DIR = os.path.join(est_dir, "data/proprietary_ha_sus")
FULL_GLOB = os.path.expanduser(os.environ.get(
    "TB_FULL_PROPRIETARY_GLOB",
    "~/Documents/Claude/Projects/iHealth DataBase Projects/parquet_ihealth/*.parquet"))

# convenio -> SUS if it names SUS / Sistema Unico, else private (when labelled).
SUS_MATCH = "(upper(convenio) like '%SUS%' or upper(convenio) like '%UNICO%' or upper(convenio) like '%ÚNICO%')"


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    full = sorted(glob.glob(FULL_GLOB))
    if not full:
        sys.exit(f"no full base parquet at {FULL_GLOB}")

    con = duckdb.connect()
    con.execute("PRAGMA disable_progress_bar")
    # Per-patient payer tally over the full base (one scan).
    con.execute(f"""create table conv as
      select unique_patient_id,
        sum(case when {SUS_MATCH} then 1 else 0 end) sus_docs,
        sum(case when convenio is not null and convenio<>'' and not {SUS_MATCH} then 1 else 0 end) priv_docs
      from read_parquet({full!r}) group by 1""")

    totals = {"SUS": 0, "private": 0, "unknown": 0}
    for path in sorted(glob.glob(os.path.join(HA_DIR, "*.parquet"))):
        name = os.path.basename(path)
        m = re.match(r"([a-z_]+)_breast_cancer", name)
        site = m.group(1) if m else name.split("_")[0]
        out = os.path.join(OUT_DIR, name)
        # classify each depth patient; keep the SAME schema, SUS rows only.
        con.execute(f"""copy (
          select d.patient_id, d.sex, d.birth_year, d.her2, d.ecog, d.metastatic, d.autoimmune
          from read_parquet('{path}') d
          left join conv c on ('{site}_'||d.patient_id) = c.unique_patient_id
          where coalesce(c.sus_docs,0) > 0 and coalesce(c.sus_docs,0) >= coalesce(c.priv_docs,0)
        ) to '{out}' (format parquet)""")
        # tally for reporting
        r = con.execute(f"""select
            sum(case when coalesce(c.sus_docs,0)>0 and coalesce(c.sus_docs,0)>=coalesce(c.priv_docs,0) then 1 else 0 end) sus,
            sum(case when coalesce(c.priv_docs,0)>0 and coalesce(c.priv_docs,0)>coalesce(c.sus_docs,0) then 1 else 0 end) priv,
            sum(case when coalesce(c.sus_docs,0)=0 and coalesce(c.priv_docs,0)=0 then 1 else 0 end) unk
          from read_parquet('{path}') d
          left join conv c on ('{site}_'||d.patient_id) = c.unique_patient_id""").fetchone()
        totals["SUS"] += r[0] or 0
        totals["private"] += r[1] or 0
        totals["unknown"] += r[2] or 0
        print(f"  {name:<38} SUS={r[0] or 0:>5}  private={r[1] or 0:>4}  unknown={r[2] or 0:>4}")

    n = sum(totals.values())
    print(f"\ntotal depth docs: {n}  SUS={totals['SUS']} ({100*totals['SUS']/n:.1f}%)  "
          f"private={totals['private']}  unknown={totals['unknown']}")
    print(f"wrote SUS-only depth -> {OUT_DIR}/  (same schema; point TB_PROPRIETARY_GLOB here)")


if __name__ == "__main__":
    main()
