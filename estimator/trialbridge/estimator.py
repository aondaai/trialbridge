"""Feasibility Estimator.

  estimated eligible[site] = SUM over strata (
       DataSUS_base_count[site, stratum]  x  depth_rate[stratum] )

DataSUS supplies the exact base cohort (after checkable criteria); the
enrichment model supplies the per-stratum depth rate. Because we weight the
proprietary rates by DataSUS stratum counts, the result is direct-standardized
to the DataSUS population — the proprietary population's own mix drops out.

Uncertainty: each stratum contributes base^2 * Var(p) to the variance of the
site total (base counts treated as fixed, rate as estimated). We sum stratum
variances and report a normal-approx 95% interval. Bootstrap is the natural
production upgrade.
"""
from __future__ import annotations
import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Tuple

from .data import BaseCohortSource, BaseRecord, ProprietarySource, Stratum
from .enrichment import EnrichmentModel, FittedRates
from .schema import Protocol
from .stats import Z


@dataclass
class SiteEstimate:
    site: str
    region: str
    base_cohort: int          # exact, DataSUS (after checkable criteria)
    est_eligible: float       # estimated (enriched)
    ci_lo: float
    ci_hi: float
    eff_n: int                # min proprietary stratum sample backing this estimate

    def __str__(self) -> str:
        return (f"{self.site:<10} {self.region:<3} base={self.base_cohort:>6}  "
                f"est≈{self.est_eligible:>7.0f}  95% CI [{self.ci_lo:>6.0f}, {self.ci_hi:>6.0f}]  "
                f"(min n={self.eff_n})")


def _base_by_stratum(records: List[BaseRecord], protocol: Protocol
                     ) -> Dict[str, Dict[Stratum, int]]:
    """Apply checkable criteria to DataSUS; return base counts per site per stratum."""
    checkable = protocol.checkable()
    out: Dict[str, Dict[Stratum, int]] = defaultdict(lambda: defaultdict(int))
    site_region: Dict[str, str] = {}
    for r in records:
        rec = {"dx": r.dx, "age_band": r.age_band, "sex": r.sex}
        if all(c.test(rec) for c in checkable):
            out[r.site][(r.dx, r.age_band, r.sex)] += r.count
            site_region[r.site] = r.region
    _base_by_stratum.site_region = site_region  # type: ignore  # stash for caller
    return out


def estimate(protocol: Protocol,
             datasus: BaseCohortSource,
             proprietary: ProprietarySource,
             exclude_depth_ids: set[str] | None = None,
             shrink_alpha: float = 20.0) -> List[SiteEstimate]:
    """Full trial->site feasibility estimate."""
    records = datasus.records()
    base = _base_by_stratum(records, protocol)
    site_region = _base_by_stratum.site_region  # type: ignore

    model = EnrichmentModel(proprietary.patients(), shrink_alpha=shrink_alpha)
    fitted: FittedRates = model.fit(protocol.depth_predicate(exclude_ids=exclude_depth_ids))

    results: List[SiteEstimate] = []
    for site, strata in base.items():
        est = 0.0
        var = 0.0
        min_n = 10**9
        for stratum, count in strata.items():
            rate = fitted.rate_for(stratum)
            est += count * rate.p
            # variance of count*p with p ~ estimated on eff sample n
            var += (count ** 2) * (rate.p * (1 - rate.p) / rate.n if rate.n > 0 else 0.0)
            if count > 0:
                min_n = min(min_n, rate.raw_n)
        half = Z * math.sqrt(var)
        results.append(SiteEstimate(
            site=site, region=site_region.get(site, "?"),
            base_cohort=sum(strata.values()),
            est_eligible=est, ci_lo=max(0.0, est - half), ci_hi=est + half,
            eff_n=(0 if min_n == 10**9 else min_n),
        ))
    results.sort(key=lambda s: s.est_eligible, reverse=True)
    return results


def national_total(estimates: List[SiteEstimate]) -> Tuple[float, float, float]:
    est = sum(s.est_eligible for s in estimates)
    # independent-site approximation for the aggregate interval
    var = sum(((s.ci_hi - s.est_eligible) / Z) ** 2 for s in estimates)
    half = Z * math.sqrt(var)
    return est, max(0.0, est - half), est + half


@dataclass
class Bottleneck:
    criterion_id: str
    text: str
    baseline_total: float
    softened_total: float
    gain: float


@dataclass
class ObservedSite:
    site: str
    n_patients: int          # total real patients on record at this site (any dx match)
    observed_n: int          # of those, how many pass EVERY criterion — direct count, no model

    def __str__(self) -> str:
        return f"{self.site:<10} n_patients={self.n_patients:>6}  observed_N={self.observed_n}"


def observed_n_by_site(protocol: Protocol, proprietary: ProprietarySource,
                        exclude_depth_ids: set[str] | None = None) -> List[ObservedSite]:
    """Slide 6 / Slide 11's "Observed N" — direct, row-level, highest-confidence count.

    No model, no standardization: for each patient actually on record at a site, test
    every criterion (checkable + depth) against that one row and count who passes all of
    them. This is what a site itself could compute by running the protocol against its
    own patients — it just requires `site` to be present on each patient dict (see
    RealProprietary in data.py). Distinct from `estimate()`, which is the DataSUS-wide
    standardized figure for sites/regions with NO row-level proprietary data at all.

    exclude_depth_ids must match what's passed to estimate()/rank_bottlenecks() for the
    same request — softening a criterion should relax BOTH numbers together, not just
    the standardized one, or the two figures on a scorecard would silently disagree.
    """
    exclude = exclude_depth_ids or set()
    all_criteria = [c for c in protocol.criteria if c.id not in exclude]
    by_site: Dict[str, List[dict]] = defaultdict(list)
    for p in proprietary.patients():
        by_site[p.get("site", "?")].append(p)

    out: List[ObservedSite] = []
    for site, patients in by_site.items():
        passing = sum(1 for p in patients if all(c.test(p) for c in all_criteria))
        out.append(ObservedSite(site=site, n_patients=len(patients), observed_n=passing))
    out.sort(key=lambda s: s.observed_n, reverse=True)
    return out


@dataclass
class RegionFillSpeed:
    region: str
    monthly_incidence: float   # real DataSUS: new (first-ever-seen) dx/month in this region
    eligible_fraction: float   # est_eligible / base_cohort, from estimate()
    monthly_eligible: float    # monthly_incidence * eligible_fraction
    months_to_fill: float | None  # target_n / monthly_eligible; None if monthly_eligible == 0

    def __str__(self) -> str:
        mtf = f"{self.months_to_fill:.1f} mo" if self.months_to_fill is not None else "—"
        return (f"{self.region:<3} incidence={self.monthly_incidence:>7.1f}/mo  "
                f"elig.frac={self.eligible_fraction:>6.2%}  "
                f"elig/mo={self.monthly_eligible:>5.2f}  fill={mtf}")


def fill_speed(protocol: Protocol, datasus, proprietary: ProprietarySource,
               dx: str, target_n: int = 50,
               exclude_depth_ids: set[str] | None = None) -> List[RegionFillSpeed]:
    """Base prevalence + real DataSUS incidence -> months to enroll target_n patients,
    per region. `datasus` must be a DuckDBDataSUS (needs monthly_incidence_by_region();
    not part of the generic BaseCohortSource interface — synthetic sources have no
    real dates to draw incidence from).

    Volume multiplier is estimate()'s standardized eligible fraction (est_eligible /
    base_cohort) applied to the REAL monthly incidence rate: new patients presenting
    each month are assumed to have the same standardized eligibility rate as the
    existing prevalent pool. That's a real assumption, not a certainty — incidence and
    prevalence populations aren't guaranteed identical (e.g. if treatment patterns or
    stage-at-diagnosis shift over time) — stated here, not hidden.
    """
    ests = estimate(protocol, datasus, proprietary, exclude_depth_ids=exclude_depth_ids)
    incidence = datasus.monthly_incidence_by_region(dx)

    out: List[RegionFillSpeed] = []
    for e in ests:
        monthly_inc = incidence.get(e.region, 0.0)
        frac = (e.est_eligible / e.base_cohort) if e.base_cohort > 0 else 0.0
        monthly_elig = monthly_inc * frac
        months = (target_n / monthly_elig) if monthly_elig > 0 else None
        out.append(RegionFillSpeed(region=e.region, monthly_incidence=monthly_inc,
                                    eligible_fraction=frac, monthly_eligible=monthly_elig,
                                    months_to_fill=months))
    out.sort(key=lambda f: (f.months_to_fill is None, f.months_to_fill))
    return out


def national_fill_speed(fill_speeds: List[RegionFillSpeed], target_n: int) -> float | None:
    total_monthly = sum(f.monthly_eligible for f in fill_speeds)
    return (target_n / total_monthly) if total_monthly > 0 else None


def rank_bottlenecks(protocol: Protocol,
                     datasus: BaseCohortSource,
                     proprietary: ProprietarySource) -> List[Bottleneck]:
    """For each DEPTH criterion, how much does the national pool grow if removed?

    Biggest gain = biggest bottleneck (protocol-softening ranking).
    """
    base_est = national_total(estimate(protocol, datasus, proprietary))[0]
    out: List[Bottleneck] = []
    for c in protocol.depth():
        softened = national_total(
            estimate(protocol, datasus, proprietary, exclude_depth_ids={c.id})
        )[0]
        out.append(Bottleneck(c.id, c.text, base_est, softened, softened - base_est))
    out.sort(key=lambda b: b.gain, reverse=True)
    return out
