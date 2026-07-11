"""Provenance layer (strategy §4.5) — transversal, obligatory.

Every value the system exposes carries where it came from: observed (a real fact
about a real patient, from Ativo 2 / Ativo 1) or imputed (estimated by the model,
from Ativo 3). Observed and imputed can never be confused, because an observed
Provenance is structurally forbidden from carrying a probability or model_version,
and an imputed one is structurally required to carry a model_version. Without this
separation, Estimated N is indistinguishable from a real count — and becomes fiction.

Timestamps (`as_of`) are injected strings, never `datetime.now()`, so results stay
reproducible (same inputs -> identical envelope), matching the repo's timestamp-free
concept-map rule.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Generic, Optional, Tuple, TypeVar

T = TypeVar("T")


class Origin(str, Enum):
    OBSERVED = "observed"
    IMPUTED = "imputed"


@dataclass(frozen=True)
class Provenance:
    origin: Origin
    probability: Optional[float] = None
    ci: Optional[Tuple[float, float]] = None
    model_version: Optional[str] = None
    calibration_ref: Optional[str] = None
    as_of: str = ""

    def __post_init__(self) -> None:
        if self.origin is Origin.OBSERVED:
            if self.probability is not None or self.model_version is not None or self.ci is not None:
                raise ValueError(
                    "observed provenance must not carry probability/ci/model_version"
                )
        else:  # IMPUTED
            if self.model_version is None:
                raise ValueError("imputed provenance requires model_version")


@dataclass(frozen=True)
class Provenanced(Generic[T]):
    value: T
    provenance: Provenance


def observed(value: T, as_of: str = "") -> "Provenanced[T]":
    return Provenanced(value=value, provenance=Provenance(origin=Origin.OBSERVED, as_of=as_of))


def imputed(value: T, *, probability: Optional[float], ci: Tuple[float, float],
            model_version: str, calibration_ref: Optional[str] = None,
            as_of: str = "") -> "Provenanced[T]":
    return Provenanced(
        value=value,
        provenance=Provenance(
            origin=Origin.IMPUTED, probability=probability, ci=ci,
            model_version=model_version, calibration_ref=calibration_ref, as_of=as_of,
        ),
    )
