"""Rule schema: the contract between the (Claude) criteria parser and the engine.

Each criterion is either DATASUS-CHECKABLE (evaluated exactly against DataSUS
aggregates) or DEPTH (estimated via the proprietary enrichment model).
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Callable, List, Literal

Kind = Literal["checkable", "depth"]
Assertion = Literal["PRESENT", "ABSENT", "HISTORY", "FAMILY_HISTORY"]
Op = Literal["in", "eq", "lte", "gte", "between", "is_true", "is_false"]


@dataclass
class Criterion:
    id: str
    text: str                      # original protocol phrase (audit trail)
    type: Literal["inclusion", "exclusion"]
    kind: Kind                     # checkable (DataSUS) vs depth (estimated)
    field: str                     # e.g. "dx","age_band","sex" | "her2","stage","ecog","prior_lines","autoimmune"
    op: Op
    value: Any = None
    assertion: Assertion = "PRESENT"

    def test(self, record: dict) -> bool:
        """Evaluate this single criterion against one record (patient or stratum)."""
        v = record.get(self.field)
        if v is None:
            # Unknown field on this record -> cannot confirm presence.
            # For ABSENT/exclusion semantics, unknown is treated as 'not present' (passes).
            return self.assertion in ("ABSENT",)
        if self.op == "in":
            return v in self.value
        if self.op == "eq":
            return v == self.value
        if self.op == "lte":
            return v <= self.value
        if self.op == "gte":
            return v >= self.value
        if self.op == "between":
            lo, hi = self.value
            return lo <= v <= hi
        if self.op == "is_true":
            return bool(v) is True
        if self.op == "is_false":
            return bool(v) is False
        raise ValueError(f"unknown op {self.op}")


@dataclass
class Protocol:
    protocol_id: str
    criteria: List[Criterion] = field(default_factory=list)

    def checkable(self) -> List[Criterion]:
        return [c for c in self.criteria if c.kind == "checkable"]

    def depth(self) -> List[Criterion]:
        return [c for c in self.criteria if c.kind == "depth"]

    def depth_predicate(self, exclude_ids: set[str] | None = None) -> Callable[[dict], bool]:
        """AND of all depth criteria (optionally dropping some, for softening)."""
        exclude_ids = exclude_ids or set()
        active = [c for c in self.depth() if c.id not in exclude_ids]

        def pred(patient: dict) -> bool:
            return all(c.test(patient) for c in active)

        return pred
