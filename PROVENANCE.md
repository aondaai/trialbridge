# Provenance — where every number comes from

*So that no figure on screen is a black box. Detailed mapping lives in
[`docs/provenance-map.md`](docs/provenance-map.md); this is the top-level summary.*

## The estimate

```
estimated_eligible[site] = Σ_strata ( DataSUS_base_count[site, stratum] × depth_rate[stratum] )
```

- **`DataSUS_base_count`** — exact base cohort per site/region and demographic stratum, from the
  **public DataSUS** aggregates shipped in this repo. This is a count, not a model.
- **`depth_rate`** — the fraction of a base stratum that also meets the deeper eligibility criteria
  (HER2, stage, ECOG, prior lines, negations), fitted from the **private iHealth NLP base** and
  **shrunk** (empirical-Bayes) for thin strata. Only the *rates* are used, never individual records.
- **Standardization** — because the depth rates are weighted by DataSUS stratum counts, the estimate
  is **direct-standardized to the national population**; the private population's own age/sex mix
  drops out. Every estimate carries a **95% Wilson confidence interval**.

## Provenance labels shipped with each answer

- **Coverage label** — today the 27-UF state coverage is a **labeled placeholder**, not
  calibration-earned. The `/query` response says so in-band. See the honest-limits section of the
  [README](README.md).
- **Base vs. depth** — every criterion is tagged *checkable* (run exactly by the deterministic
  matcher) or *depth* (estimated via standardized rate). The parser↔engine contract enforces this.
- **Cell suppression** — aggregated counts below 5 render as `<5`.

## Chain of custody for the pipeline

Raw local mirrors (DataSUS 163GB · proprietary 58GB) → materialization scripts →
**PHI-safe JSON aggregates** (the only data that leaves the local machine) → estimator →
governed `/query` API (bearer-token gated) → web app card + Brazil map + MCP tool.
No raw or row-level data is deployed to the cloud at any step.
