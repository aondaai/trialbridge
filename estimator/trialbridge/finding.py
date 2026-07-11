"""Finding-level Observed N by site (strategy: "Observed N -> site feasibility").

Counts real patients matching a protocol's CHECKABLE criteria (dx, sex, age) per
site, from an aggregate source of (dx, age_band, sex, site, count) strata. This is
the demographic/diagnosis-level feasibility number — "how many breast-cancer women
does each hospital have on record" — distinct from the depth-refined Observed N
(observed_n_by_site over the extracted her2/ecog features) which answers the full
protocol including biomarkers.

Source-agnostic: any object with a `.records() -> List[BaseRecord]` works
(FullProprietary over the 6.68M iHealth base, or a synthetic stub in tests).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

from .schema import Protocol


@dataclass
class SiteFinding:
    site: str
    with_dx: int      # distinct patients with the diagnosis (any age/sex) at this site
    finding_n: int    # of those, how many pass ALL checkable criteria (dx + demographics)

    def __str__(self) -> str:
        return f"{self.site:<14} with_dx={self.with_dx:>7,}  finding_N={self.finding_n:>7,}"


def finding_n_by_site(protocol: Protocol, source) -> List[SiteFinding]:
    checkable = protocol.checkable()
    dx_checks = [c for c in checkable if c.field == "dx"]  # for with_dx (diagnosis only)
    agg: Dict[str, List[int]] = {}  # site -> [with_dx, finding_n]
    for r in source.records():
        d = agg.setdefault(r.site, [0, 0])
        rec = {"dx": r.dx, "age_band": r.age_band, "sex": r.sex}
        # with_dx: patients matching only the protocol's diagnosis criterion (any age/sex).
        # A multi-dx source (e.g. breast + lung strata) must NOT mix other diagnoses in.
        if all(c.test(rec) for c in dx_checks):
            d[0] += r.count
        # finding_n: patients matching ALL checkable criteria (dx + demographics).
        if all(c.test(rec) for c in checkable):
            d[1] += r.count
    out = [SiteFinding(site=s, with_dx=v[0], finding_n=v[1]) for s, v in agg.items()]
    out.sort(key=lambda s: s.finding_n, reverse=True)
    return out
