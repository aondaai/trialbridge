"""Semantic query layer (strategy §6) — route by intent, return provenance.

Nobody queries the raw assets. Every question enters here, is routed to the asset that
can honestly answer it, and comes back wrapped in a Provenance envelope so the caller
always sees the confidence level:

  FIND        -> Ativo 2 (observed patients)         -> Observed N   (origin=observed)
  PREVALENCE  -> Ativo 1 (DataSUS denominator)       -> base cohort  (origin=observed)
  MARKET_SIZE -> Ativo 3 (Σ probabilities, covered)  -> Estimated N  (origin=imputed)
  FINDABILITY -> Ativo 2 ÷ Ativo 3                    -> rate

Regra de ouro, enforced here: FIND (patient finding) may only read the observed
proprietary source. It is structurally forbidden from touching the imputed pathway —
requesting FIND with a DataSUS/estimate source raises FindingOverImputedError rather
than silently returning imputed "patients" that don't exist as locatable individuals.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from .coverage import CalibratedCoverage
from .estimator import estimate, national_total, observed_n_by_site
from .provenance import Provenanced, observed, imputed
from .schema import Protocol


class Intent(str, Enum):
    FIND = "find"
    PREVALENCE = "prevalence"
    MARKET_SIZE = "market_size"
    FINDABILITY = "findability"


class FindingOverImputedError(RuntimeError):
    """Raised when a patient-finding intent tries to consume the imputed pathway."""


def _observed_total(protocol: Protocol, proprietary,
                    exclude_depth_ids: Optional[set]) -> int:
    sites = observed_n_by_site(protocol, proprietary, exclude_depth_ids=exclude_depth_ids)
    return sum(s.observed_n for s in sites)


def _estimated_national(protocol: Protocol, proprietary, datasus,
                        coverage: CalibratedCoverage, model_version: str,
                        exclude_depth_ids: Optional[set]):
    if coverage is None:
        raise ValueError("MARKET_SIZE requires a CalibratedCoverage (no coverage -> no number)")
    ests = estimate(protocol, datasus, proprietary, exclude_depth_ids=exclude_depth_ids,
                    coverage=coverage, model_version=model_version)
    return national_total(ests, covered_only=True)  # (est, lo, hi)


def route(intent: Intent, *, protocol: Protocol, proprietary,
          datasus=None, coverage: Optional[CalibratedCoverage] = None,
          model_version: str = "", exclude_depth_ids: Optional[set] = None,
          as_of: str = "", observed_proprietary=None) -> Provenanced:
    if intent is Intent.FIND:
        if datasus is not None:
            raise FindingOverImputedError(
                "patient finding (FIND) must not read the imputed/DataSUS pathway"
            )
        total = _observed_total(protocol, proprietary, exclude_depth_ids)
        return observed(total, as_of=as_of)

    if intent is Intent.PREVALENCE:
        if datasus is None:
            raise ValueError("PREVALENCE requires a DataSUS source")
        checkable = protocol.checkable()
        base_total = sum(
            r.count for r in datasus.records()
            if all(c.test({"dx": r.dx, "age_band": r.age_band, "sex": r.sex}) for c in checkable)
        )
        return observed(base_total, as_of=as_of)

    if intent is Intent.MARKET_SIZE:
        est, lo, hi = _estimated_national(protocol, proprietary, datasus, coverage,
                                          model_version, exclude_depth_ids)
        # A national aggregate count belongs in `value`, not the [0,1] `probability`
        # field; per-field probabilities are the deferred Ativo-3 row case.
        return imputed(est, probability=None, ci=(lo, hi), model_version=model_version,
                       calibration_ref="national-covered", as_of=as_of)

    if intent is Intent.FINDABILITY:
        est, _, _ = _estimated_national(protocol, proprietary, datasus, coverage,
                                        model_version, exclude_depth_ids)
        obs_source = observed_proprietary if observed_proprietary is not None else proprietary
        obs = _observed_total(protocol, obs_source, exclude_depth_ids)
        rate = (obs / est) if est > 0 else None
        # (comment: numerator uses the same source FIND does, so Observed N reconciles
        #  with Findability's numerator; denominator uses the complete-case enrichment fit.)
        # Findability is a ratio of an observed count to an imputed total: report it as
        # imputed (it inherits the model's uncertainty via the denominator). The rate is
        # already in `value`, so `probability` stays unused here too.
        return imputed(rate, probability=None, ci=(0.0, 1.0), model_version=model_version,
                       calibration_ref="national-covered", as_of=as_of)

    raise ValueError(f"unknown intent {intent}")
