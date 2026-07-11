"""Hospital-code -> UF (federal unit) lookup.

The proprietary base identifies a patient's facility by hospital CODE (e.g. 'ha',
'hmv') but carries no UF column. This maps each code to its Brazilian state so that
(a) per-UF findability can aggregate observed patients by geography, and (b) the
leave-one-UF-out geographic holdout (Trilha B step 3) can split proprietary patients
by state instead of by hospital.

Provenance matters here: a wrong hospital->UF assignment silently misattributes patients
to the wrong state and corrupts every per-UF number. So `uf_for` returns None for any
code whose UF is not confirmed, and callers keep those patients OUT of per-UF
aggregation (an 'unknown' bucket) rather than guessing. The map + per-entry source live
in hospital-uf.json next to concept-map.json; override the path with TB_HOSPITAL_UF.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict, Optional

_DEFAULT_PATH = Path(__file__).resolve().parent.parent / "hospital-uf.json"


def _load() -> Dict[str, Optional[str]]:
    path = os.environ.get("TB_HOSPITAL_UF") or str(_DEFAULT_PATH)
    with open(path) as f:
        raw = json.load(f)
    return {code: entry.get("uf") for code, entry in raw.get("map", {}).items()}


_HOSPITAL_UF: Dict[str, Optional[str]] = _load()


def uf_for(site: str) -> Optional[str]:
    """UF for a hospital code, or None if unknown/unconfirmed (never guessed)."""
    return _HOSPITAL_UF.get(site)


def known_ufs() -> set[str]:
    return {uf for uf in _HOSPITAL_UF.values() if uf}
