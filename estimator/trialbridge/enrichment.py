"""Enrichment Layer.

Learns the JOINT depth-eligibility rate per covariate stratum from proprietary
patient data: P(all depth criteria satisfied | dx, age_band, sex).

Two things that make the estimate honest:
  * Joint rate (not a product of marginals) -> captures dependence between
    depth criteria (e.g. stage and prior lines correlate).
  * Shrinkage toward the dx-level pooled rate -> thin strata borrow strength
    and get wider intervals instead of noisy point estimates.

Standardization to DataSUS happens in the estimator, by weighting these
per-stratum rates with DataSUS stratum counts (direct standardization).
"""
from __future__ import annotations
from collections import defaultdict
from typing import Callable, Dict, List, Tuple

from .data import Stratum
from .stats import Rate, shrink

DepthPredicate = Callable[[dict], bool]


class EnrichmentModel:
    def __init__(self, patients: List[dict], shrink_alpha: float = 20.0):
        self.patients = patients
        self.alpha = shrink_alpha

    def fit(self, predicate: DepthPredicate) -> "FittedRates":
        # counts per stratum and per dx (pooled parent)
        strat_k: Dict[Stratum, int] = defaultdict(int)
        strat_n: Dict[Stratum, int] = defaultdict(int)
        dx_k: Dict[str, int] = defaultdict(int)
        dx_n: Dict[str, int] = defaultdict(int)
        for p in self.patients:
            s: Stratum = (p["dx"], p["age_band"], p["sex"])
            ok = 1 if predicate(p) else 0
            strat_n[s] += 1
            strat_k[s] += ok
            dx_n[p["dx"]] += 1
            dx_k[p["dx"]] += ok
        dx_rate = {d: (dx_k[d] / dx_n[d] if dx_n[d] else 0.0) for d in dx_n}
        rates: Dict[Stratum, Rate] = {}
        for s in strat_n:
            pooled = dx_rate.get(s[0], 0.0)
            rates[s] = shrink(strat_k[s], strat_n[s], pooled, self.alpha)
        return FittedRates(rates=rates, dx_rate=dx_rate, alpha=self.alpha)


class FittedRates:
    def __init__(self, rates: Dict[Stratum, Rate], dx_rate: Dict[str, float], alpha: float):
        self.rates = rates
        self.dx_rate = dx_rate
        self.alpha = alpha

    def rate_for(self, stratum: Stratum) -> Rate:
        """Rate for a stratum; fall back to dx-pooled (shrunk) if unseen."""
        if stratum in self.rates:
            return self.rates[stratum]
        pooled = self.dx_rate.get(stratum[0], 0.0)
        return shrink(0, 0, pooled, self.alpha)
