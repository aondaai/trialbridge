"""Data sources.

Two interfaces the estimator depends on:

  BaseCohortSource   -> exact DataSUS aggregate counts by (site, stratum)
  ProprietarySource  -> patient-level proprietary records (covariates + depth)

The synthetic implementations below let you validate the method today. In
production, implement the same two interfaces with DuckDB queries over OMOP:

  * BaseCohortSource.records(): SELECT establishment/region, dx, age_band, sex,
      COUNT(DISTINCT person_id) FROM datasus_omop ... GROUP BY ...
  * ProprietarySource.patients(): row-level proprietary OMOP with depth features
      derived from condition/measurement/drug_exposure + assertion.

Covariate stratum used for standardization = (dx, age_band, sex).
Geography (site/region) is carried on the DataSUS side only.

The synthetic world is built so depth-eligibility DEPENDS ON AGE (younger =>
more eligible). The proprietary sample skews YOUNG and DataSUS skews OLD, so a
naive overall rate is biased and standardization is what corrects it — exactly
the situation the real system faces.
"""
from __future__ import annotations
import random
from dataclasses import dataclass
from typing import Dict, List, Tuple

Stratum = Tuple[str, str, str]  # (dx, age_band, sex)

AGE_BANDS = ["18-39", "40-49", "50-59", "60-69", "70+"]
SEXES = ["F", "M"]

# Younger patients tend to be earlier-stage / better performance status.
AGE_FACTOR = {"18-39": 1.15, "40-49": 1.07, "50-59": 1.00, "60-69": 0.90, "70+": 0.80}

# Base (age-50-59) depth-feature rates by dx — the ground truth DataSUS can't see.
TRUE_RATES = {
    "breast_cancer": {"her2_pos": 0.18, "stage_le2": 0.55, "ecog_le1": 0.70, "autoimmune": 0.08},
    "lung_cancer":   {"her2_pos": 0.02, "stage_le2": 0.30, "ecog_le1": 0.55, "autoimmune": 0.06},
}


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def _make_patient(rng: random.Random, dx: str, age_band: str) -> dict:
    r = TRUE_RATES[dx]
    af = AGE_FACTOR[age_band]
    p_stage = _clamp(r["stage_le2"] * af)
    p_ecog = _clamp(r["ecog_le1"] * af)
    stage = rng.choice([1, 2]) if rng.random() < p_stage else rng.choice([3, 4])
    ecog = rng.choice([0, 1]) if rng.random() < p_ecog else rng.randint(2, 4)
    sex = "F" if (dx == "breast_cancer" and rng.random() < 0.99) else rng.choice(SEXES)
    return {
        "dx": dx,
        "age_band": age_band,
        "sex": sex,
        "her2": rng.random() < r["her2_pos"],
        "stage": stage,
        "ecog": ecog,
        "prior_lines": rng.choice([0, 0, 1, 1, 2, 3]),
        "autoimmune": rng.random() < r["autoimmune"],
    }


def _weighted_age(rng: random.Random, weights: Dict[str, float]) -> str:
    bands = list(weights.keys())
    cum, x, acc = [], rng.random() * sum(weights.values()), 0.0
    for b in bands:
        acc += weights[b]
        if x <= acc:
            return b
    return bands[-1]


@dataclass
class BaseRecord:
    site: str
    region: str
    dx: str
    age_band: str
    sex: str
    count: int


class BaseCohortSource:
    def records(self) -> List[BaseRecord]:
        raise NotImplementedError


class ProprietarySource:
    def patients(self) -> List[dict]:
        raise NotImplementedError


class SyntheticProprietary(ProprietarySource):
    """Proprietary patients drawn from the age-dependent ground truth.

    `young_skew=True` gives the proprietary population a YOUNG age mix (unlike
    DataSUS), so an unstandardized overall rate over-states eligibility.
    """
    # young-skewed age mix
    AGE_W_YOUNG = {"18-39": 0.20, "40-49": 0.28, "50-59": 0.27, "60-69": 0.18, "70+": 0.07}
    # near-uniform (used for building a large "truth" reference)
    AGE_W_FLAT = {b: 0.2 for b in AGE_BANDS}

    def __init__(self, n_per_dx: int = 1500, seed: int = 7, young_skew: bool = True):
        self.n_per_dx, self.seed, self.young_skew = n_per_dx, seed, young_skew

    def patients(self) -> List[dict]:
        rng = random.Random(self.seed)
        w = self.AGE_W_YOUNG if self.young_skew else self.AGE_W_FLAT
        out: List[dict] = []
        for dx in TRUE_RATES:
            for _ in range(self.n_per_dx):
                out.append(_make_patient(rng, dx, _weighted_age(rng, w)))
        return out


class RealProprietary(ProprietarySource):
    """Real depth-feature patients extracted from iHealth's proprietary NLP output.

    Source: raw ES-dump JSONL under `<ihealth-es-data>/cn-backup-mt/<hospital>/*/*.jsonl`
    (904GB total across all hospitals — NOT queried live here; extracted once per hospital
    into a small local parquet via a DuckDB read_ndjson pass, see
    outputs/trialbridge_estimator/extract_depth_features.sql-equivalent). Each JSONL record
    carries `preds.biomarkers[]` (structured, LOINC-coded: e.g. normalized_entity="HER2",
    result.detection_status="POS"/"NEG") and `preds.clinical_entities[]` (label-tagged spans
    with an assertion layer — PRESENTE/AUSENTE — e.g. label="SCALE", entity="ECOG 2"). This
    is the real proprietary NLP->OMOP-style depth layer the PRD's Enrichment Layer consumes;
    HER2/ECOG/metastatic status here are pattern-extracted from that structure, not modeled.

    Covers all 14 hospitals with C50.x patients (28,490 of 28,490 — full national coverage
    of what the flattened parquet_ihealth index identified). HER2 and ECOG are genuinely
    missing (not just unlabeled) for most patients — 32% have a stated HER2 result, 14% a
    stated ECOG, 8% both — this is real-world documentation sparsity, not synthetic
    missingness; the estimator's shrinkage exists precisely for strata this thin. Coverage is
    heavily skewed toward one hospital ('ha': 19,055 of 28,490 patients, and nearly all of the
    ECOG-complete cases — most other hospitals barely document ECOG at all, e.g. 'felicio' has
    648 patients with a stated HER2 result but only 1 with both HER2 and ECOG stated). A
    national depth-rate table today is really "mostly-ha, thin-everywhere-else" — the
    shrinkage toward pooled rates is doing real work, not a formality.

    dx is fixed to "breast_cancer" for all rows (the extraction was pre-filtered on
    primary_icd LIKE 'C50%'). age_band uses the SAME reference_year/bucket edges as
    DuckDBDataSUS so strata line up for standardization.
    """

    def __init__(self, parquet_paths: List[str], reference_year: int = 2025,
                 complete_cases_only: bool = True):
        """complete_cases_only=True (default) drops patients missing HER2 or ECOG before
        returning them. Criterion.test() in schema.py has no "exclude from denominator"
        semantics for an unknown value on a PRESENT-assertion criterion — it counts unknown
        as a fail — so feeding it patients with unstated HER2/ECOG would silently understate
        the joint depth rate (documentation sparsity misread as true-negative). Of 19,055
        patients, 7,300 have a stated HER2 result, 3,127 a stated ECOG, and 2,083 have BOTH
        — that complete-case set is what backs the fitted rate; report the missingness
        separately, don't let it leak into the rate itself."""
        self.parquet_paths = parquet_paths
        self.reference_year = reference_year
        self.complete_cases_only = complete_cases_only
        self._cache: List[dict] | None = None

    def patients(self) -> List[dict]:
        if self._cache is not None:
            return self._cache
        self._cache = self._query()
        return self._cache

    def _query(self) -> List[dict]:
        import duckdb

        con = duckdb.connect()
        glob = ", ".join(f"'{p}'" for p in self.parquet_paths)
        # complete_cases_only gates HER2/ECOG only (see docstring) — NOT autoimmune.
        # autoimmune is an exclusion criterion, tested with assertion="ABSENT" in
        # schema.py: Criterion.test() treats an unmentioned (None) field as PASSING
        # for an ABSENT-assertion criterion, which is the right default here ("never
        # documented" is conservatively read as "not present"). Filtering it to
        # complete cases would just throw away real AUSENTE/PRESENTE signal for no
        # benefit — the None-handling already does the honest thing.
        where_extra = "AND her2 IS NOT NULL AND ecog IS NOT NULL" if self.complete_cases_only else ""
        rows = con.execute(f"""
            SELECT sex, birth_year, her2, ecog, metastatic, autoimmune,
                   regexp_extract(filename, '([a-z_]+)_breast_cancer', 1) AS site
            FROM read_parquet([{glob}], filename=true)
            WHERE sex IN ('F', 'M') AND birth_year IS NOT NULL {where_extra}
        """).fetchall()
        con.close()

        out: List[dict] = []
        for sex, birth_year, her2, ecog, metastatic, autoimmune, site in rows:
            age = self.reference_year - birth_year
            if age < 18:
                continue
            if age <= 39:
                age_band = "18-39"
            elif age <= 49:
                age_band = "40-49"
            elif age <= 59:
                age_band = "50-59"
            elif age <= 69:
                age_band = "60-69"
            else:
                age_band = "70+"
            out.append({
                "dx": "breast_cancer",
                "age_band": age_band,
                "sex": sex,
                "her2": her2,          # True / False / None (unknown, per D3 tri-state)
                "ecog": ecog,          # int 0-4 or None
                "metastatic": bool(metastatic),
                "autoimmune": autoimmune,  # True (PRESENTE/HISTORICO) / False (AUSENTE) / None
                "site": site,          # hospital code, e.g. "ha" — for observed_n_by_site
            })
        return out


class DuckDBDataSUS(BaseCohortSource):
    """Exact DataSUS base cohort from the real ihealth_omop_sus OMOP export.

    Source: gs://omop-sus/exports/ihealth_omop_sus/{condition_occurrence,person}
    (real national SUS data: person has ~63M rows across 192 parts, condition_occurrence
    ~890M rows across 500 parts). `parquet_dir` points at a local mirror of those tables
    (folders of part-*.parquet) — this environment's duckdb/gcloud auth can't do
    authenticated gs:// reads directly (no GCS HMAC key granted), so a `gcloud storage cp`
    mirror stands in for it. Nothing about the query changes if this later points at gs://
    with a working DuckDB GCS secret, or at BigQuery.

    dx is resolved from `condition_source_value` (raw CID-10, e.g. "C509"), matched by
    ICD-10 chapter prefix in `dx_cid_prefixes` — no reliance on condition_concept_id, which
    in this export is frequently unmapped/0 for many source rows.

    Region = person.location_uf_value (Brazilian state, UF) — real, exact, verified non-null
    for the national population. `site` is reported at the SAME state-level granularity for
    now (labelled "DataSUS — {UF}") — NOT a CNES/facility. True facility-level attribution
    needs a per-encounter join (condition_occurrence.visit_occurrence_id -> visit_occurrence
    .care_site_id -> care_site.care_site_name): person.care_site_id and apac_person
    .care_site_id are both 100% NULL in this export (verified), so no person-level shortcut
    exists. visit_occurrence itself is real but far larger than assumed from its part count
    (2201 parts, several tens of GB, highly uneven part sizes from ~2KB to ~40MB) — CNES-level
    resolution is deferred to when that join is worth the transfer, not a synthetic gap.
    """

    AGE_BAND_SQL = """
        CASE
            WHEN age IS NULL THEN NULL
            WHEN age < 18 THEN NULL
            WHEN age <= 39 THEN '18-39'
            WHEN age <= 49 THEN '40-49'
            WHEN age <= 59 THEN '50-59'
            WHEN age <= 69 THEN '60-69'
            ELSE '70+'
        END
    """

    def __init__(self, parquet_dir: str, dx_cid_prefixes: Dict[str, List[str]],
                 reference_year: int = 2025, min_cell: int = 5):
        """parquet_dir must contain condition_occurrence/ and person/ subfolders (or point at
        gs://.../ihealth_omop_sus once GCS auth is wired), each holding that table's
        part-*.parquet files. dx_cid_prefixes maps a dx label to the CID-10 prefixes that
        define it, e.g. {"breast_cancer": ["C50"], "lung_cancer": ["C33", "C34"]}."""
        self.parquet_dir = parquet_dir.rstrip("/")
        self.dx_cid_prefixes = dx_cid_prefixes
        self.reference_year = reference_year
        self.min_cell = min_cell
        self._cache: List[BaseRecord] | None = None
        self._incidence_cache: Dict[str, Dict[str, float]] = {}

    def _glob(self, table: str) -> str:
        return f"{self.parquet_dir}/{table}/*.parquet"

    def records(self) -> List[BaseRecord]:
        # Memoized: rank_bottlenecks() calls estimate() once per depth criterion, and
        # each estimate() call would otherwise re-run this ~1.6s DuckDB scan from
        # scratch — 5+ reruns per API request for no reason, since the underlying
        # export doesn't change during a server's lifetime.
        if self._cache is not None:
            return self._cache
        self._cache = self._query()
        return self._cache

    def _query(self) -> List[BaseRecord]:
        import duckdb

        con = duckdb.connect()
        con.execute("PRAGMA threads=4")
        dx_cases = " ".join(
            f"WHEN condition_source_value LIKE '{prefix}%' THEN '{dx}'"
            for dx, prefixes in self.dx_cid_prefixes.items()
            for prefix in prefixes
        )
        sql = f"""
            WITH dx_person AS (
                SELECT DISTINCT person_id,
                       CASE {dx_cases} END AS dx
                FROM read_parquet('{self._glob("condition_occurrence")}')
                WHERE CASE {dx_cases} END IS NOT NULL
            ),
            aged AS (
                SELECT
                    p.location_uf_value AS region,
                    dp.dx,
                    ({self.reference_year} - p.year_of_birth) AS age,
                    p.gender_source_value AS sex,
                    p.person_id
                FROM dx_person dp
                JOIN read_parquet('{self._glob("person")}') p USING (person_id)
                WHERE p.gender_source_value IN ('F', 'M')
                  AND p.year_of_birth IS NOT NULL
                  AND p.location_uf_value IS NOT NULL
                  AND ({self.reference_year} - p.year_of_birth) >= 18
            )
            SELECT
                region,
                dx,
                {self.AGE_BAND_SQL} AS age_band,
                sex,
                COUNT(DISTINCT person_id) AS n
            FROM aged
            GROUP BY 1, 2, 3, 4
        """
        rows = con.execute(sql).fetchall()
        con.close()

        out: List[BaseRecord] = []
        for region, dx, age_band, sex, n in rows:
            if n < self.min_cell:
                continue  # min-cell suppression (P0 requirement) — drop, don't zero
            # site = region for now (see class docstring: facility-level needs the
            # visit_occurrence join, out of today's transfer budget).
            out.append(BaseRecord(site=f"DataSUS — {region}", region=region,
                                   dx=dx, age_band=age_band, sex=sex, count=int(n)))
        return out

    # Stable window for incidence (see monthly_incidence_by_region docstring): avoids
    # both the data-onboarding backfill artifact at the start of the export and
    # potential right-censoring (reporting lag) in the most recent months.
    INCIDENCE_WINDOW = ("2023-07-01", "2025-07-01")  # [start, end), 24 months

    def monthly_incidence_by_region(self, dx: str) -> Dict[str, float]:
        """Real average monthly rate of NEW (first-ever-seen) `dx` diagnoses per region —
        the volume side of fill-speed, distinct from `records()`'s point-in-time prevalence.

        Uses MIN(condition_start_date) per person as their incidence date, restricted to
        `INCIDENCE_WINDOW`. That window is a real, verified finding, not an arbitrary
        default: the raw first-diagnosis-date distribution has a massive spike in
        2023-01 (30,928 nationally vs. ~10-20k/month steady-state either side) that is
        obviously a data-onboarding backfill, not real incidence, and the export's
        first five months (2022-08 to 2022-12) ramp up from near-zero for the same
        reason. The most recent 1-3 months of any date-stamped clinical export also
        commonly under-count from reporting lag, so the window's end is set two months
        before the export's actual max date (2025-10) rather than running to the edge.
        Verified stable in this window: SP ~2,401/mo, MG ~1,445/mo, RJ ~828/mo, etc. —
        smooth, population-plausible, no visible seasonal cliff.

        Memoized per dx, same reasoning as records(): fill_speed() gets called on
        every /feasibility/estimate and /soften request, and this query doesn't
        change between them.
        """
        if dx in self._incidence_cache:
            return self._incidence_cache[dx]
        result = self._query_incidence(dx)
        self._incidence_cache[dx] = result
        return result

    def _query_incidence(self, dx: str) -> Dict[str, float]:
        import duckdb

        con = duckdb.connect()
        prefixes = self.dx_cid_prefixes[dx]
        dx_filter = " OR ".join(f"condition_source_value LIKE '{p}%'" for p in prefixes)
        start, end = self.INCIDENCE_WINDOW
        n_months = 24  # matches INCIDENCE_WINDOW; update together if the window changes
        sql = f"""
            WITH first_dx AS (
                SELECT person_id, min(condition_start_date) AS first_date
                FROM read_parquet('{self._glob("condition_occurrence")}')
                WHERE {dx_filter}
                GROUP BY person_id
            ),
            windowed AS (
                SELECT f.person_id, p.location_uf_value AS region
                FROM first_dx f
                JOIN read_parquet('{self._glob("person")}') p USING (person_id)
                WHERE f.first_date >= DATE '{start}' AND f.first_date < DATE '{end}'
                  AND p.location_uf_value IS NOT NULL
            )
            SELECT region, count(*) AS n
            FROM windowed GROUP BY 1
        """
        rows = con.execute(sql).fetchall()
        con.close()
        return {region: n / n_months for region, n in rows}


class SyntheticDataSUS(BaseCohortSource):
    """National aggregate counts across a few real-named sites/regions.

    DataSUS age mix skews OLD — the opposite of the proprietary sample.
    """
    SITES = [("HC-FMUSP", "SP"), ("INCA", "RJ"), ("HCPA", "RS")]
    AGE_W_OLD = {"18-39": 0.06, "40-49": 0.14, "50-59": 0.24, "60-69": 0.30, "70+": 0.26}

    def __init__(self, seed: int = 3):
        self.seed = seed

    def records(self) -> List[BaseRecord]:
        rng = random.Random(self.seed)
        site_scale = {"HC-FMUSP": 1.0, "INCA": 0.8, "HCPA": 0.5}
        dx_base = {"breast_cancer": 4000, "lung_cancer": 3000}
        recs: List[BaseRecord] = []
        for site, region in self.SITES:
            for dx, base in dx_base.items():
                total = int(base * site_scale[site] * (0.9 + 0.2 * rng.random()))
                for age, w in self.AGE_W_OLD.items():
                    for sex in SEXES:
                        sw = 0.97 if (dx == "breast_cancer" and sex == "F") else (
                            0.03 if dx == "breast_cancer" else 0.5)
                        c = int(total * w * sw)
                        if c > 0:
                            recs.append(BaseRecord(site, region, dx, age, sex, c))
        return recs
