"""texto free-text predicates. Reproduces ES lowercase+asciifolding via
lower(strip_accents(...)) and 'match' operator AND/OR semantics. Spec §5.2."""
from __future__ import annotations
import unicodedata
from .schemas import TextClause

_NORM_COL = "lower(strip_accents(texto))"

def _norm_term(t: str) -> str:
    t = unicodedata.normalize("NFKD", t)
    t = "".join(c for c in t if not unicodedata.combining(c))
    return t.lower().strip().replace("'", "''")   # escape single quotes for SQL literal

def _term_pred(term: str) -> str:
    # A 'term' may be a multi-word expression; match it as a contiguous substring.
    return f"{_NORM_COL} LIKE '%{_norm_term(term)}%'"

def text_predicate(clause: TextClause) -> str:
    parts = [_term_pred(t) for t in clause.terms if t.strip()]
    if not parts:
        return "FALSE"
    joiner = " AND " if clause.operator == "and" else " OR "
    return "(" + joiner.join(parts) + ")"
