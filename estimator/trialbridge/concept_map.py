"""Reader for the shared, frozen concept-map.json.

This is the Python half of the "one artifact, two readers" design: the same
concept-map.json the Next app writes (src/lib/omop/conceptMap.ts) is read here
to supply DuckDBDataSUS.dx_cid_prefixes — replacing the value that used to be
hand-typed in two places (api.py, demo_real.py).

Pure I/O + dict access, no LLM and no network: the map is built offline and
frozen; this reader only looks things up. The map lives at the repo root; we
resolve it from THIS file's location (robust to cwd) with a TB_CONCEPT_MAP
override for tests / non-standard layouts.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Dict, List, Optional

# CID-10 codes are interpolated into DuckDB SQL by data.py (LIKE '{prefix}%').
# They come from a build artifact, but validate their shape anyway so a tampered
# concept-map.json can never inject SQL: a letter + up to 6 alphanumerics/dots.
_CID10_CODE = re.compile(r"^[A-Za-z][0-9A-Za-z.]{1,6}$")


def concept_map_path() -> Path:
    """Repo root is three parents up from this file
    (trialbridge/ -> trialbridge_estimator/ -> outputs/ -> repo root)."""
    override = os.environ.get("TB_CONCEPT_MAP")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[3] / "concept-map.json"


def load_concept_map(path: Optional[Path] = None) -> dict:
    """Load and parse concept-map.json. Raises FileNotFoundError with a clear
    hint if the artifact hasn't been built yet (npm run build-concept-map)."""
    p = path or concept_map_path()
    if not p.exists():
        raise FileNotFoundError(
            f"concept-map.json not found at {p}. Build it first "
            f"(cd trialbridge && npm run build-concept-map), or set TB_CONCEPT_MAP."
        )
    with p.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def dx_cid_prefixes(concept_map: Optional[dict] = None) -> Dict[str, List[str]]:
    """The { dx_key: [CID-10 prefixes] } map DuckDBDataSUS keys on — DERIVED from
    the shared concept map, not hand-typed. Mirrors the TS golden truth exactly
    (breast_cancer -> ['C50'], lung_cancer -> ['C33','C34'])."""
    cm = concept_map if concept_map is not None else load_concept_map()
    prefixes = cm.get("dxPrefixes", {})
    out: Dict[str, List[str]] = {}
    for dx, codes in prefixes.items():
        for code in codes:
            if not _CID10_CODE.match(str(code)):
                raise ValueError(
                    f"Refusing CID-10 prefix {code!r} for dx {dx!r}: not a valid code shape "
                    f"(these are interpolated into SQL). Rebuild concept-map.json."
                )
        out[dx] = sorted(set(codes))
    return out
