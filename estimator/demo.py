"""End-to-end demo of the TrialBridge feasibility estimator.

Run:  python demo.py

Shows, for a Phase II HER2+ breast-cancer protocol:
  1. exact DataSUS base cohort (checkable criteria) by site
  2. estimated eligible patients (enriched) by site, with 95% CI
  3. national total
  4. why standardization matters (standardized vs naive overall rate)
  5. protocol-softening / bottleneck ranking
"""
from trialbridge.schema import Criterion, Protocol
from trialbridge.data import SyntheticDataSUS, SyntheticProprietary
from trialbridge.estimator import estimate, national_total, rank_bottlenecks


def demo_protocol() -> Protocol:
    return Protocol(
        protocol_id="DEMO-HER2-BC-P2",
        criteria=[
            # --- DataSUS-checkable (exact) ---
            Criterion("inc_dx", "Histologically confirmed breast cancer",
                      "inclusion", "checkable", "dx", "in", ["breast_cancer"]),
            Criterion("inc_sex", "Female", "inclusion", "checkable", "sex", "eq", "F"),
            Criterion("inc_age", "Adults 18-69", "inclusion", "checkable",
                      "age_band", "in", ["18-39", "40-49", "50-59", "60-69"]),
            # --- Depth (estimated via enrichment) ---
            Criterion("inc_her2", "HER2-positive", "inclusion", "depth", "her2", "is_true"),
            Criterion("inc_stage", "Stage I-II", "inclusion", "depth", "stage", "lte", 2),
            Criterion("inc_ecog", "ECOG performance status 0-1", "inclusion", "depth", "ecog", "lte", 1),
            Criterion("exc_autoimmune", "No active autoimmune disease", "exclusion",
                      "depth", "autoimmune", "is_false", assertion="ABSENT"),
        ],
    )


def naive_national(protocol, datasus, proprietary) -> float:
    """UNSTANDARDIZED baseline: apply one overall proprietary depth rate to the
    whole base cohort (ignores covariate mix). Shown only to expose its bias."""
    pts = [p for p in proprietary.patients() if p["dx"] == "breast_cancer"]
    pred = protocol.depth_predicate()
    rate = sum(1 for p in pts if pred(p)) / len(pts)
    total_base = sum(s.base_cohort for s in estimate(protocol, datasus, proprietary))
    return total_base * rate


def main() -> None:
    protocol = demo_protocol()
    datasus = SyntheticDataSUS()
    proprietary = SyntheticProprietary(n_per_dx=1500, seed=7, young_skew=True)

    print(f"\nProtocol {protocol.protocol_id}")
    print("  checkable:", ", ".join(c.field for c in protocol.checkable()))
    print("  depth    :", ", ".join(c.field for c in protocol.depth()))

    ests = estimate(protocol, datasus, proprietary)
    print("\nTrial -> sites (ranked by estimated eligible):")
    for s in ests:
        print("  " + str(s))

    nat, lo, hi = national_total(ests)
    print(f"\nNational estimated eligible: {nat:,.0f}  (95% CI {lo:,.0f}-{hi:,.0f})")

    # transportability demonstration
    naive = naive_national(protocol, datasus, proprietary)
    truth_ref = SyntheticProprietary(n_per_dx=40000, seed=999, young_skew=False)
    truth = national_total(estimate(protocol, datasus, truth_ref))[0]
    print("\nWhy standardization matters (national eligible):")
    print(f"  standardized (this engine): {nat:,.0f}")
    print(f"  naive overall rate        : {naive:,.0f}   <- biased by proprietary age mix")
    print(f"  reference 'truth'         : {truth:,.0f}")
    print(f"  |standardized - truth| = {abs(nat-truth):,.0f}   "
          f"|naive - truth| = {abs(naive-truth):,.0f}")

    print("\nProtocol softening — pool gain if a criterion is relaxed (bottleneck ranking):")
    for b in rank_bottlenecks(protocol, datasus, proprietary):
        print(f"  {b.criterion_id:<16} {b.text:<32} +{b.gain:,.0f}  "
              f"({b.baseline_total:,.0f} -> {b.softened_total:,.0f})")


if __name__ == "__main__":
    main()
