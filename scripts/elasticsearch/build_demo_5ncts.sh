#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARQUET_GLOB="${1:?uso: $0 '/caminho/parquet_ihealth/*.parquet' /caminho/saida.jsonl}"
OUTPUT_PATH="${2:?uso: $0 '/caminho/parquet_ihealth/*.parquet' /caminho/saida.jsonl}"

command -v duckdb >/dev/null 2>&1 || {
  echo "DuckDB CLI nao encontrado." >&2
  exit 1
}

if [[ "$PARQUET_GLOB" == *"'"* || "$OUTPUT_PATH" == *"'"* ]]; then
  echo "Caminhos com aspas simples nao sao suportados." >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_PATH")"
duckdb \
  -c "SET VARIABLE parquet_glob='$PARQUET_GLOB'; SET VARIABLE output_path='$OUTPUT_PATH';" \
  -c ".read '$SCRIPT_DIR/export_demo_5ncts.sql'"

echo "Gerado: $OUTPUT_PATH"
du -h "$OUTPUT_PATH"
wc -l "$OUTPUT_PATH"
