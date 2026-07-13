"""query_datasus + build_pack — Agent 3's host tools. Reuses DuckDBDataSUS. Spec §4.3, §6.
Aggregate-only. depth_ratio comes from the proprietary SUS-slice (passed in by the caller)."""
from __future__ import annotations
import math
import re
from ..schemas import (SearchSpec, DataSUSCounts, UFCohort, ProprietaryCounts,
                       FeasibilityPack, UFEstimate)

_ICD_SAFE = re.compile(r"[^A-Za-z0-9.]")

def _dx_prefixes(spec: SearchSpec) -> dict:
    raw = spec.dx.get("cid_prefixes") or []
    # ICD codes are [A-Za-z0-9.]; strip anything else (defends the interpolated LIKE).
    cid = [_ICD_SAFE.sub("", str(p)) for p in raw]
    cid = [p for p in cid if p]
    # dx label is interpolated into `THEN '<label>'` — drop single quotes to keep the SQL valid.
    label = str((spec.dx.get("concepts") or ["target"])[0]).replace("'", "")
    return {label: cid}

def query_datasus(spec: SearchSpec, *, datasus_dir: str) -> DataSUSCounts:
    from trialbridge.data import DuckDBDataSUS
    prefixes = _dx_prefixes(spec)
    # Generality/§7: a condition not in the concept-map may have no ICD prefixes.
    # Return an empty cohort (build_pack then yields a valid pack + honest caveat)
    # instead of letting DuckDBDataSUS build invalid `CASE  END` SQL and crash.
    if not any(prefixes.values()):
        return DataSUSCounts(by_uf=[], provenance={
            "source": datasus_dir, "dx_prefixes": prefixes,
            "note": "no cid_prefixes for dx — empty SUS cohort"})
    src = DuckDBDataSUS(
        parquet_dir=datasus_dir,
        dx_cid_prefixes=prefixes,
        # min_cell=1: DuckDBDataSUS suppresses at the (UF x dx x age_band x sex) STRATUM
        # level, but query_datasus only ever exposes the per-UF SUM of those strata — so
        # stratum-level suppression here would UNDERCOUNT real per-UF totals, not protect
        # anything. We therefore bypass it and keep all strata for an accurate cohort.
        # RESIDUAL RISK: no floor is applied to the exposed per-UF total itself. For a
        # common dx (e.g. C50) UF totals are large, but a RARE dx in a low-population UF
        # could yield a small (potentially identifying) per-UF count. A UF-level suppression
        # floor on the exposed output is a tracked follow-up (would change the fixture's
        # mandated exact-count test, so out of scope here).
        min_cell=1
    )
    per_uf: dict[str, int] = {}
    for rec in src.records():
        per_uf[rec.region] = per_uf.get(rec.region, 0) + int(rec.count)
    by_uf = [UFCohort(uf=uf, base_cohort=n) for uf, n in sorted(per_uf.items())]
    return DataSUSCounts(by_uf=by_uf,
                         provenance={"source": datasus_dir, "dx_prefixes": prefixes})

def query_materialized_datasus(spec: SearchSpec, *, base_dir: str) -> DataSUSCounts:
    """Read the national, aggregate DataSUS cohort materialized by diagnosis.

    The local CMA must not use ``omop_sample`` for sponsor estimates.  This adapter
    selects the diagnosis whose configured CID prefixes match the reviewed protocol
    and returns only UF-level aggregates; no patient rows leave the source.
    """
    from trialbridge.data import MaterializedDataSUS

    src = MaterializedDataSUS(base_dir)
    requested_prefixes = {
        prefix.upper() for prefixes in _dx_prefixes(spec).values() for prefix in prefixes
    }
    requested_concepts = {
        str(concept) for concept in (spec.dx.get("concepts") or []) if concept
    }
    configured = src.provenance.get("dx_cid_prefixes", {})
    matching_concepts = {
        concept for concept, prefixes in configured.items()
        if concept in requested_concepts
        or bool(requested_prefixes.intersection(str(prefix).upper() for prefix in prefixes))
    }
    if not matching_concepts:
        return DataSUSCounts(by_uf=[], provenance={
            **src.provenance,
            "source": src.provenance.get("source", base_dir),
            "materialized_path": base_dir,
            "requested_cid_prefixes": sorted(requested_prefixes),
            "note": "diagnosis is not present in the materialized DataSUS cohort",
        })

    per_uf: dict[str, int] = {}
    for rec in src.records():
        if rec.dx in matching_concepts:
            per_uf[rec.region] = per_uf.get(rec.region, 0) + int(rec.count)
    by_uf = [UFCohort(uf=uf, base_cohort=n) for uf, n in sorted(per_uf.items())]
    return DataSUSCounts(by_uf=by_uf, provenance={
        **src.provenance,
        "source": src.provenance.get("source", base_dir),
        "materialized_path": base_dir,
        "matched_concepts": sorted(matching_concepts),
        "requested_cid_prefixes": sorted(requested_prefixes),
        "source_type": "materialized_national_aggregate",
    })

def _wilson_band(n: int, p: float) -> tuple[float, float]:
    """Simple ±1.96·sqrt(p(1-p)/n) band on the eligible estimate (n·p)."""
    if n == 0:
        return (0.0, 0.0)
    se = math.sqrt(max(p * (1 - p), 1e-9) / n)
    lo = max(0.0, (p - 1.96 * se)) * n
    hi = min(1.0, (p + 1.96 * se)) * n
    return (round(lo, 2), round(hi, 2))

def build_pack(spec: SearchSpec, datasus: DataSUSCounts, proprietary: ProprietaryCounts,
               *, depth_ratio: float | None) -> FeasibilityPack:
    if depth_ratio is None:
        depth_ratio = proprietary.depth_ratios.get("sus_depth_ratio")
    eligibility_fraction_applied = depth_ratio is not None
    p = depth_ratio if eligibility_fraction_applied else 1.0
    per_uf: list[UFEstimate] = []
    nat = 0.0
    for u in datasus.by_uf:
        est = round(u.base_cohort * p, 2)
        lo, hi = _wilson_band(u.base_cohort, p)
        per_uf.append(UFEstimate(uf=u.uf, base_cohort=u.base_cohort,
                                 est_eligible=est, ci_lo=lo, ci_hi=hi))
        nat += est
    ratio_basis = proprietary.depth_ratios.get("ratio_basis")
    caveat = (("Depth criteria measured in an NCT-specific preselected demo cohort "
               f"(p={p}); this cohort is not a population-wide scan. ")
              if ratio_basis == "nct_preselected_demo_cohort" else
              ("Depth criteria estimated from an overall structured proprietary proxy, "
               "not a SUS-specific slice " f"(p={p}). ") if ratio_basis else
              "Depth criteria estimated from proprietary SUS-slice ratio "
              f"(p={p}). " if depth_ratio is not None else
              "No depth ratio available — estimate is the raw SUS base cohort. ")
    if any(t.method == "text_proxy" for t in proprietary.tier2_coverage):
        caveat += "Some criteria resolved by free-text proxy (see tier2_coverage). "
    inventory_signal = proprietary.provenance.get("source_type") in {
        "inventory_csv", "nct_preselected_elasticsearch_cohort",
    }
    signal_n = proprietary.n_total if inventory_signal else proprietary.by_payer.private
    signal_note = (
        "Proprietary candidate patients awaiting clinical eligibility review."
        if inventory_signal else "Supplementary-health patients DataSUS cannot observe."
    )
    if inventory_signal:
        caveat += (" Proprietary counts are capped document-search matches and must not be "
                   "reported as confirmed eligible patients.")
    return FeasibilityPack(
        nct=spec.nct,
        per_uf_eligible=per_uf,
        national={"est_eligible": round(nat, 2),
                  "ci_lo": round(sum(u.ci_lo for u in per_uf), 2),
                  "ci_hi": round(sum(u.ci_hi for u in per_uf), 2)},
        private_population_signal={"n": signal_n, "note": signal_note},
        provenance={
            "datasus": datasus.provenance,
            "proprietary": proprietary.provenance,
            "estimation": {
                "kind": "eligible_estimate" if eligibility_fraction_applied else "base_cohort_only",
                "eligibility_fraction_applied": eligibility_fraction_applied,
                "eligibility_fraction": depth_ratio,
            },
        },
        coverage_caveat=caveat.strip(),
    )
