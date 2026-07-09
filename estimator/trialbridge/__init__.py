"""TrialBridge feasibility estimator (hackathon scaffold).

Core idea: estimated eligible patients = exact DataSUS base cohort
           x proprietary-derived depth-eligibility fraction,
           standardized to the DataSUS population, with a confidence interval.

Pure standard library so it runs anywhere. Swap the synthetic data sources in
data.py for DuckDB-over-OMOP queries without touching estimator.py.
"""

__all__ = ["schema", "stats", "data", "enrichment", "estimator"]
