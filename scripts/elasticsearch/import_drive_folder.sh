#!/usr/bin/env bash
set -euo pipefail

FOLDER_INPUT="${1:-1YIAPmRXyj2fM-O5WX-hM2qNhtl6Zw-EL}"
INDEX_NAME="${2:-clinical-demo-5ncts-v1}"
FOLDER_ID="${FOLDER_INPUT##*/folders/}"
FOLDER_ID="${FOLDER_ID%%[/?#]*}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRIALBRIDGE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DOWNLOAD_ROOT="${TB_DRIVE_DOWNLOAD_DIR:-/Users/angeloorru/Documents/Claude/Projects/iHealth DataBase Projects/demo_drive_import}"
RUN_DIR="$DOWNLOAD_ROOT/$INDEX_NAME"

for command_name in gcloud curl jq unzip python3 docker; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Dependencia ausente: $command_name" >&2
    exit 1
  }
done

echo "1/6 Autenticacao Google Drive"
if ! gcloud auth print-access-token >/dev/null 2>&1; then
  echo "A sessao Google precisa ser renovada. Conclua o login no navegador."
  gcloud auth login --enable-gdrive-access
fi

# A sessao pode estar valida para Cloud, mas sem o escopo do Drive. Testamos a pasta
# antes do download e renovamos explicitamente com Drive se necessario.
drive_token="$(gcloud auth print-access-token)"
probe_code="$(curl --silent --output /tmp/tb-drive-probe.json --write-out '%{http_code}' \
  -H "Authorization: Bearer $drive_token" \
  "https://www.googleapis.com/drive/v3/files/$FOLDER_ID?fields=id,name,mimeType")"
if [[ "$probe_code" != "200" ]]; then
  echo "Renovando a autorizacao com acesso ao Google Drive."
  gcloud auth login --enable-gdrive-access --force
  drive_token="$(gcloud auth print-access-token)"
  probe_code="$(curl --silent --output /tmp/tb-drive-probe.json --write-out '%{http_code}' \
    -H "Authorization: Bearer $drive_token" \
    "https://www.googleapis.com/drive/v3/files/$FOLDER_ID?fields=id,name,mimeType")"
fi
if [[ "$probe_code" != "200" ]]; then
  jq . /tmp/tb-drive-probe.json >&2
  echo "Nao foi possivel acessar a pasta do Drive (HTTP $probe_code)." >&2
  exit 1
fi
rm -f /tmp/tb-drive-probe.json

echo "2/6 Inventario e download"
mkdir -p "$RUN_DIR"
inventory="$RUN_DIR/drive-inventory.json"
: > "$inventory"

page_token=""
while :; do
  drive_token="$(gcloud auth print-access-token)"
  response="$RUN_DIR/.drive-page.json"
  curl_args=(
    --silent --show-error --fail --get
    -H "Authorization: Bearer $drive_token"
    --data-urlencode "q='$FOLDER_ID' in parents and trashed=false"
    --data-urlencode "fields=nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime)"
    --data-urlencode "pageSize=1000"
  )
  if [[ -n "$page_token" ]]; then
    curl_args+=(--data-urlencode "pageToken=$page_token")
  fi
  curl "${curl_args[@]}" 'https://www.googleapis.com/drive/v3/files' > "$response"
  jq -c '.files[]' "$response" >> "$inventory"
  page_token="$(jq -r '.nextPageToken // empty' "$response")"
  [[ -z "$page_token" ]] && break
done
rm -f "$RUN_DIR/.drive-page.json"

file_count="$(wc -l < "$inventory" | tr -d ' ')"
if [[ "$file_count" == "0" ]]; then
  echo "A pasta do Drive esta vazia." >&2
  exit 1
fi
echo "Arquivos encontrados: $file_count"
jq -r '[.name, .mimeType, (.size // "-")] | @tsv' "$inventory"

pending_files=()
pending_ids=()
while IFS= read -r file_json; do
  file_id="$(jq -r '.id' <<<"$file_json")"
  file_name="$(jq -r '.name' <<<"$file_json")"
  mime_type="$(jq -r '.mimeType' <<<"$file_json")"
  expected_size="$(jq -r '.size // empty' <<<"$file_json")"
  expected_md5="$(jq -r '.md5Checksum // empty' <<<"$file_json")"
  safe_name="${file_name//\//_}"
  destination="$RUN_DIR/$safe_name"

  if [[ "$mime_type" == application/vnd.google-apps.* ]]; then
    echo "Ignorado (arquivo Google nativo): $file_name" >&2
    continue
  fi

  if [[ -f "$destination" && -n "$expected_size" && "$(stat -f '%z' "$destination")" == "$expected_size" ]]; then
    echo "Ja baixado: $file_name"
  else
    echo "Baixando: $file_name"
    drive_token="$(gcloud auth print-access-token)"
    curl --location --fail --show-error --progress-bar \
      -H "Authorization: Bearer $drive_token" \
      "https://www.googleapis.com/drive/v3/files/$file_id?alt=media" \
      --output "$destination.part"
    mv "$destination.part" "$destination"
  fi

  if [[ -n "$expected_size" && "$(stat -f '%z' "$destination")" != "$expected_size" ]]; then
    echo "Tamanho invalido em $file_name" >&2
    exit 1
  fi
  if [[ -n "$expected_md5" ]]; then
    actual_md5="$(md5 -q "$destination")"
    [[ "$actual_md5" == "$expected_md5" ]] || {
      echo "Checksum MD5 invalido em $file_name" >&2
      exit 1
    }
  fi

  marker="$RUN_DIR/.imported-$file_id"
  if [[ -f "$marker" ]]; then
    echo "Ja importado: $file_name"
  else
    pending_files+=("$destination")
    pending_ids+=("$file_id")
  fi
done < "$inventory"

if [[ "${#pending_files[@]}" == "0" ]]; then
  echo "Nenhum arquivo novo para importar."
  exit 0
fi

echo "3/6 Validacao e extracao dos ZIPs"
jsonl_files=()
for pending_file in "${pending_files[@]}"; do
  case "$pending_file" in
    *.zip|*.ZIP)
      unzip -tq "$pending_file"
      extract_dir="${pending_file%.*}"
      rm -rf "$extract_dir"
      mkdir -p "$extract_dir"
      python3 - "$pending_file" "$extract_dir" <<'PY'
from pathlib import Path
import sys
import zipfile

archive = Path(sys.argv[1])
destination = Path(sys.argv[2]).resolve()
with zipfile.ZipFile(archive) as handle:
    for member in handle.infolist():
        target = (destination / member.filename).resolve()
        if destination not in target.parents and target != destination:
            raise SystemExit(f"Entrada ZIP insegura: {member.filename}")
    handle.extractall(destination)
PY
      while IFS= read -r -d '' jsonl_file; do
        jsonl_files+=("$jsonl_file")
      done < <(
        find "$extract_dir" -type f \( \
          -iname '*.jsonl' -o -iname '*.ndjson' -o \
          -iname '*.jsonl.gz' -o -iname '*.ndjson.gz' \
        \) -print0
      )
      ;;
    *.jsonl|*.ndjson|*.jsonl.gz|*.ndjson.gz)
      jsonl_files+=("$pending_file")
      ;;
    *)
      echo "Ignorado (nao e ZIP/JSONL): $pending_file" >&2
      ;;
  esac
done
if [[ "${#jsonl_files[@]}" == "0" ]]; then
  echo "Nenhum JSONL/NDJSON foi encontrado depois da extracao." >&2
  find "$RUN_DIR" -maxdepth 3 -type f -print
  exit 1
fi
echo "JSONLs encontrados: ${#jsonl_files[@]}"

echo "4/6 Elasticsearch"
cd "$TRIALBRIDGE_DIR"
docker compose up -d elasticsearch
for attempt in {1..60}; do
  curl --fail --silent http://localhost:9200/_cluster/health >/dev/null && break
  [[ "$attempt" == "60" ]] && {
    docker compose logs --tail=100 elasticsearch >&2
    exit 1
  }
  sleep 1
done

curl --fail --silent -X PUT \
  http://localhost:9200/_index_template/clinical-jsonl \
  -H 'Content-Type: application/json' \
  --data-binary @elasticsearch/index-template.json >/dev/null

echo "5/6 Bulk para $INDEX_NAME"
python3 scripts/elasticsearch/import_jsonl.py \
  --index "$INDEX_NAME" \
  --optimize \
  "${jsonl_files[@]}"

# Older per-trial exports encode the NCT in the file name but not in _source.
# Union that provenance after indexing so a shared index remains NCT-scoped,
# including when the same document belongs to more than one broad cohort.
python3 scripts/elasticsearch/tag_candidate_ncts.py \
  --index "$INDEX_NAME" \
  "${jsonl_files[@]}"

for imported_id in "${pending_ids[@]}"; do
  date -u '+%Y-%m-%dT%H:%M:%SZ' > "$RUN_DIR/.imported-$imported_id"
done

echo "6/6 Validacao final"
curl --fail --silent "http://localhost:9200/$INDEX_NAME/_count" | jq .
curl --fail --silent "http://localhost:9200/$INDEX_NAME/_mapping" \
  | jq 'to_entries[0].value.mappings.properties.preds.properties |
        {clinical_entities: .clinical_entities.type, biomarkers: .biomarkers.type}'
echo "Concluido: $INDEX_NAME"
