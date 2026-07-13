"""convenio (payer) normalization → {sus, private, unknown}. Spec §5.3.

Rule (mirrors ES asciifolding): normalize, then 'sus' substring ⇒ sus;
null/blank ⇒ unknown; everything else ⇒ private. Auditable in one place.
"""
from __future__ import annotations
import unicodedata

def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower().strip()

def classify_payer(convenio: str | None) -> str:
    if convenio is None:
        return "unknown"
    n = _norm(convenio)
    if not n:
        return "unknown"
    if "sus" in n:
        return "sus"
    return "private"

# DuckDB CASE mirroring classify_payer, over raw `convenio`.
# strip_accents+lower reproduce _norm; the 'sus' check matches classify_payer.
PAYER_SQL_CASE = (
    "CASE "
    "WHEN convenio IS NULL OR trim(convenio) = '' THEN 'unknown' "
    "WHEN strpos(lower(strip_accents(convenio)), 'sus') > 0 THEN 'sus' "
    "ELSE 'private' END"
)
