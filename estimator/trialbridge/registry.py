"""Model Registry (strategy §5.2, §7.3) — versioned imputation models.

Every Estimated N records the `model_version` that produced it. Because the version
id is a deterministic hash of the training parameters, a historical estimate can be
reproduced by re-fitting with the same config — which is what makes the number
defensible to a client or auditor (§7.3). `valid_ufs` is the model's calibrated
coverage: the UFs it is entitled to generate estimates for.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Dict, List, Tuple


@dataclass(frozen=True)
class ModelVersion:
    version: str
    shrink_alpha: float
    train_dx: Tuple[str, ...]
    valid_ufs: Tuple[str, ...]
    trained_on: str = ""


def make_version(shrink_alpha: float, train_dx: List[str], valid_ufs: List[str],
                 trained_on: str = "") -> ModelVersion:
    payload = "|".join([
        f"alpha={shrink_alpha}",
        f"dx={sorted(train_dx)}",
        f"ufs={sorted(valid_ufs)}",
        f"trained_on={trained_on}",
    ])
    digest = hashlib.sha1(payload.encode("utf-8")).hexdigest()[:8]
    return ModelVersion(
        version=f"enrich-{digest}",
        shrink_alpha=shrink_alpha,
        train_dx=tuple(sorted(train_dx)),
        valid_ufs=tuple(sorted(valid_ufs)),
        trained_on=trained_on,
    )


class ModelRegistry:
    def __init__(self) -> None:
        self._by_version: Dict[str, ModelVersion] = {}

    def register(self, mv: ModelVersion) -> ModelVersion:
        self._by_version[mv.version] = mv
        return mv

    def get(self, version: str) -> ModelVersion:
        return self._by_version[version]
