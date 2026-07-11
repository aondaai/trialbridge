"""Findability (strategy §6.1) — Observed ÷ Estimated, per stratum.

findability_rate = Observed_N (Ativo 2, real localizable patients) / Estimated_N
(Ativo 3, market size). It answers: what fraction of the addressable market can we
actually activate today? A low rate in a high-Estimated-N stratum is the priority
target for data acquisition — the commercial loop the strategy sells.

This is a pure function over two aligned dicts; the caller decides the key (national
"BR" today; per-UF or per (UF×age×sex) once Observed and Estimated share a key — see
the plan's Deferred Work). Rows are sorted lowest-rate-first so the biggest gaps lead.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional


@dataclass(frozen=True)
class StratumFindability:
    stratum: str
    observed_n: int
    estimated_n: float
    rate: Optional[float]  # observed/estimated; None when estimated == 0


def findability(observed_by_key: Dict[str, int],
                estimated_by_key: Dict[str, float]) -> List[StratumFindability]:
    rows: List[StratumFindability] = []
    for key, est in estimated_by_key.items():
        obs = observed_by_key.get(key, 0)
        rate = (obs / est) if est > 0 else None
        rows.append(StratumFindability(stratum=key, observed_n=obs,
                                       estimated_n=est, rate=rate))
    # Lowest findability first; None (undefined) sorts last.
    rows.sort(key=lambda r: (r.rate is None, r.rate if r.rate is not None else 0.0))
    return rows
