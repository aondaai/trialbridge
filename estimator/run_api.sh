#!/usr/bin/env bash
set -euo pipefail
SCRATCH="/private/tmp/claude-501/-Users-angeloorru-Documents-Claude-Projects-Built-with-Claude--Life-Sciences-Remote/6c47c862-7f8c-4175-8822-4e4ee988c618/scratchpad"
cd "$(dirname "$0")"
export TB_DATASUS_DIR="$SCRATCH/omop_full"
export TB_PROPRIETARY_GLOB="$SCRATCH/proprietary_ha/*.parquet"
exec "$SCRATCH/venv/bin/uvicorn" api:app --host 127.0.0.1 --port 8421
