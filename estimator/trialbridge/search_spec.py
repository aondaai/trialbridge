"""Validated contract between protocol review and database search.

The model/user emits this data structure, never SQL. The compiler owns all column
names, operators and set semantics. Version 1 targets the document-level proprietary
Parquet and the common variables shared with DataSUS.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator, model_validator

_CID = re.compile(r"^[A-Z][0-9A-Z.]{1,6}$")


class DiagnosisSpec(BaseModel):
    concepts: list[str] = Field(min_length=1)
    cid10_prefixes: list[str] = Field(min_length=1)

    @field_validator("cid10_prefixes")
    @classmethod
    def safe_cid(cls, values: list[str]) -> list[str]:
        cleaned = [v.strip().upper() for v in values]
        if any(not _CID.fullmatch(v) for v in cleaned):
            raise ValueError("CID-10 prefixes must use a validated alphanumeric/dot shape")
        return sorted(set(cleaned))


class TextClause(BaseModel):
    type: Literal["text"] = "text"
    terms: list[str] = Field(min_length=1)
    operator: Literal["and", "or"] = "or"
    phrase: bool = False
    tier: Literal[1, 2] = 2
    label: Optional[str] = None

    @field_validator("terms")
    @classmethod
    def nonblank_terms(cls, values: list[str]) -> list[str]:
        out = [v.strip() for v in values if v.strip()]
        if not out:
            raise ValueError("text clause needs at least one nonblank term")
        return out


class AgeClause(BaseModel):
    type: Literal["age"] = "age"
    min_age: Optional[int] = Field(default=None, ge=0, le=130)
    max_age: Optional[int] = Field(default=None, ge=0, le=130)
    tier: Literal[1] = 1

    @model_validator(mode="after")
    def valid_bounds(self):
        if self.min_age is None and self.max_age is None:
            raise ValueError("age clause needs min_age or max_age")
        if self.min_age is not None and self.max_age is not None and self.min_age > self.max_age:
            raise ValueError("min_age cannot exceed max_age")
        return self


class SexClause(BaseModel):
    type: Literal["sex"] = "sex"
    value: Literal["FEMALE", "MALE"]
    tier: Literal[1] = 1


class PeriodClause(BaseModel):
    type: Literal["period"] = "period"
    start: Optional[date] = None
    end: Optional[date] = None
    tier: Literal[1] = 1

    @model_validator(mode="after")
    def valid_window(self):
        if self.start is None and self.end is None:
            raise ValueError("period clause needs start or end")
        if self.start and self.end and self.start >= self.end:
            raise ValueError("period end must be after start")
        return self


Clause = Annotated[Union[TextClause, AgeClause, SexClause, PeriodClause], Field(discriminator="type")]


class BoolQuery(BaseModel):
    must: list[Clause] = Field(default_factory=list)
    filter: list[Clause] = Field(default_factory=list)
    should: list[Clause] = Field(default_factory=list)
    minimum_should_match: int = Field(default=1, ge=1)

    @model_validator(mode="after")
    def valid_should(self):
        if self.should and self.minimum_should_match > len(self.should):
            raise ValueError("minimum_should_match exceeds should clause count")
        return self


class FunnelStage(BaseModel):
    id: str = Field(min_length=1, pattern=r"^[A-Za-z0-9_-]+$")
    kind: Literal["INCLUSAO", "EXCLUSAO"]
    source_criterion_ids: list[str] = Field(default_factory=list)
    query: BoolQuery


class ClinicalSearchSpec(BaseModel):
    version: Literal[1] = 1
    consultation_id: str = Field(min_length=1)
    as_of: date
    reference_year: int = Field(ge=2000, le=2200)
    diagnosis: DiagnosisSpec
    stages: list[FunnelStage] = Field(min_length=1)
    strata: list[Literal["dx", "age_band", "sex", "uf", "period"]] = Field(
        default_factory=lambda: ["dx", "age_band", "sex", "uf"]
    )

    @model_validator(mode="after")
    def inclusion_first(self):
        if self.stages[0].kind != "INCLUSAO":
            raise ValueError("first funnel stage must be INCLUSAO")
        ids = [s.id for s in self.stages]
        if len(ids) != len(set(ids)):
            raise ValueError("stage ids must be unique")
        return self
