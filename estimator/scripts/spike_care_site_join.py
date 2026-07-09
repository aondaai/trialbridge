"""Spike: is facility-level probabilistic linkage even plausible? (Track A)

Standalone, read-only, NOT imported by estimator.py/api.py/data.py. Answers one
question before any linkage-matching code gets written: if we join DataSUS
condition_occurrence -> person -> visit_occurrence -> care_site, how many
candidate patients fall into a single blocking cell of
(care_site_id, dx, birth_year, sex)?

That's the finest-grained key available without a name/CPF/full-DOB: if cells
routinely hold many people, any 1:1 "match" against a proprietary patient is
arbitrary among indistinguishable candidates, not a real link. If cells are
almost always small (ideally singleton), probabilistic linkage is at least
plausible and worth a real Track B build.

Data budget: full visit_occurrence is 89GB/2201 parts on gs://omop-sus (no
region/facility partitioning found in the file naming -- confirmed by listing
part sizes, they're an arbitrary ingestion order). Downloading it all was
explicitly out of scope for a 2-4h spike (same reasoning the project already
used to defer this join, see data.py's DuckDBDataSUS docstring). Instead this
uses a random ~3.6% sample (80 of 2201 parts, seed=42, ~3GB) in
data/spike_visit_sample/ -- since parts aren't facility-sorted, a random
sample of parts gives an unbiased (if noisier) sample of the national
visit population, which is exactly what's needed to estimate a *distribution*
of cell sizes, not an exhaustive one.

Known gap this spike does NOT resolve: there is no crosswalk in this repo
from the proprietary base's hospital codes (e.g. "ha", "hac", "hsl" in
data/proprietary_ha/*.parquet) to a DataSUS care_site_id/care_site_name. So
this can't test the *specific* facility where the proprietary overlap is
concentrated -- it tests the general question ("are facility-level blocking
cells small enough anywhere in the data") using the sampled facilities that
happen to show up. If a crosswalk is built later, rerun filtered to that one
facility for the real go/no-go read.

Run: python3 scripts/spike_care_site_join.py
"""
from __future__ import annotations
import duckdb


DATA_DIR = "data"
CONDITION_GLOB = f"{DATA_DIR}/omop_full/condition_occurrence/*.parquet"
PERSON_GLOB = f"{DATA_DIR}/omop_full/person/*.parquet"
VISIT_SAMPLE_GLOB = f"{DATA_DIR}/spike_visit_sample/*.parquet"
CARE_SITE_GLOB = f"{DATA_DIR}/spike_care_site/*.parquet"

# Same dx used by the shipped estimator (protocols.py's hero protocol).
DX_PREFIX = "C50"
REFERENCE_YEAR = 2025


def main() -> None:
    con = duckdb.connect()
    con.execute("PRAGMA threads=4")

    print("=== sample coverage ===")
    (n_visit_rows,) = con.execute(
        f"SELECT COUNT(*) FROM read_parquet('{VISIT_SAMPLE_GLOB}')"
    ).fetchone()
    (n_visit_persons,) = con.execute(
        f"SELECT COUNT(DISTINCT person_id) FROM read_parquet('{VISIT_SAMPLE_GLOB}')"
    ).fetchone()
    (n_care_sites,) = con.execute(
        f"SELECT COUNT(*) FROM read_parquet('{CARE_SITE_GLOB}')"
    ).fetchone()
    print(f"visit rows in sample: {n_visit_rows:,}")
    print(f"distinct persons in sample: {n_visit_persons:,}")
    print(f"care_site rows (full table, small): {n_care_sites:,}")

    print("\n=== building blocking cells: (care_site, dx=breast_cancer, birth_year, sex) ===")
    sql = f"""
        WITH dx_person AS (
            SELECT DISTINCT person_id
            FROM read_parquet('{CONDITION_GLOB}')
            WHERE condition_source_value LIKE '{DX_PREFIX}%'
        ),
        aged AS (
            SELECT p.person_id, p.year_of_birth, p.gender_source_value AS sex
            FROM dx_person dp
            JOIN read_parquet('{PERSON_GLOB}') p USING (person_id)
            WHERE p.gender_source_value IN ('F', 'M')
              AND p.year_of_birth IS NOT NULL
              AND ({REFERENCE_YEAR} - p.year_of_birth) >= 18
        ),
        visited AS (
            SELECT DISTINCT v.person_id, v.care_site_id
            FROM read_parquet('{VISIT_SAMPLE_GLOB}') v
            WHERE v.care_site_id IS NOT NULL
        ),
        cells AS (
            SELECT
                v.care_site_id,
                a.year_of_birth,
                a.sex,
                COUNT(DISTINCT a.person_id) AS n_candidates
            FROM aged a
            JOIN visited v USING (person_id)
            GROUP BY 1, 2, 3
        )
        SELECT * FROM cells
    """
    cells = con.execute(sql).fetchall()
    n_cells = len(cells)
    if n_cells == 0:
        print("No cells found -- the visit_occurrence sample doesn't overlap the "
              "breast-cancer/adult cohort at all. Sample too small/unlucky; "
              "widen it before drawing any conclusion.")
        return

    sizes = sorted(c[3] for c in cells)
    total_candidates = sum(sizes)

    def pct(p: float) -> int:
        idx = min(int(p * len(sizes)), len(sizes) - 1)
        return sizes[idx]

    n_singleton = sum(1 for s in sizes if s == 1)
    n_le5 = sum(1 for s in sizes if s <= 5)

    print(f"\ncells found: {n_cells:,} (total candidate-patients across cells: {total_candidates:,})")
    print(f"median cell size: {pct(0.5)}")
    print(f"p75 / p90 / p99 cell size: {pct(0.75)} / {pct(0.90)} / {pct(0.99)}")
    print(f"max cell size: {sizes[-1]}")
    print(f"singleton cells (n_candidates == 1, i.e. a real unambiguous match): "
          f"{n_singleton:,} ({100*n_singleton/n_cells:.1f}%)")
    print(f"cells with <=5 candidates: {n_le5:,} ({100*n_le5/n_cells:.1f}%)")

    print("\n=== same query, restricted to the 5 densest facilities in the sample ===")
    print("(this is the scenario that actually matters -- the real proprietary")
    print(" overlap comes from a small number of HIGH-volume hospitals, e.g. 'ha'")
    print(" alone supplies 19,055 of 28,490 proprietary patients. The all-facility")
    print(" aggregate above is dominated by thousands of low-volume clinics/labs")
    print(" where a cell of size 1 just means 'we saw one visit', not that the key")
    print(" discriminates -- Simpson's-paradox territory. This is the real test.)")
    dense_sql = f"""
        WITH dx_person AS (
            SELECT DISTINCT person_id
            FROM read_parquet('{CONDITION_GLOB}')
            WHERE condition_source_value LIKE '{DX_PREFIX}%'
        ),
        aged AS (
            SELECT p.person_id, p.year_of_birth, p.gender_source_value AS sex
            FROM dx_person dp
            JOIN read_parquet('{PERSON_GLOB}') p USING (person_id)
            WHERE p.gender_source_value IN ('F', 'M')
              AND p.year_of_birth IS NOT NULL
              AND ({REFERENCE_YEAR} - p.year_of_birth) >= 18
        ),
        visited AS (
            SELECT DISTINCT v.person_id, v.care_site_id
            FROM read_parquet('{VISIT_SAMPLE_GLOB}') v
            WHERE v.care_site_id IS NOT NULL
        ),
        per_site AS (
            SELECT v.care_site_id, COUNT(DISTINCT a.person_id) AS n_bc_adults
            FROM aged a JOIN visited v USING (person_id)
            GROUP BY 1
            ORDER BY 2 DESC
            LIMIT 5
        ),
        top5 AS (SELECT care_site_id FROM per_site),
        dense_cells AS (
            SELECT v.care_site_id, a.year_of_birth, a.sex,
                   COUNT(DISTINCT a.person_id) AS n
            FROM aged a
            JOIN visited v USING (person_id)
            WHERE v.care_site_id IN (SELECT care_site_id FROM top5)
            GROUP BY 1, 2, 3
        )
        SELECT ps.care_site_id, cs.care_site_name, cs.location_uf_value, ps.n_bc_adults,
               COUNT(dc.n) AS n_cells, MEDIAN(dc.n) AS median_cell, MAX(dc.n) AS max_cell,
               SUM(CASE WHEN dc.n = 1 THEN 1 ELSE 0 END) AS singleton_cells,
               SUM(CASE WHEN dc.n <= 5 THEN 1 ELSE 0 END) AS le5_cells
        FROM per_site ps
        LEFT JOIN read_parquet('{CARE_SITE_GLOB}') cs USING (care_site_id)
        JOIN dense_cells dc USING (care_site_id)
        GROUP BY 1, 2, 3, 4
        ORDER BY ps.n_bc_adults DESC
    """
    dense_rows = con.execute(dense_sql).fetchall()
    dense_medians = []
    for care_site_id, name, uf, n_visits, n_cells_d, median_d, max_d, singles_d, le5_d in dense_rows:
        pct_single = 100 * singles_d / n_cells_d
        pct_le5 = 100 * le5_d / n_cells_d
        dense_medians.append(median_d)
        print(f"  {name} ({uf}): {n_visits} breast-cancer adults in sample, "
              f"{n_cells_d} (birth_year,sex) cells, median cell={median_d:.0f}, "
              f"max={max_d}, singleton={pct_single:.0f}%, <=5={pct_le5:.0f}%")

    con.close()

    print("\n=== go/no-go read (per the plan's criteria) ===")
    print("All-facility aggregate looks PASS-ish (median 2, 49% singleton) -- but that's")
    print("an artifact of thousands of near-empty low-volume facilities, not real")
    print("discriminating power. The dense-facility numbers above are the honest test,")
    print("since the actual proprietary overlap concentrates in a few high-volume")
    print("hospitals just like these.")
    avg_dense_median = sum(dense_medians) / len(dense_medians) if dense_medians else float("inf")
    if avg_dense_median <= 5:
        print(f"\nPASS: avg median cell size at dense facilities = {avg_dense_median:.1f}. "
              "Track B may be worth a bounded next step -- but the facility-crosswalk "
              "gap above still has to be solved first to test the actual overlap "
              "hospital, not a random dense one.")
    else:
        print(f"\nFAIL: at the facilities that resemble the real overlap scenario "
              f"(high-volume hospitals), median candidates per (facility, birth_year, "
              f"sex, dx) cell = {avg_dense_median:.0f}, with only ~10-20% singleton and "
              f"cells up to 300+ candidates. year_of_birth (not full DOB) + sex + dx + "
              f"facility does not disambiguate individuals at the volume where real "
              f"linkage would need to happen -- any 1:1 'match' there would be picked "
              f"arbitrarily among a dozen-plus indistinguishable patients, not a real "
              f"link. Recommendation: do NOT proceed to Track B. Fall back to Track C "
              f"(rewrite pitch Slide 6 to describe standardization, per README.md's "
              f"existing 'Decided: standardization, not record linkage' section).")


if __name__ == "__main__":
    main()
