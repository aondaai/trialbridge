#!/usr/bin/env bash
# Mirror EVERY table in the ihealth_omop_sus export, not just the two
# (person, condition_occurrence) that sync_datasus.sh keeps in sync for
# production (DuckDBDataSUS). This is the "have everything locally" mirror
# for exploration -- most of these tables aren't read by any code in this
# repo yet (checked 2026-07-09: only person/condition_occurrence/care_site
# are). Run this when you want the full bucket on disk, not as part of the
# normal dev loop.
#
# ~146GB remaining as of 2026-07-09 (person/condition_occurrence/care_site
# already mirrored; visit_occurrence had an 80-part/~3GB sample from a spike,
# this re-syncs it in full). Expect roughly an hour at the throughput
# observed so far (~40MB/s).
#
# Usage: ./sync_datasus_all_tables.sh
set -euo pipefail

BUCKET="gs://omop-sus/exports/ihealth_omop_sus"
DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/data/omop_full"

TABLES=(
  person
  condition_occurrence
  care_site
  visit_occurrence
  procedure_occurrence
  apac_person
  apac_condition_occurrence
  apac_drug_exposure
  apac_visit_occurrence
  sus_internacao_resumo
  location
  cid_to_snomed_map
  normalized_cids
  distinct_cids
  distinct_sigtap_codes
  sigtap_to_snomed_procedure_map
)

for table in "${TABLES[@]}"; do
  echo "==> syncing ${table}"
  attempt=1
  until gcloud storage rsync -r "${BUCKET}/${table}/" "${DEST}/${table}/"; do
    if [ "${attempt}" -ge 3 ]; then
      echo "==> ${table} failed after ${attempt} attempts, moving on (rerun this script to retry)"
      break
    fi
    echo "==> ${table} sync failed (attempt ${attempt}), retrying -- rsync is idempotent, already-synced files are skipped"
    attempt=$((attempt + 1))
    sleep 5
  done
done

echo "==> done. Local mirror at ${DEST}"
du -sh "${DEST}"/*
