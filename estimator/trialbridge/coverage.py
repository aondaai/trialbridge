"""Calibrated coverage (strategy §2.3, §5.3, principle 4).

Estimated N is only emitted for strata whose UF is calibrated. Outside the calibrated
set the estimate does not exist — the emission layer omits the row entirely rather than
flagging it, because an absent row cannot be queried by accident ("ausência de linha é
uma proteção melhor que uma flag"). Today the calibrated set is 14 UFs; as the QA /
holdout report adds UFs, extend CALIBRATED_UFS_14 (or, preferably, drive coverage from
the fitted model's `valid_ufs` via `from_model`).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import FrozenSet, Tuple

# Placeholder calibrated set. Replace with the real 14-UF list from the holdout/QA
# report (§8.6 coverage report) once it exists. Kept as the single default so tests
# and the API agree on what "covered" means today.
CALIBRATED_UFS_14: Tuple[str, ...] = (
    "SP", "RJ", "MG", "RS", "PR", "SC", "BA", "PE", "CE", "GO", "DF", "ES", "PA", "MA",
)


@dataclass(frozen=True)
class CalibratedCoverage:
    ufs: FrozenSet[str]

    def is_covered(self, uf: str) -> bool:
        return uf in self.ufs

    @classmethod
    def default(cls) -> "CalibratedCoverage":
        return cls(ufs=frozenset(CALIBRATED_UFS_14))

    @classmethod
    def from_model(cls, mv) -> "CalibratedCoverage":
        # `mv` is a registry.ModelVersion (duck-typed to avoid an import cycle):
        # coverage follows whatever UFs the fitted model was calibrated for.
        return cls(ufs=frozenset(mv.valid_ufs))
