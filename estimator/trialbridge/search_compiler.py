"""Safe ClinicalSearchSpec -> parameterized DuckDB SQL compiler."""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, time
from typing import Any

from .search_spec import AgeClause, BoolQuery, ClinicalSearchSpec, PeriodClause, SexClause, TextClause

_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_NORM_TEXT = "lower(strip_accents(texto))"


@dataclass(frozen=True)
class CompiledSearch:
    sql: str
    params: tuple[Any, ...]
    stage_ids: tuple[str, ...]


def _norm(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    return "".join(c for c in value if not unicodedata.combining(c)).lower().strip()


def _clause(clause, reference_year: int) -> tuple[str, list[Any]]:
    if isinstance(clause, TextClause):
        terms = [_norm(t) for t in clause.terms]
        predicates = [f"contains({_NORM_TEXT}, ?)" for _ in terms]
        joiner = " AND " if clause.operator == "and" else " OR "
        return "(" + joiner.join(predicates) + ")", terms
    if isinstance(clause, AgeClause):
        sql, params = [], []
        if clause.min_age is not None:
            sql.append("birth_year <= ?")
            params.append(reference_year - clause.min_age)
        if clause.max_age is not None:
            sql.append("birth_year >= ?")
            params.append(reference_year - clause.max_age)
        return "(" + " AND ".join(sql) + ")", params
    if isinstance(clause, SexClause):
        return "gender = ?", [clause.value]
    if isinstance(clause, PeriodClause):
        sql, params = [], []
        if clause.start:
            sql.append("created_ts >= ?")
            params.append(datetime.combine(clause.start, time.min))
        if clause.end:
            sql.append("created_ts < ?")
            params.append(datetime.combine(clause.end, time.min))
        return "(" + " AND ".join(sql) + ")", params
    raise TypeError(f"unsupported clause {type(clause).__name__}")


def _bool(query: BoolQuery, reference_year: int) -> tuple[str, list[Any]]:
    parts: list[str] = []
    params: list[Any] = []
    for clause in [*query.must, *query.filter]:
        sql, values = _clause(clause, reference_year)
        parts.append(sql)
        params.extend(values)
    if query.should:
        should_parts = []
        for clause in query.should:
            sql, values = _clause(clause, reference_year)
            should_parts.append(f"CAST(({sql}) AS INTEGER)")
            params.extend(values)
        parts.append(f"({' + '.join(should_parts)}) >= {query.minimum_should_match}")
    return ("(" + " AND ".join(parts) + ")" if parts else "TRUE"), params


def compile_proprietary_search(spec: ClinicalSearchSpec, table_name: str = "proprietary_docs") -> CompiledSearch:
    if not _IDENTIFIER.fullmatch(table_name):
        raise ValueError("table_name must be a trusted SQL identifier")
    stage_sql: list[tuple[str, list[Any]]] = []
    for index, stage in enumerate(spec.stages):
        predicate, params = _bool(stage.query, spec.reference_year)
        diagnosis = " OR ".join("primary_icd LIKE ?" for _ in spec.diagnosis.cid10_prefixes)
        dx_params = [f"{p}%" for p in spec.diagnosis.cid10_prefixes]
        # Diagnosis defines the first population. Repeating it on later stages keeps an
        # exclusion from matching unrelated diagnoses documented for the same patient.
        sql = (
            f"SELECT DISTINCT unique_patient_id FROM {table_name} "
            f"WHERE ({diagnosis}) AND {predicate}"
        )
        stage_sql.append((sql, [*dx_params, *params]))

    sql, params = stage_sql[0]
    for stage, (next_sql, next_params) in zip(spec.stages[1:], stage_sql[1:]):
        operator = "INTERSECT" if stage.kind == "INCLUSAO" else "EXCEPT"
        sql = f"SELECT unique_patient_id FROM ({sql}) {operator} SELECT unique_patient_id FROM ({next_sql})"
        params.extend(next_params)
    return CompiledSearch(sql=sql, params=tuple(params), stage_ids=tuple(s.id for s in spec.stages))
