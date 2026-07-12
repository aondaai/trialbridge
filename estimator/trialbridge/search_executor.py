"""Aggregate-only proprietary search executor over an existing DuckDB relation."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from .search_compiler import compile_proprietary_search
from .search_spec import BoolQuery, ClinicalSearchSpec, FunnelStage

PAYER_CASE = (
    "CASE WHEN convenio IS NULL OR trim(convenio)='' THEN 'unknown' "
    "WHEN strpos(lower(strip_accents(convenio)), 'sus') > 0 THEN 'sus' "
    "ELSE 'private' END"
)


@dataclass(frozen=True)
class StageCount:
    stage_id: str
    kind: str
    input_n: int
    output_n: int
    delta_n: int


def _without_deep(spec: ClinicalSearchSpec) -> ClinicalSearchSpec:
    stages: list[FunnelStage] = []
    for stage in spec.stages:
        keep = lambda xs: [c for c in xs if getattr(c, "tier", 1) == 1]
        query = BoolQuery(
            must=keep(stage.query.must), filter=keep(stage.query.filter),
            should=keep(stage.query.should),
            minimum_should_match=stage.query.minimum_should_match,
        )
        if query.must or query.filter or query.should:
            stages.append(stage.model_copy(update={"query": query}))
    while stages and stages[0].kind != "INCLUSAO":
        stages.pop(0)
    if not stages:
        stages = [FunnelStage(id="diagnosis_base", kind="INCLUSAO", query=BoolQuery())]
    return spec.model_copy(update={"stages": stages})


def _patient_count(con, compiled) -> int:
    return int(con.execute(f"SELECT count(*) FROM ({compiled.sql})", compiled.params).fetchone()[0])


def _payer_counts(con, compiled, table_name: str) -> dict[str, int]:
    sql = f"""
    WITH matched AS ({compiled.sql}), docs AS (
      SELECT d.unique_patient_id, {PAYER_CASE} AS payer
      FROM {table_name} d JOIN matched m USING (unique_patient_id)
    ), patient_payer AS (
      SELECT unique_patient_id,
        CASE WHEN bool_or(payer='sus') THEN 'sus'
             WHEN bool_or(payer='private') THEN 'private' ELSE 'unknown' END AS payer
      FROM docs GROUP BY unique_patient_id
    ) SELECT payer, count(*) FROM patient_payer GROUP BY payer
    """
    rows = dict(con.execute(sql, compiled.params).fetchall())
    return {"sus": int(rows.get("sus", 0)), "private": int(rows.get("private", 0)), "unknown": int(rows.get("unknown", 0))}


def execute_proprietary_search(
    con, spec: ClinicalSearchSpec, table_name: str = "proprietary_docs", min_cell: int = 5
) -> dict[str, Any]:
    full = compile_proprietary_search(spec, table_name)
    shallow = compile_proprietary_search(_without_deep(spec), table_name)
    full_payer = _payer_counts(con, full, table_name)
    shallow_payer = _payer_counts(con, shallow, table_name)

    site_sql = f"""
    WITH matched AS ({full.sql}), per_site AS (
      SELECT d.unique_patient_id, d.hospital, count(*) AS n_docs
      FROM {table_name} d JOIN matched m USING (unique_patient_id)
      GROUP BY d.unique_patient_id, d.hospital
    ), ranked AS (
      SELECT *, row_number() OVER (
        PARTITION BY unique_patient_id ORDER BY n_docs DESC, hospital ASC
      ) AS rn FROM per_site
    ) SELECT hospital, count(*) AS n FROM ranked WHERE rn=1
      GROUP BY hospital HAVING count(*) >= ? ORDER BY n DESC, hospital
    """
    site_rows = con.execute(site_sql, (*full.params, min_cell)).fetchall()

    funnel: list[StageCount] = []
    previous = 0
    for index, stage in enumerate(spec.stages):
        partial = spec.model_copy(update={"stages": spec.stages[: index + 1]})
        current = _patient_count(con, compile_proprietary_search(partial, table_name))
        input_n = previous if index else current
        funnel.append(StageCount(stage.id, stage.kind, input_n, current, current - input_n))
        previous = current

    shallow_n = sum(shallow_payer.values())
    deep_n = sum(full_payer.values())
    sus_shallow = shallow_payer["sus"]
    sus_deep = full_payer["sus"]
    return {
        "shallow_n": shallow_n,
        "deep_n": deep_n,
        "by_payer": full_payer,
        "shallow_by_payer": shallow_payer,
        "by_hospital": [{"hospital_code": str(h), "n": int(n)} for h, n in site_rows],
        "funnel": [asdict(s) for s in funnel],
        "sus_bridge": {
            "shallow_n": sus_shallow,
            "deep_n": sus_deep,
            "depth_rate": (sus_deep / sus_shallow if sus_shallow else None),
        },
        "suppression": {"min_cell": min_cell, "hospital_cells_suppressed": True},
        "grain": "count_distinct_unique_patient_id",
    }
