#!/usr/bin/env python3
"""Stream JSONL/NDJSON files into a local Elasticsearch index via Bulk API."""

from __future__ import annotations

import argparse
import gzip
import json
import sys
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from glob import glob
from pathlib import Path
from typing import IO, Iterator


ACTIONS = {"index", "create", "update", "delete"}
RETRYABLE = {429, 502, 503, 504}
SOURCE_METADATA_FIELDS = {"_id", "_index", "_type", "_score"}


def compact(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


@contextmanager
def open_text(path: Path) -> Iterator[IO[str]]:
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            yield handle
    else:
        with path.open("r", encoding="utf-8") as handle:
            yield handle


def nonempty_lines(handle: IO[str], path: Path) -> Iterator[tuple[int, dict]]:
    for line_number, line in enumerate(handle, 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path}:{line_number}: JSON invalido: {exc}") from exc
        if not isinstance(value, dict):
            raise ValueError(f"{path}:{line_number}: cada linha deve ser um objeto JSON")
        yield line_number, value


def action_name(value: dict) -> str | None:
    if len(value) != 1:
        return None
    key = next(iter(value))
    return key if key in ACTIONS and isinstance(value[key], dict) else None


def document_operation(value: dict, index: str) -> tuple[bytes, int]:
    # Accept elasticdump/search-hit shaped records as well as plain source documents.
    if isinstance(value.get("_source"), dict):
        source = value["_source"]
        doc_id = value.get("_id")
    else:
        source = {
            key: item for key, item in value.items() if key not in SOURCE_METADATA_FIELDS
        }
        doc_id = value.get("_id")

    meta: dict[str, object] = {"_index": index}
    if doc_id is not None:
        meta["_id"] = str(doc_id)
    payload = compact({"index": meta}) + b"\n" + compact(source) + b"\n"
    return payload, 1


def operations(
    path: Path, index: str, mode: str, preserve_index: bool
) -> Iterator[tuple[bytes, int]]:
    with open_text(path) as handle:
        lines = nonempty_lines(handle, path)
        try:
            first_line, first = next(lines)
        except StopIteration:
            return

        detected = "bulk" if action_name(first) else "documents"
        selected = detected if mode == "auto" else mode

        if selected == "documents":
            yield document_operation(first, index)
            for _, value in lines:
                yield document_operation(value, index)
            return

        pending: tuple[int, dict] | None = (first_line, first)
        while pending is not None:
            line_number, action = pending
            name = action_name(action)
            if not name:
                raise ValueError(
                    f"{path}:{line_number}: esperava uma linha de acao Bulk "
                    "(index/create/update/delete)"
                )
            meta = dict(action[name])
            if not preserve_index or "_index" not in meta:
                meta["_index"] = index
            payload = compact({name: meta}) + b"\n"

            if name == "delete":
                yield payload, 1
                try:
                    pending = next(lines)
                except StopIteration:
                    pending = None
                continue

            try:
                source_line, source = next(lines)
            except StopIteration as exc:
                raise ValueError(f"{path}:{line_number}: acao Bulk sem documento") from exc
            payload += compact(source) + b"\n"
            yield payload, 1
            try:
                pending = next(lines)
            except StopIteration:
                pending = None


def request_json(
    method: str,
    url: str,
    body: bytes | None = None,
    content_type: str = "application/json",
    retries: int = 5,
) -> dict:
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = content_type

    for attempt in range(retries + 1):
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:2000]
            if exc.code not in RETRYABLE or attempt == retries:
                raise RuntimeError(f"HTTP {exc.code} em {url}: {detail}") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == retries:
                raise RuntimeError(f"Falha ao acessar {url}: {exc}") from exc
        time.sleep(min(2**attempt, 30))
    raise AssertionError("unreachable")


def resource_exists(url: str) -> bool:
    request = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(request, timeout=30):
            return True
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return False
        detail = exc.read().decode("utf-8", errors="replace")[:2000]
        raise RuntimeError(f"HTTP {exc.code} em {url}: {detail}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError(f"Falha ao acessar {url}: {exc}") from exc


def send_bulk(url: str, payload: bytes) -> tuple[int, list[dict]]:
    response = request_json(
        "POST",
        f"{url}/_bulk?filter_path=errors,items.*.status,items.*.error",
        payload,
        "application/x-ndjson",
    )
    failures: list[dict] = []
    for item in response.get("items", []):
        result = next(iter(item.values()))
        if result.get("status", 500) >= 300:
            failures.append(result)
    return len(response.get("items", [])), failures


def resolve_paths(patterns: list[str]) -> list[Path]:
    resolved: list[Path] = []
    for pattern in patterns:
        matches = [Path(value) for value in glob(pattern, recursive=True)]
        if not matches and Path(pattern).is_file():
            matches = [Path(pattern)]
        resolved.extend(path for path in matches if path.is_file())
    unique = sorted(set(resolved))
    if not unique:
        raise ValueError("nenhum arquivo encontrado para os caminhos/globs informados")
    return unique


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Importa JSONL em streaming usando a Bulk API do Elasticsearch."
    )
    parser.add_argument("paths", nargs="+", help="arquivos ou globs (aceita .gz)")
    parser.add_argument("--index", required=True, help="indice de destino")
    parser.add_argument("--url", default="http://localhost:9200")
    parser.add_argument("--mode", choices=("auto", "documents", "bulk"), default="auto")
    parser.add_argument("--batch-docs", type=int, default=5000)
    parser.add_argument("--batch-mb", type=int, default=20)
    parser.add_argument(
        "--preserve-index",
        action="store_true",
        help="no modo Bulk, preserva _index presente nas linhas de acao",
    )
    parser.add_argument(
        "--optimize",
        action="store_true",
        help="desliga refresh durante a carga e restaura para 1s ao terminar",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    url = args.url.rstrip("/")
    paths = resolve_paths(args.paths)
    max_bytes = args.batch_mb * 1024 * 1024
    if args.batch_docs < 1 or max_bytes < 1:
        raise ValueError("--batch-docs e --batch-mb devem ser positivos")

    request_json("GET", f"{url}/")
    if not resource_exists(f"{url}/{args.index}"):
        request_json("PUT", f"{url}/{args.index}")
    if args.optimize:
        request_json(
            "PUT",
            f"{url}/{args.index}/_settings",
            compact({"index": {"refresh_interval": "-1"}}),
        )

    indexed = 0
    failed = 0
    batch = bytearray()
    batch_docs = 0
    started = time.monotonic()

    def flush() -> None:
        nonlocal indexed, failed, batch, batch_docs
        if not batch:
            return
        sent, failures = send_bulk(url, bytes(batch))
        indexed += sent - len(failures)
        failed += len(failures)
        elapsed = max(time.monotonic() - started, 0.001)
        print(
            f"\rindexados={indexed:,} falhas={failed:,} taxa={indexed / elapsed:,.0f} docs/s",
            end="",
            flush=True,
        )
        if failures:
            print("\nPrimeiras falhas do lote:", file=sys.stderr)
            for failure in failures[:3]:
                print(json.dumps(failure, ensure_ascii=False), file=sys.stderr)
        batch = bytearray()
        batch_docs = 0

    try:
        for path in paths:
            print(f"\nImportando {path}")
            for payload, count in operations(path, args.index, args.mode, args.preserve_index):
                if batch and (batch_docs + count > args.batch_docs or len(batch) + len(payload) > max_bytes):
                    flush()
                if len(payload) > 100 * 1024 * 1024:
                    raise ValueError(f"documento excede o limite HTTP de 100 MB: {path}")
                batch.extend(payload)
                batch_docs += count
            flush()
    finally:
        if args.optimize:
            request_json(
                "PUT",
                f"{url}/{args.index}/_settings",
                compact({"index": {"refresh_interval": "1s"}}),
            )

    request_json("POST", f"{url}/{args.index}/_refresh")
    print(f"\nConcluido: {indexed:,} documentos indexados; {failed:,} falhas.")
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError) as exc:
        print(f"Erro: {exc}", file=sys.stderr)
        raise SystemExit(2)
