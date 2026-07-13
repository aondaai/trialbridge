"""Strict NCT -> small demo dataset routing.

The manifest contains paths only. Patient-level files stay untracked and the
agent receives aggregates produced by the host-side handlers.
"""
from __future__ import annotations

import glob
import csv
import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from .schemas import (DataSUSCounts, PayerCounts, ProprietaryCounts, ProviderCount,
                      SiteCount, Tier2Item, UFCohort)


class DemoCaseError(RuntimeError):
    pass


@dataclass(frozen=True)
class DemoCaseSources:
    nct: str
    slug: str
    proprietary_type: str
    proprietary_path: str
    datasus_capture_path: str | None = None


def _read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise DemoCaseError(f"demo data file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise DemoCaseError(f"invalid JSON in demo data file {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise DemoCaseError(f"demo data file must contain a JSON object: {path}")
    return value


def _safe_path(base: Path, relative: str, *, allow_glob: bool = False) -> Path:
    if not relative or Path(relative).is_absolute():
        raise DemoCaseError("demo manifest paths must be non-empty and relative")
    if ".." in Path(relative).parts:
        raise DemoCaseError(f"demo manifest path cannot contain '..': {relative}")
    if not allow_glob and glob.has_magic(relative):
        raise DemoCaseError(f"globs are not allowed for this demo source: {relative}")
    anchor_text = relative
    if allow_glob and glob.has_magic(relative):
        magic_positions = [relative.find(ch) for ch in "*[?" if ch in relative]
        anchor_text = relative[:min(magic_positions)]
    candidate = (base / anchor_text).resolve()
    resolved_base = base.resolve()
    if candidate != resolved_base and resolved_base not in candidate.parents:
        raise DemoCaseError(f"demo manifest path escapes its data directory: {relative}")
    return base / relative


def resolve_demo_case(manifest_path: str, nct: str) -> DemoCaseSources:
    manifest_file = Path(manifest_path).resolve()
    manifest = _read_json(manifest_file)
    if manifest.get("version") != 1 or not isinstance(manifest.get("cases"), list):
        raise DemoCaseError("demo manifest must have version=1 and a cases array")
    wanted = nct.strip().upper()
    matches = [case for case in manifest["cases"]
               if wanted in {str(item).upper() for item in case.get("ncts", [])}]
    if len(matches) != 1:
        detail = "not configured" if not matches else "configured more than once"
        raise DemoCaseError(f"NCT {wanted} is {detail} in demo manifest")
    case = matches[0]
    source = case.get("proprietary") or {}
    source_type = source.get("type")
    if source_type not in {"parquet", "capture", "inventory_csv"}:
        raise DemoCaseError(
            f"case {case.get('slug')} must use proprietary type parquet, capture, or inventory_csv"
        )
    base = manifest_file.parent
    prop = _safe_path(base, str(source.get("path", "")), allow_glob=source_type == "parquet")
    if source_type == "parquet":
        if not glob.glob(str(prop)):
            raise DemoCaseError(f"no preselected parquet matched for {wanted}: {prop}")
    elif not prop.is_file():
        raise DemoCaseError(f"proprietary capture not found for {wanted}: {prop}")
    ds_path = None
    if case.get("datasus_capture"):
        ds = _safe_path(base, str(case["datasus_capture"]))
        if not ds.is_file():
            raise DemoCaseError(f"DataSUS capture not found for {wanted}: {ds}")
        ds_path = str(ds)
    return DemoCaseSources(
        nct=wanted, slug=str(case.get("slug") or wanted.lower()),
        proprietary_type=source_type, proprietary_path=str(prop),
        datasus_capture_path=ds_path,
    )


def load_proprietary_inventory(path: str, *, expected_nct: str,
                               tier2_items: list[Tier2Item]) -> ProprietaryCounts:
    """Aggregate one locked NCT without exposing patient identifiers to an agent."""
    required = {"nct", "estagio", "patient_id", "institution", "classification"}
    try:
        with Path(path).open(encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            missing = required - set(reader.fieldnames or [])
            if missing:
                raise DemoCaseError(
                    f"proprietary inventory is missing columns: {', '.join(sorted(missing))}"
                )
            wanted = expected_nct.strip().upper()
            rows = [row for row in reader if str(row.get("nct", "")).strip().upper() == wanted]
    except FileNotFoundError as exc:
        raise DemoCaseError(f"proprietary inventory not found: {path}") from exc
    if not rows:
        raise DemoCaseError(f"proprietary inventory has no rows for {expected_nct}")
    patient_ids = {str(row["patient_id"]).strip() for row in rows if row.get("patient_id")}
    if len(patient_ids) != len(rows):
        raise DemoCaseError(
            f"proprietary inventory contains duplicate patient_id rows for {expected_nct}"
        )
    by_site_counts = Counter(str(row["institution"]).strip() for row in rows)
    stage_counts = Counter(str(row["estagio"]).strip() for row in rows)
    classifications = sorted({str(row["classification"]).strip() for row in rows})
    n_total = len(patient_ids)
    return ProprietaryCounts(
        n_total=n_total, by_payer=PayerCounts(sus=0, private=0, unknown=n_total),
        by_site=[SiteCount(hospital=site, n=count)
                 for site, count in sorted(by_site_counts.items())],
        by_provider=[], depth_ratios={}, tier2_coverage=tier2_items,
        provenance={
            "source": path, "source_type": "inventory_csv", "nct": expected_nct.upper(),
            "grain": "distinct pseudonymized patient_id textual matches",
            "stage_counts": dict(sorted(stage_counts.items())),
            "classifications": classifications, "eligibility_status": "unverified",
            "notes": [
                "Counts are document-search matches, not confirmed eligible patients.",
                "The source interface displayed at most 10 documents per stage.",
                "Payer was unavailable in the supplied inventory.",
            ],
        },
    )


def load_proprietary_capture(path: str, *, expected_nct: str,
                             tier2_items: list[Tier2Item]) -> ProprietaryCounts:
    value = _read_json(Path(path))
    capture_ncts = {str(item).upper() for item in value.get("ncts", [])}
    if expected_nct.upper() not in capture_ncts:
        raise DemoCaseError(f"proprietary capture {path} does not declare {expected_nct}")
    shallow_n = int(value["shallow_n"])
    full_n = int(value["full_n"])
    if shallow_n < 0 or full_n < 0 or full_n > shallow_n:
        raise DemoCaseError("capture counts must satisfy 0 <= full_n <= shallow_n")
    payer = value.get("by_payer") or {"sus": 0, "private": 0, "unknown": full_n}
    by_payer = PayerCounts.model_validate(payer)
    if by_payer.sus + by_payer.private + by_payer.unknown != full_n:
        raise DemoCaseError("capture by_payer must sum to full_n")
    ratio = (full_n / shallow_n) if shallow_n else None
    depth = {
        "shallow_n": shallow_n,
        "full_n": full_n,
        "ratio_basis": "nct_preselected_demo_cohort",
    }
    if ratio is not None:
        depth["sus_depth_ratio"] = round(ratio, 6)
    return ProprietaryCounts(
        n_total=full_n, by_payer=by_payer,
        by_site=[SiteCount.model_validate(item) for item in value.get("by_site", [])],
        by_provider=[ProviderCount.model_validate(item) for item in value.get("by_provider", [])],
        depth_ratios=depth, tier2_coverage=tier2_items,
        provenance={
            "source": value.get("source", path), "as_of": value.get("as_of"),
            "grain": "preselected aggregate capture", "demo_case": True,
            "notes": value.get("notes", []),
        },
    )


def load_datasus_capture(path: str, *, expected_nct: str) -> DataSUSCounts:
    value = _read_json(Path(path))
    capture_ncts = {str(item).upper() for item in value.get("ncts", [])}
    if expected_nct.upper() not in capture_ncts:
        raise DemoCaseError(f"DataSUS capture {path} does not declare {expected_nct}")
    by_uf = [UFCohort.model_validate(item) for item in value.get("by_uf", [])]
    if any(item.base_cohort < 0 for item in by_uf):
        raise DemoCaseError("DataSUS capture counts cannot be negative")
    if len({item.uf for item in by_uf}) != len(by_uf):
        raise DemoCaseError("DataSUS capture has duplicate UF entries")
    return DataSUSCounts(
        by_uf=by_uf,
        provenance={"source": value.get("source", path), "as_of": value.get("as_of"),
                    "grain": "preselected aggregate capture", "demo_case": True},
    )
