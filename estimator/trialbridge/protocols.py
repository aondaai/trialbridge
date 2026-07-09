"""Concrete Protocol definitions. Split out of demo_real.py so both the CLI demo
and the API can import a protocol without triggering CLI argument parsing."""
from __future__ import annotations

from .schema import Criterion, Protocol


def hero_protocol_real() -> Protocol:
    """The real HER2+ metastatic breast cancer criteria we can actually check
    against the current extraction pass (HER2, ECOG, metastatic, autoimmune-exclusion).
    Organ function, prior lines, brain mets, LVEF are in the full hero-protocol.ts
    but have no extracted signal here yet — left out rather than faked.

    exc_autoimmune validates the PRD's negative/exclusion-criterion path with real
    data: assertion="ABSENT" means Criterion.test() treats a patient with no
    autoimmune mention at all (None) as PASSING — the conservative default for
    "never documented" on an exclusion criterion — while a real AUSENTE-asserted
    mention also passes and a real PRESENTE/HISTORICO-asserted mention fails.
    """
    return Protocol(
        protocol_id="HER2-MBC-REAL",
        criteria=[
            Criterion("inc_dx", "Histologically confirmed breast cancer",
                      "inclusion", "checkable", "dx", "in", ["breast_cancer"]),
            Criterion("inc_sex", "Female", "inclusion", "checkable", "sex", "eq", "F"),
            Criterion("inc_her2", "HER2-positive (IHC 3+ / ISH-amplified)",
                      "inclusion", "depth", "her2", "is_true"),
            Criterion("inc_ecog", "ECOG performance status 0-1",
                      "inclusion", "depth", "ecog", "lte", 1),
            Criterion("inc_met", "Metastatic (stage IV) disease",
                      "inclusion", "depth", "metastatic", "is_true"),
            Criterion("exc_autoimmune", "No active autoimmune disease",
                      "exclusion", "depth", "autoimmune", "is_false", assertion="ABSENT"),
        ],
    )
