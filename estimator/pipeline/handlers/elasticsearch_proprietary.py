"""Elasticsearch-backed proprietary patient funnel.

The handler may inspect patient identifiers while computing the funnel, but its
public result is aggregate-only. No Elasticsearch hit or identifier crosses the
host-tool boundary into an agent session.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from copy import deepcopy
from dataclasses import dataclass
from datetime import date, timedelta
import json
import re
import urllib.error
import urllib.parse
import urllib.request

from ..payer_rules import classify_payer
from ..schemas import (
    AgeClause,
    BoolQuery,
    FunnelStage,
    PeriodClause,
    PayerCounts,
    ProprietaryCounts,
    ProviderCount,
    SearchSpec,
    SexClause,
    SiteCount,
    TextClause,
    Tier2Item,
)
from .proprietary import _shallow_spec, _tier2_items


_SAFE_INDEX = re.compile(r"^[a-zA-Z0-9._*,-]+$")
_WITHIN_DAYS = {"y": 365, "M": 30, "w": 7, "d": 1}


class ElasticsearchError(RuntimeError):
    pass


class ElasticsearchClient:
    def __init__(self, url: str, index: str, *, timeout: int = 120):
        if not _SAFE_INDEX.fullmatch(index):
            raise ValueError(f"invalid Elasticsearch index expression: {index!r}")
        self.url = url.rstrip("/")
        self.index = index
        self.timeout = timeout

    def request(self, method: str, path: str, body: dict | None = None) -> dict:
        data = json.dumps(body, separators=(",", ":")).encode() if body is not None else None
        headers = {"Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            f"{self.url}/{self.index}/{path.lstrip('/')}",
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:2000]
            raise ElasticsearchError(f"Elasticsearch HTTP {exc.code}: {detail}") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            raise ElasticsearchError(f"Elasticsearch unavailable at {self.url}: {exc}") from exc

    def field_caps(self) -> dict[str, dict]:
        response = self.request("GET", "_field_caps?fields=*")
        return response.get("fields", {})

    def index_metadata(self) -> dict[str, str]:
        response = self.request("GET", "_mapping")
        for index_value in response.values():
            mappings = index_value.get("mappings", {}) if isinstance(index_value, dict) else {}
            raw = mappings.get("_meta", {}) if isinstance(mappings, dict) else {}
            if isinstance(raw, dict):
                return {str(key): str(value) for key, value in raw.items()}
        return {}

    def composite(self, query: dict, sources: list[dict], *, page_size: int = 1000):
        after = None
        while True:
            composite: dict = {"size": page_size, "sources": sources}
            if after is not None:
                composite["after"] = after
            response = self.request("POST", "_search", {
                "size": 0,
                "track_total_hits": False,
                "query": query,
                "aggs": {"rows": {"composite": composite}},
            })
            aggregation = response.get("aggregations", {}).get("rows", {})
            buckets = aggregation.get("buckets", [])
            for bucket in buckets:
                yield bucket
            after = aggregation.get("after_key")
            if not buckets or after is None:
                break


@dataclass(frozen=True)
class FieldProfile:
    patient: str
    gender: str | None
    birthdate: str | None
    created_at: str | None
    primary_icd: str | None
    hospital: str | None
    payer: str | None
    candidate_ncts: str | None


def _keyword_field(caps: dict[str, dict], *names: str) -> str | None:
    for name in names:
        types = caps.get(name, {})
        if "keyword" in types:
            return name
        keyword = f"{name}.keyword"
        if "keyword" in caps.get(keyword, {}):
            return keyword
    return None


def _plain_field(caps: dict[str, dict], *names: str) -> str | None:
    for name in names:
        if name in caps:
            return name
    return None


def _range_field(caps: dict[str, dict], *names: str) -> str | None:
    for name in names:
        if "date" in caps.get(name, {}):
            return name
        keyword = _keyword_field(caps, name)
        if keyword:
            return keyword
    return None


def resolve_fields(caps: dict[str, dict]) -> FieldProfile:
    patient = _keyword_field(caps, "unique_patient_id", "patient_id")
    if not patient:
        raise ElasticsearchError("index has no keyword patient identifier (unique_patient_id/patient_id)")
    return FieldProfile(
        patient=patient,
        gender=_keyword_field(caps, "gender"),
        birthdate=_range_field(caps, "birthdate", "birth_date"),
        created_at=_range_field(caps, "created_at", "created_ts"),
        primary_icd=_keyword_field(caps, "primary_icd"),
        hospital=_keyword_field(caps, "hospital", "provider"),
        payer=_keyword_field(caps, "payer", "health_insurance_source", "convenio"),
        candidate_ncts=_keyword_field(caps, "candidate_ncts"),
    )


def _text_term(term: str, clause: TextClause) -> dict:
    root_fields = ["preds.text", "primary_icd"]
    match_type = "phrase" if clause.phrase else "best_fields"
    root: dict = {"multi_match": {
        "query": term,
        "fields": root_fields,
        "type": match_type,
        "operator": "and" if clause.operator == "and" else "or",
    }}
    if clause.phrase:
        root["multi_match"]["slop"] = clause.slop
    if clause.tier != 2:
        return root

    nested_queries = []
    nested_fields = {
        "preds.clinical_entities": [
            "preds.clinical_entities.entity",
            "preds.clinical_entities.entity_tokens",
            "preds.clinical_entities.el.term_desc",
            "preds.clinical_entities.el.term_text",
        ],
        "preds.biomarkers": [
            "preds.biomarkers.entity", "preds.biomarkers.normalized_entity",
            "preds.biomarkers.specific_marker",
        ],
        "preds.lab_tests": ["preds.lab_tests.entity", "preds.lab_tests.normalized_entity"],
        "preds.vital_signs": ["preds.vital_signs.entity", "preds.vital_signs.normalized_entity"],
    }
    for path, fields in nested_fields.items():
        nested_queries.append({"nested": {
            "path": path,
            "ignore_unmapped": True,
            "query": {"multi_match": {"query": term, "fields": fields, "operator": "and"}},
        }})
    return {"bool": {"should": [root, *nested_queries], "minimum_should_match": 1}}


def _clause_query(clause, fields: FieldProfile, as_of: date) -> dict:
    if isinstance(clause, TextClause):
        terms = [_text_term(term, clause) for term in clause.terms if term.strip()]
        if not terms:
            return {"match_none": {}}
        key = "must" if clause.operator == "and" else "should"
        query = {"bool": {key: terms}}
        if key == "should":
            query["bool"]["minimum_should_match"] = 1
        return query
    if isinstance(clause, AgeClause):
        if not fields.birthdate:
            raise ElasticsearchError("age criterion requested but index has no birthdate field")
        bounds = {}
        if clause.min_age is not None:
            cutoff_year = as_of.year - clause.min_age
            cutoff_day = min(as_of.day, 28) if as_of.month == 2 else as_of.day
            bounds["lte"] = date(cutoff_year, as_of.month, cutoff_day).isoformat()
        if clause.max_age is not None:
            oldest_year = as_of.year - clause.max_age - 1
            oldest_day = min(as_of.day, 28) if as_of.month == 2 else as_of.day
            oldest = date(oldest_year, as_of.month, oldest_day) + timedelta(days=1)
            bounds["gte"] = oldest.isoformat()
        return {"range": {fields.birthdate: bounds}}
    if isinstance(clause, SexClause):
        if not fields.gender:
            raise ElasticsearchError("sex criterion requested but index has no gender field")
        return {"term": {fields.gender: clause.value}}
    if isinstance(clause, PeriodClause):
        if not fields.created_at:
            raise ElasticsearchError("period criterion requested but index has no created_at field")
        match = re.fullmatch(r"(\d+)([yMwd])", clause.within)
        if not match:
            raise ValueError(f"invalid period: {clause.within!r}")
        days = int(match.group(1)) * _WITHIN_DAYS[match.group(2)]
        return {"range": {fields.created_at: {"gte": (as_of - timedelta(days=days)).isoformat()}}}
    raise ValueError(f"unknown clause: {clause!r}")


def stage_query(query: BoolQuery, fields: FieldProfile, as_of: date, base_filters: list[dict]) -> dict:
    must = [_clause_query(c, fields, as_of) for c in [*query.must, *query.filter]]
    result: dict = {"filter": list(base_filters)}
    if must:
        result["must"] = must
    if query.should:
        result["should"] = [_clause_query(c, fields, as_of) for c in query.should]
        result["minimum_should_match"] = min(query.minimum_should_match, len(query.should))
    return {"bool": result}


def _base_filters(spec: SearchSpec, fields: FieldProfile) -> list[dict]:
    filters: list[dict] = []
    if fields.candidate_ncts:
        filters.append({"term": {fields.candidate_ncts: spec.nct.upper()}})
    prefixes = [str(value).upper().replace(".", "") for value in spec.dx.get("cid_prefixes", [])]
    if prefixes and fields.primary_icd:
        filters.append({"bool": {"should": [
            {"prefix": {fields.primary_icd: {"value": prefix, "case_insensitive": True}}}
            for prefix in prefixes
        ], "minimum_should_match": 1}})
    return filters


def _patients_for_query(client: ElasticsearchClient, query: dict, patient_field: str) -> set[str]:
    return {
        str(bucket["key"]["patient"])
        for bucket in client.composite(query, [
            {"patient": {"terms": {"field": patient_field}}},
        ])
    }


def _run_funnel(client: ElasticsearchClient, spec: SearchSpec, fields: FieldProfile,
                as_of: date) -> set[str]:
    if not spec.stages:
        return set()
    if spec.stages[0].kind != "INCLUSAO":
        raise ValueError("first funnel stage must be INCLUSAO")
    base = _base_filters(spec, fields)
    patients: set[str] | None = None
    for stage in spec.stages:
        matched = _patients_for_query(client, stage_query(stage.query, fields, as_of, base), fields.patient)
        if patients is None:
            patients = matched
        elif stage.kind == "INCLUSAO":
            patients &= matched
        else:
            patients -= matched
    return patients or set()


def _chunks(values: list[str], size: int = 1000):
    for start in range(0, len(values), size):
        yield values[start:start + size]


def _dimensions(client: ElasticsearchClient, patients: set[str], fields: FieldProfile,
                base_filters: list[dict] | None = None):
    if not patients:
        return PayerCounts(sus=0, private=0, unknown=0), [], []
    per_patient_payers: dict[str, set[str]] = defaultdict(set)
    per_patient_sites: dict[str, Counter] = defaultdict(Counter)
    patient_values = sorted(patients)
    for chunk in _chunks(patient_values):
        sources = [{"patient": {"terms": {"field": fields.patient}}}]
        if fields.payer:
            sources.append({"payer": {"terms": {"field": fields.payer, "missing_bucket": True}}})
        if fields.hospital:
            sources.append({"site": {"terms": {"field": fields.hospital, "missing_bucket": True}}})
        patient_filter = {"terms": {fields.patient: chunk}}
        query = ({"bool": {"filter": [patient_filter, *(base_filters or [])]}}
                 if base_filters else patient_filter)
        for bucket in client.composite(query, sources):
            key = bucket["key"]
            patient = str(key["patient"])
            payer = key.get("payer")
            site = key.get("site") or "(sem instituição)"
            per_patient_payers[patient].add(classify_payer(None if payer is None else str(payer)))
            per_patient_sites[patient][str(site)] += int(bucket["doc_count"])

    payer_counts = Counter()
    site_counts = Counter()
    for patient in patient_values:
        payers = per_patient_payers.get(patient, {"unknown"})
        payer_counts["sus" if "sus" in payers else "private" if "private" in payers else "unknown"] += 1
        sites = per_patient_sites.get(patient)
        site = min(sites, key=lambda value: (-sites[value], value)) if sites else "(sem instituição)"
        site_counts[site] += 1
    by_site = [SiteCount(hospital=site, n=n) for site, n in site_counts.most_common()]
    by_provider = [ProviderCount(provider=item.hospital, hospital=item.hospital, n=item.n)
                   for item in by_site]
    return PayerCounts(**{name: payer_counts[name] for name in ("sus", "private", "unknown")}), by_site, by_provider


def search_proprietary_elasticsearch(spec: SearchSpec, *, url: str, index: str,
                                     as_of: date | None = None) -> ProprietaryCounts:
    as_of = as_of or date.today()
    client = ElasticsearchClient(url, index)
    fields = resolve_fields(client.field_caps())
    patients = _run_funnel(client, spec, fields, as_of)
    payer_counts, by_site, by_provider = _dimensions(client, patients, fields)

    depth_ratios: dict = {}
    if _tier2_items(spec):
        shallow = _shallow_spec(spec)
        if shallow.stages:
            shallow_patients = _run_funnel(client, shallow, fields, as_of)
            if shallow_patients:
                deep = len(patients & shallow_patients)
                depth_ratios = {
                    "sus_depth_ratio": round(deep / len(shallow_patients), 4),
                    "shallow_sus_n": len(shallow_patients),
                    "deep_sus_n": deep,
                    "ratio_basis": "overall_elasticsearch_proxy_not_sus_specific",
                }

    return ProprietaryCounts(
        n_total=len(patients),
        by_payer=payer_counts,
        by_site=by_site,
        by_provider=by_provider,
        depth_ratios=depth_ratios,
        tier2_coverage=_tier2_items(spec),
        provenance={
            "source": f"elasticsearch:{index}",
            "backend": "elasticsearch",
            "endpoint": urllib.parse.urlsplit(url)._replace(path="", query="", fragment="").geturl(),
            "as_of": as_of.isoformat(),
            "grain": f"COUNT(DISTINCT {fields.patient})",
            "aggregate_only": True,
        },
    )


def _validated_plan_stages(plan: dict) -> list[dict]:
    if plan.get("schemaVersion") != "elasticsearch-funnel.v1":
        raise ValueError("unsupported Elasticsearch plan schema")
    if not plan.get("reviewedAt"):
        raise ValueError("Elasticsearch plan must be sponsor-reviewed")
    stages = plan.get("stages")
    if not isinstance(stages, list) or not stages:
        raise ValueError("Elasticsearch plan has no stages")
    for stage in stages:
        if stage.get("stageType") not in {"INCLUSION", "EXCLUSION"}:
            raise ValueError("invalid Elasticsearch stage type")
        if stage.get("automation") not in {"AUTOMATED", "ASSISTED", "MANUAL_REVIEW"}:
            raise ValueError("invalid Elasticsearch automation level")
        query = stage.get("query")
        root = query.get("bool") if isinstance(query, dict) else None
        if not isinstance(root, dict) or set(root) - {"must", "filter", "should", "minimum_should_match"}:
            raise ValueError("invalid Elasticsearch stage query root")
        if any(not isinstance(root.get(key, []), list) for key in ("must", "filter", "should")):
            raise ValueError("Elasticsearch bool clauses must be lists")
        if "must_not" in json.dumps(query):
            raise ValueError("must_not is forbidden; exclusions are subtracted at patient grain")
    return stages


def _concrete_date_math(value, as_of: date):
    if not isinstance(value, str):
        return value
    match = re.fullmatch(r"now-(\d+)y/d", value)
    if not match:
        return value
    years = int(match.group(1))
    day = min(as_of.day, 28) if as_of.month == 2 else as_of.day
    return date(as_of.year - years, as_of.month, day).isoformat()


def _adapt_reviewed_query(query: dict, fields: FieldProfile, as_of: date) -> dict:
    """Point reviewed logical fields at the concrete mapping found in this index."""
    aliases = {
        "birthdate": fields.birthdate,
        "gender": fields.gender,
        "created_at": fields.created_at,
        "primary_icd": fields.primary_icd,
    }

    def visit(value):
        if isinstance(value, list):
            return [visit(item) for item in value]
        if not isinstance(value, dict):
            return value
        output = {}
        for key, item in value.items():
            if key in {"range", "term", "terms"} and isinstance(item, dict):
                mapped = {}
                for field, condition in item.items():
                    target = aliases.get(field) or field
                    if key == "range" and isinstance(condition, dict):
                        condition = {bound: _concrete_date_math(bound_value, as_of)
                                     for bound, bound_value in condition.items()}
                    mapped[target] = visit(condition)
                output[key] = mapped
            else:
                output[key] = visit(item)
        return output

    return visit(deepcopy(query))


def _plan_patients(client: ElasticsearchClient, stages: list[dict], fields: FieldProfile,
                   nct: str, allowed: set[str], as_of: date) -> set[str]:
    patients: set[str] | None = None
    for stage in stages:
        if stage["automation"] not in allowed:
            continue
        base_filters = []
        if fields.candidate_ncts:
            base_filters.append({"term": {fields.candidate_ncts: nct.upper()}})
        query = _adapt_reviewed_query(stage["query"], fields, as_of)
        if base_filters:
            query = {"bool": {"must": [query], "filter": base_filters, "should": []}}
        matched = _patients_for_query(client, query, fields.patient)
        if patients is None:
            if stage["stageType"] != "INCLUSION":
                raise ValueError("first executable Elasticsearch stage must be INCLUSION")
            patients = matched
        elif stage["stageType"] == "INCLUSION":
            patients &= matched
        else:
            patients -= matched
    return patients or set()


def search_reviewed_plan_elasticsearch(plan: dict, *, nct: str, url: str, index: str,
                                       as_of: date | None = None) -> ProprietaryCounts:
    """Execute the sponsor-reviewed DSL without any managed-agent dependency.

    AUTOMATED and ASSISTED stages enter the candidate funnel. MANUAL_REVIEW
    stages are reported as omitted and never silently converted into hard gates.
    """
    as_of = as_of or date.today()
    stages = _validated_plan_stages(plan)
    client = ElasticsearchClient(url, index)
    fields = resolve_fields(client.field_caps())
    metadata = client.index_metadata()
    declared_ncts = {item.strip().upper() for item in metadata.get("ncts", "").split(",") if item.strip()}
    if metadata.get("cohort_type") == "preselected_candidates":
        if nct.upper() not in declared_ncts:
            raise ElasticsearchError(
                f"preselected index {index} does not declare requested NCT {nct.upper()}"
            )
        if not fields.candidate_ncts:
            raise ElasticsearchError(
                f"preselected index {index} has multiple trial exports but no "
                "candidate_ncts keyword field; refusing an unscoped cross-trial count"
            )
        nct_filter = {"term": {fields.candidate_ncts: nct.upper()}}
        patients = _patients_for_query(client, nct_filter, fields.patient)
        payer_counts, by_site, by_provider = _dimensions(
            client, patients, fields, [nct_filter]
        )
        ignored = [str(stage.get("criterionText") or stage.get("criterionId")) for stage in stages]
        return ProprietaryCounts(
            n_total=len(patients),
            by_payer=payer_counts,
            by_site=by_site,
            by_provider=by_provider,
            depth_ratios={},
            tier2_coverage=[],
            provenance={
                "source": f"elasticsearch:{index}",
                "source_type": "nct_preselected_elasticsearch_cohort",
                "backend": "elasticsearch",
                "execution": "nct_scoped_preselected_candidates",
                "endpoint": urllib.parse.urlsplit(url)._replace(path="", query="", fragment="").geturl(),
                "as_of": as_of.isoformat(),
                "nct": nct.upper(),
                "grain": f"COUNT(DISTINCT {fields.patient})",
                "aggregate_only": True,
                "eligibility_status": "unverified",
                "ignored_criteria": ignored,
                "notes": [
                    "The index is an NCT-specific preselected candidate cohort.",
                    "Counts are candidate patients requiring clinical eligibility review, not confirmed eligible patients.",
                    "Protocol criteria were not reapplied as hard gates to the already selected cohort.",
                ],
            },
        )
    patients = _plan_patients(client, stages, fields, nct, {"AUTOMATED", "ASSISTED"}, as_of)
    payer_counts, by_site, by_provider = _dimensions(client, patients, fields)

    automatic_patients = _plan_patients(client, stages, fields, nct, {"AUTOMATED"}, as_of)
    depth_ratios: dict = {}
    if automatic_patients:
        deep = len(patients & automatic_patients)
        depth_ratios = {
            "sus_depth_ratio": round(deep / len(automatic_patients), 6),
            "shallow_sus_n": len(automatic_patients),
            "deep_sus_n": deep,
            "ratio_basis": "overall_elasticsearch_proxy_not_sus_specific",
        }

    assisted = [
        Tier2Item(
            criterion=str(stage.get("criterionText") or stage.get("criterionId")),
            tier=2,
            method="text_proxy",
            confidence="proxy",
        )
        for stage in stages if stage["automation"] == "ASSISTED"
    ]
    ignored = [
        str(stage.get("criterionText") or stage.get("criterionId"))
        for stage in stages if stage["automation"] == "MANUAL_REVIEW"
    ]
    return ProprietaryCounts(
        n_total=len(patients),
        by_payer=payer_counts,
        by_site=by_site,
        by_provider=by_provider,
        depth_ratios=depth_ratios,
        tier2_coverage=assisted,
        provenance={
            "source": f"elasticsearch:{index}",
            "backend": "elasticsearch",
            "execution": "reviewed_local_plan",
            "endpoint": urllib.parse.urlsplit(url)._replace(path="", query="", fragment="").geturl(),
            "as_of": as_of.isoformat(),
            "nct": nct.upper(),
            "grain": f"COUNT(DISTINCT {fields.patient})",
            "aggregate_only": True,
            "ignored_criteria": ignored,
        },
    )
