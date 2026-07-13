"""Compile a SearchSpec funnel into DuckDB SQL over the doc-level base.

Semantics (Spec §5.4):
  * patient grain — a patient matches a stage if ANY of their docs match.
  * INCLUSAO stage → INTERSECT with running set.
  * EXCLUSAO stage → EXCEPT (subtract) from running set (never NOT/must_not).
  * BoolQuery: must (AND) + filter (AND) + should (OR group, >= minimum_should_match).
"""
from __future__ import annotations
from datetime import date
from .schemas import (BoolQuery, SearchSpec, TextClause, AgeClause, SexClause, PeriodClause)
from .textsearch import text_predicate

_WITHIN_DAYS = {"y": 365, "M": 30, "w": 7, "d": 1}

def _period_days(within: str) -> int:
    unit = within[-1]
    return int(within[:-1]) * _WITHIN_DAYS[unit]

def _clause_pred(c, reference_year: int, as_of: date) -> str:
    if isinstance(c, TextClause):
        return text_predicate(c)
    if isinstance(c, AgeClause):
        preds = []
        if c.min_age is not None:
            preds.append(f"birth_year <= {reference_year - c.min_age}")
        if c.max_age is not None:
            preds.append(f"birth_year >= {reference_year - c.max_age}")
        return "(" + " AND ".join(preds) + ")" if preds else "TRUE"
    if isinstance(c, SexClause):
        return f"gender = '{c.value}'"
    if isinstance(c, PeriodClause):
        cutoff = as_of.fromordinal(as_of.toordinal() - _period_days(c.within)).isoformat()
        return f"created_ts >= TIMESTAMP '{cutoff} 00:00:00'"
    raise ValueError(f"unknown clause {c!r}")

def stage_predicate(q: BoolQuery, reference_year: int, as_of: date) -> str:
    parts = []
    for c in list(q.must) + list(q.filter):
        parts.append(_clause_pred(c, reference_year, as_of))
    if q.should:
        shoulds = [_clause_pred(c, reference_year, as_of) for c in q.should]
        # >= minimum_should_match satisfied OR-terms
        summed = " + ".join(f"CAST(({p}) AS INT)" for p in shoulds)
        parts.append(f"(({summed}) >= {q.minimum_should_match})")
    return "(" + " AND ".join(parts) + ")" if parts else "TRUE"

def _stage_patient_sql(q: BoolQuery, table_expr: str, reference_year: int, as_of: date) -> str:
    pred = stage_predicate(q, reference_year, as_of)
    return f"SELECT DISTINCT unique_patient_id FROM {table_expr} WHERE {pred}"

def funnel_patient_sql(spec: SearchSpec, table_expr: str, reference_year: int, as_of: date) -> str:
    if not spec.stages:
        return f"SELECT DISTINCT unique_patient_id FROM {table_expr} WHERE FALSE"
    if spec.stages[0].kind != "INCLUSAO":
        raise ValueError(
            "first funnel stage must be INCLUSAO (it defines the base population); "
            f"got {spec.stages[0].kind!r}"
        )
    sql = None
    for stage in spec.stages:
        stage_sql = _stage_patient_sql(stage.query, table_expr, reference_year, as_of)
        if sql is None:
            # First stage must be inclusion (defines the population).
            sql = stage_sql
            continue
        op = "INTERSECT" if stage.kind == "INCLUSAO" else "EXCEPT"
        sql = f"SELECT unique_patient_id FROM ({sql}) {op} {stage_sql}"
    return sql
