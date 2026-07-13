"""search_proprietary — the DuckDB funnel compiler entry point (Agent 2's host tool).
Aggregate-only: returns counts, never rows. Spec §4.2, §5."""
from __future__ import annotations
from datetime import date
import re
import duckdb
from ..schemas import (SearchSpec, ProprietaryCounts, PayerCounts, SiteCount, ProviderCount,
                       Tier2Item, BoolQuery, FunnelStage, TextClause, AgeClause, SexClause,
                       PeriodClause)
from ..funnel import funnel_patient_sql
from ..payer_rules import PAYER_SQL_CASE

def _tier2_items(spec: SearchSpec) -> list[Tier2Item]:
    items: list[Tier2Item] = []
    for stage in spec.stages:
        for group in (stage.query.must, stage.query.filter, stage.query.should):
            for c in group:
                if getattr(c, "tier", 1) == 2:
                    items.append(Tier2Item(
                        criterion=c.label or ", ".join(c.terms),
                        tier=2, method="text_proxy", confidence="proxy"))
    return items

def _shallow_spec(spec: SearchSpec) -> SearchSpec:
    """Spec with all tier=2 (deep) clauses removed — the criteria DataSUS can observe.
    Stages left with no clauses are dropped."""
    def keep(clauses):
        return [c for c in clauses if getattr(c, "tier", 1) != 2]
    new_stages = []
    for st in spec.stages:
        q = BoolQuery(must=keep(st.query.must), filter=keep(st.query.filter),
                      should=keep(st.query.should),
                      minimum_should_match=st.query.minimum_should_match)
        if q.must or q.filter or q.should:
            new_stages.append(FunnelStage(kind=st.kind, query=q))
    while new_stages and new_stages[0].kind != "INCLUSAO":
        new_stages.pop(0)
    return SearchSpec(nct=spec.nct, dx=spec.dx, stages=new_stages)

def _sus_count(con, patients_sql, table):
    return con.execute(f"""
        WITH s AS ({patients_sql}),
        docs AS (SELECT unique_patient_id, {PAYER_SQL_CASE} AS payer FROM {table}
                 WHERE unique_patient_id IN (SELECT unique_patient_id FROM s)),
        pat AS (SELECT unique_patient_id,
                    CASE WHEN bool_or(payer='sus') THEN 'sus'
                         WHEN bool_or(payer='private') THEN 'private' ELSE 'unknown' END AS payer
                FROM docs GROUP BY unique_patient_id)
        SELECT count(*) FROM pat WHERE payer='sus'
    """).fetchone()[0]


def _structured_text_expr(clause: TextClause) -> str | None:
    text = " ".join([clause.label or "", *clause.terms]).lower()
    if any(token in text for token in ("breast cancer", "cancer de mama", "carcinoma mamario", "c50")):
        return "TRUE"  # the vendored depth parquet is a breast-cancer cohort by construction
    if "her2" in text or "erbb2" in text:
        return "coalesce(her2, FALSE)"
    if "metasta" in text or "stage iv" in text or "estadio iv" in text:
        return "coalesce(metastatic, FALSE)"
    if "autoimmun" in text or "autoimune" in text:
        return "coalesce(autoimmune, FALSE)"
    if "ecog" in text:
        values = sorted({int(v) for v in re.findall(r"(?<!\d)([0-4])(?!\d)", text)})
        if values:
            return f"ecog IN ({','.join(str(v) for v in values)})"
    return None


def _structured_bool(query: BoolQuery, reference_year: int, ignored: set[str]) -> str:
    def expression(clause) -> str | None:
        if isinstance(clause, AgeClause):
            parts = []
            if clause.min_age is not None:
                parts.append(f"birth_year <= {reference_year - clause.min_age}")
            if clause.max_age is not None:
                parts.append(f"birth_year >= {reference_year - clause.max_age}")
            return "(" + " AND ".join(parts) + ")" if parts else None
        if isinstance(clause, SexClause):
            return f"sex = '{'F' if clause.value == 'FEMALE' else 'M'}'"
        if isinstance(clause, TextClause):
            return _structured_text_expr(clause)
        if isinstance(clause, PeriodClause):
            return None
        return None

    required = []
    for clause in [*query.must, *query.filter]:
        expr = expression(clause)
        if expr:
            required.append(expr)
        else:
            ignored.add(getattr(clause, "label", None) or getattr(clause, "type", "unknown"))
    should = []
    for clause in query.should:
        expr = expression(clause)
        if expr:
            should.append(expr)
        else:
            ignored.add(getattr(clause, "label", None) or getattr(clause, "type", "unknown"))
    if should:
        minimum = min(query.minimum_should_match, len(should))
        required.append("(" + " + ".join(f"CAST(({item}) AS INTEGER)" for item in should) +
                        f") >= {minimum}")
    return "(" + " AND ".join(required) + ")" if required else "TRUE"


def _structured_patient_sql(spec: SearchSpec, table: str, reference_year: int,
                            ignored: set[str], *, shallow: bool = False) -> str:
    prefixes = [str(value).upper() for value in spec.dx.get("cid_prefixes", [])]
    if prefixes and not any("C50".startswith(prefix) for prefix in prefixes):
        return "SELECT patient_id AS unique_patient_id FROM " + table + " WHERE FALSE"
    stages = []
    for stage in spec.stages:
        query = stage.query
        if shallow:
            keep = lambda clauses: [c for c in clauses if getattr(c, "tier", 1) != 2]
            query = BoolQuery(must=keep(query.must), filter=keep(query.filter),
                              should=keep(query.should), minimum_should_match=query.minimum_should_match)
            if not (query.must or query.filter or query.should):
                continue
        predicate = _structured_bool(query, reference_year, ignored)
        stages.append((stage.kind,
                       f"SELECT DISTINCT patient_id AS unique_patient_id FROM {table} WHERE {predicate}"))
    while stages and stages[0][0] != "INCLUSAO":
        stages.pop(0)
    if not stages:
        return f"SELECT DISTINCT patient_id AS unique_patient_id FROM {table}"
    sql = stages[0][1]
    for kind, next_sql in stages[1:]:
        operator = "INTERSECT" if kind == "INCLUSAO" else "EXCEPT"
        sql = f"SELECT unique_patient_id FROM ({sql}) {operator} SELECT unique_patient_id FROM ({next_sql})"
    return sql


def _search_structured_depth(spec: SearchSpec, con, table: str, reference_year: int,
                             as_of: date, parquet_glob: str) -> ProprietaryCounts:
    ignored: set[str] = set()
    full_sql = _structured_patient_sql(spec, table, reference_year, ignored)
    shallow_sql = _structured_patient_sql(spec, table, reference_year, ignored, shallow=True)
    n_total = int(con.execute(f"SELECT count(*) FROM ({full_sql})").fetchone()[0])
    shallow_n = int(con.execute(f"SELECT count(*) FROM ({shallow_sql})").fetchone()[0])
    depth_ratios = {}
    if shallow_n:
        depth_ratios = {
            "sus_depth_ratio": round(n_total / shallow_n, 4),
            "shallow_sus_n": shallow_n,
            "deep_sus_n": n_total,
            "ratio_basis": "overall_structured_proprietary_proxy_not_sus_specific",
        }
    structured_items = [
        Tier2Item(criterion=item.criterion, tier=2, method="structured", confidence="high")
        for item in _tier2_items(spec)
        if item.criterion not in ignored
    ]
    return ProprietaryCounts(
        n_total=n_total,
        by_payer=PayerCounts(sus=0, private=0, unknown=n_total),
        by_site=[], by_provider=[], depth_ratios=depth_ratios,
        tier2_coverage=structured_items,
        provenance={
            "source": parquet_glob, "as_of": as_of.isoformat(), "reference_year": reference_year,
            "grain": "COUNT(DISTINCT patient_id)", "schema": "structured_depth",
            "ignored_criteria": sorted(ignored),
            "note": "Vendored breast-cancer depth cohort; payer and site dimensions unavailable.",
        },
    )

def search_proprietary(spec: SearchSpec, *, parquet_glob: str,
                       reference_year: int = 2025, as_of: date | None = None) -> ProprietaryCounts:
    as_of = as_of or date.today()
    table = f"read_parquet('{parquet_glob}')"
    con = duckdb.connect()
    con.execute("PRAGMA threads=4")
    try:
        columns = {str(row[0]).lower() for row in con.execute(f"DESCRIBE SELECT * FROM {table}").fetchall()}
        if "texto" not in columns and {"patient_id", "her2", "ecog"}.issubset(columns):
            return _search_structured_depth(spec, con, table, reference_year, as_of, parquet_glob)
        patients_sql = funnel_patient_sql(spec, table, reference_year, as_of)
        # Single funnel scan → temp table of matched patients' docs (payer + hospital).
        con.execute(f"""
            CREATE TEMPORARY TABLE matched_docs AS
            SELECT unique_patient_id, {PAYER_SQL_CASE} AS payer, hospital,
                   coalesce(provider, '(sem provider)') AS provider
            FROM {table}
            WHERE unique_patient_id IN ({patients_sql})
        """)
        # Payer per patient: any SUS doc ⇒ sus, else any private ⇒ private, else unknown.
        payer_rows = dict(con.execute("""
            WITH pat AS (
                SELECT unique_patient_id,
                    CASE WHEN bool_or(payer='sus') THEN 'sus'
                         WHEN bool_or(payer='private') THEN 'private'
                         ELSE 'unknown' END AS payer
                FROM matched_docs GROUP BY unique_patient_id
            )
            SELECT payer, count(*) FROM pat GROUP BY payer
        """).fetchall())
        by_payer = PayerCounts(sus=payer_rows.get("sus", 0),
                               private=payer_rows.get("private", 0),
                               unknown=payer_rows.get("unknown", 0))
        n_total = by_payer.sus + by_payer.private + by_payer.unknown
        # Site per patient: most matching docs, ties broken by hospital name ascending.
        site_rows = con.execute("""
            WITH per AS (
                SELECT unique_patient_id, hospital, count(*) AS c
                FROM matched_docs GROUP BY unique_patient_id, hospital
            ),
            ranked AS (
                SELECT unique_patient_id, hospital,
                    row_number() OVER (PARTITION BY unique_patient_id
                                       ORDER BY c DESC, hospital ASC) AS rn
                FROM per
            )
            SELECT hospital, count(*) FROM ranked WHERE rn = 1 GROUP BY hospital ORDER BY 2 DESC, 1
        """).fetchall()
        by_site = [SiteCount(hospital=str(h), n=int(n)) for h, n in site_rows]

        # Provider per patient: same deterministic attribution rule as by_site, but at
        # the finer provider grain (~99 real facility units vs 35 hospital groups).
        provider_rows = con.execute("""
            WITH per AS (
                SELECT unique_patient_id, hospital, provider, count(*) AS c
                FROM matched_docs GROUP BY unique_patient_id, hospital, provider
            ),
            ranked AS (
                SELECT unique_patient_id, hospital, provider,
                    row_number() OVER (PARTITION BY unique_patient_id
                                       ORDER BY c DESC, hospital ASC, provider ASC) AS rn
                FROM per
            )
            SELECT hospital, provider, count(*) FROM ranked WHERE rn = 1
            GROUP BY hospital, provider ORDER BY 3 DESC, 1, 2
        """).fetchall()
        by_provider = [ProviderCount(provider=str(p), hospital=str(h), n=int(n))
                       for h, p, n in provider_rows]

        # Data-derived depth ratio on the SUS slice (spec §6): fraction of SUS patients
        # meeting the SHALLOW criteria (dx+demographics, what DataSUS sees) that ALSO meet
        # the DEEP tier=2 criteria. Only meaningful when the trial has deep criteria.
        depth_ratios: dict = {}
        has_deep = any(getattr(c, "tier", 1) == 2
                       for st in spec.stages
                       for grp in (st.query.must, st.query.filter, st.query.should)
                       for c in grp)
        if has_deep:
            try:
                shallow = _shallow_spec(spec)
                if shallow.stages:
                    shallow_sql = funnel_patient_sql(shallow, table, reference_year, as_of)
                    shallow_sus = _sus_count(con, shallow_sql, table)
                    if shallow_sus > 0:
                        # deep_sus = SUS patients meeting BOTH shallow AND the full (shallow+deep)
                        # funnel. Using the intersection (not just the full count) keeps the ratio
                        # in [0,1] even when a should-group mixes tier-1 and tier-2 clauses.
                        inter_sql = (f"SELECT unique_patient_id FROM ({patients_sql}) "
                                     f"INTERSECT SELECT unique_patient_id FROM ({shallow_sql})")
                        deep_sus = _sus_count(con, inter_sql, table)
                        depth_ratios = {
                            "sus_depth_ratio": round(deep_sus / shallow_sus, 4),
                            "shallow_sus_n": shallow_sus,
                            "deep_sus_n": deep_sus,
                        }
            except ValueError:
                depth_ratios = {}
    finally:
        con.close()

    return ProprietaryCounts(
        n_total=n_total, by_payer=by_payer, by_site=by_site, by_provider=by_provider,
        depth_ratios=depth_ratios,
        tier2_coverage=_tier2_items(spec),
        provenance={"source": parquet_glob, "as_of": as_of.isoformat(),
                    "reference_year": reference_year, "grain": "COUNT(DISTINCT unique_patient_id)"},
    )
