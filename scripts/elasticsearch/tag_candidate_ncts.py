#!/usr/bin/env python3
"""Tag already-imported Elasticsearch documents with their source NCT.

The Drive demo exports encode the NCT in the archive/file path, while the older
JSONL payloads do not carry it in ``_source``. Importing several exports into one
index therefore needs a second, idempotent pass that unions ``candidate_ncts``
by document id. Only aggregate progress and counts are printed.
"""
from __future__ import annotations

import argparse
import re
import time
from pathlib import Path

from import_jsonl import compact, nonempty_lines, open_text, request_json, resolve_paths, send_bulk


NCT_PATTERN = re.compile(r"NCT\d{8}", re.IGNORECASE)
SCRIPT = (
    "if (ctx._source.candidate_ncts == null) { "
    "ctx._source.candidate_ncts = [params.nct] "
    "} else if (!ctx._source.candidate_ncts.contains(params.nct)) { "
    "ctx._source.candidate_ncts.add(params.nct) }"
)


def nct_from_path(path: Path) -> str:
    matches = {value.upper() for value in NCT_PATTERN.findall(str(path))}
    if len(matches) != 1:
        raise ValueError(f"path must identify exactly one NCT: {path}")
    return matches.pop()


def document_ids(path: Path):
    with open_text(path) as handle:
        for line_number, value in nonempty_lines(handle, path):
            doc_id = value.get("_id")
            if doc_id is None:
                raise ValueError(f"{path}:{line_number}: document has no _id")
            yield str(doc_id)


def main() -> int:
    parser = argparse.ArgumentParser(description="Union candidate_ncts into imported documents")
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--index", required=True)
    parser.add_argument("--url", default="http://localhost:9200")
    parser.add_argument("--batch-docs", type=int, default=5000)
    args = parser.parse_args()
    if args.batch_docs < 1:
        raise ValueError("--batch-docs must be positive")

    url = args.url.rstrip("/")
    paths = resolve_paths(args.paths)
    path_ncts = [(path, nct_from_path(path)) for path in paths]
    mapping = request_json("GET", f"{url}/{args.index}/_mapping")
    index_mapping = next(iter(mapping.values())).get("mappings", {})
    metadata = dict(index_mapping.get("_meta") or {})
    declared = {
        item.strip().upper() for item in str(metadata.get("ncts", "")).split(",") if item.strip()
    }
    declared.update(nct for _, nct in path_ncts)
    metadata.update({
        "cohort_type": "preselected_candidates",
        "eligibility_status": "unverified",
        "ncts": ",".join(sorted(declared)),
    })
    request_json("PUT", f"{url}/{args.index}/_mapping", compact({
        "_meta": metadata,
        "properties": {"candidate_ncts": {"type": "keyword"}},
    }))

    updated = 0
    failures = 0
    batch = bytearray()
    batch_docs = 0
    started = time.monotonic()

    def flush() -> None:
        nonlocal updated, failures, batch, batch_docs
        if not batch:
            return
        sent, failed = send_bulk(url, bytes(batch))
        updated += sent - len(failed)
        failures += len(failed)
        elapsed = max(time.monotonic() - started, 0.001)
        print(
            f"\rtagged={updated:,} failures={failures:,} rate={updated / elapsed:,.0f} docs/s",
            end="",
            flush=True,
        )
        batch = bytearray()
        batch_docs = 0

    for path, nct in path_ncts:
        print(f"\nTagging {path} as {nct}")
        for doc_id in document_ids(path):
            action = compact({"update": {"_index": args.index, "_id": doc_id}}) + b"\n"
            update = compact({
                "script": {"lang": "painless", "source": SCRIPT, "params": {"nct": nct}},
            }) + b"\n"
            if batch_docs >= args.batch_docs:
                flush()
            batch.extend(action)
            batch.extend(update)
            batch_docs += 1
        flush()

    request_json("POST", f"{url}/{args.index}/_refresh")
    print(f"\nCompleted: {updated:,} document tags; {failures:,} failures.")
    return 1 if failures else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError) as exc:
        print(f"Error: {exc}")
        raise SystemExit(2)
