"""Pydantic contracts passed between the 3 agents. Aggregate-only — no patient rows."""
from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field

# ---- SearchSpec (Agent 1 output) ----

class TextClause(BaseModel):
    type: Literal["text"] = "text"
    terms: list[str]                         # already-expanded synonyms/acronyms
    operator: Literal["and", "or"] = "or"    # 'or' = synonyms; 'and' = one expression
    phrase: bool = False                     # match_phrase semantics
    slop: int = 0                            # proximity when phrase=True
    tier: Literal[1, 2] = 1                  # 2 = nested-entity criterion resolved by proxy
    label: Optional[str] = None              # concept name for tier2_coverage reporting

class AgeClause(BaseModel):
    type: Literal["age"] = "age"
    min_age: Optional[int] = None
    max_age: Optional[int] = None

class SexClause(BaseModel):
    type: Literal["sex"] = "sex"
    value: Literal["FEMALE", "MALE"]

class PeriodClause(BaseModel):
    type: Literal["period"] = "period"
    within: str                              # e.g. "1y", "6M", "90d"

Clause = TextClause | AgeClause | SexClause | PeriodClause

class BoolQuery(BaseModel):
    must: list[Clause] = Field(default_factory=list)
    filter: list[Clause] = Field(default_factory=list)
    should: list[Clause] = Field(default_factory=list)
    minimum_should_match: int = 1

class FunnelStage(BaseModel):
    kind: Literal["INCLUSAO", "EXCLUSAO"]
    query: BoolQuery

class SearchSpec(BaseModel):
    nct: str
    dx: dict                                 # {concepts:[], cid_prefixes:[], snomed:[]}
    stages: list[FunnelStage]

# ---- ProprietaryCounts (Agent 2 output) ----

class PayerCounts(BaseModel):
    sus: int
    private: int
    unknown: int

class SiteCount(BaseModel):
    hospital: str
    n: int

class ProviderCount(BaseModel):
    provider: str
    hospital: str
    n: int

class Tier2Item(BaseModel):
    criterion: str
    tier: Literal[1, 2]
    method: Literal["structured", "text_proxy"]
    confidence: Literal["high", "proxy"]

class ProprietaryCounts(BaseModel):
    n_total: int
    by_payer: PayerCounts
    by_site: list[SiteCount]
    by_provider: list[ProviderCount] = Field(default_factory=list)
    depth_ratios: dict = Field(default_factory=dict)
    tier2_coverage: list[Tier2Item] = Field(default_factory=list)
    provenance: dict

# ---- DataSUS + FeasibilityPack (Agent 3) ----

class UFCohort(BaseModel):
    uf: str
    base_cohort: int

class DataSUSCounts(BaseModel):
    by_uf: list[UFCohort]
    provenance: dict

class UFEstimate(BaseModel):
    uf: str
    base_cohort: int
    est_eligible: float
    ci_lo: float
    ci_hi: float

class FeasibilityPack(BaseModel):
    nct: str
    per_uf_eligible: list[UFEstimate]
    national: dict                           # {est_eligible, ci_lo, ci_hi}
    private_population_signal: dict          # {n, note}
    provenance: dict
    coverage_caveat: str
