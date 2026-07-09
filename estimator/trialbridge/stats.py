"""Small, transparent statistics helpers. No numpy dependency."""
from __future__ import annotations
import math
from dataclasses import dataclass

Z = 1.959963984540054  # 95%


@dataclass
class Rate:
    k: float          # (effective) successes
    n: float          # (effective) sample size
    p: float          # point estimate
    lo: float         # CI lower
    hi: float         # CI upper
    raw_n: int        # true proprietary sample size in the stratum (before shrinkage)


def wilson_ci(k: float, n: float, z: float = Z) -> tuple[float, float, float]:
    """Wilson score interval for a proportion. Returns (p, lo, hi)."""
    if n <= 0:
        return (0.0, 0.0, 1.0)
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = (z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denom
    return (p, max(0.0, center - half), min(1.0, center + half))


def shrink(k: int, n: int, p_pool: float, alpha: float = 20.0) -> Rate:
    """Empirical-Bayes-style shrinkage of a stratum rate toward a pooled rate.

    alpha acts as a pseudo-count of prior observations at rate p_pool. Small or
    empty strata borrow strength from the parent (dx-level) rate; large strata
    are barely moved. Widens honestly when data is thin.
    """
    k_eff = k + alpha * p_pool
    n_eff = n + alpha
    p, lo, hi = wilson_ci(k_eff, n_eff)
    return Rate(k=k_eff, n=n_eff, p=p, lo=lo, hi=hi, raw_n=n)
