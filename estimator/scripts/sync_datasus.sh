#!/usr/bin/env bash
# Refresh the local DataSUS OMOP mirror from GCS.
#
# DuckDB in this environment can't authenticate gs:// reads directly (no HMAC
# key on the omop-sus bucket) — see ../README.md "Real data is wired in". So
# the local mirror under ../data/omop_full is the source of truth DuckDBDataSUS
# reads from, and this script is how it stays in sync with GCS (the actual
# source of truth). Only `person` and `condition_occurrence` are mirrored —
# the two tables DuckDBDataSUS.records() / monthly_incidence_by_region() use.
#
# Usage: ./sync_datasus.sh
set -euo pipefail

BUCKET="gs://omop-sus/exports/ihealth_omop_sus"
DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/data/omop_full"

for table in person condition_occurrence; do
  echo "==> syncing ${table}"
  gcloud storage rsync -r "${BUCKET}/${table}/" "${DEST}/${table}/"
done

echo "==> done. Local mirror at ${DEST}"
du -sh "${DEST}"/*
