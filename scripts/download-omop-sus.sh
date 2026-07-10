#!/usr/bin/env bash
#
# Downloads the DATASUS-OMOP export (gs://omop-sus/exports/ihealth_omop_sus)
# to a local directory. Safe to re-run: uses `gcloud storage rsync`, which
# skips files that already match (by checksum), so an interrupted download
# resumes instead of restarting from zero.
#
# Usage:
#   ./scripts/download-omop-sus.sh [options]
#
# Options:
#   -d, --dest DIR       Destination directory (default: ../data/omop-sus relative to this script)
#   -t, --table NAME      Download a single table only (repeatable), e.g. -t person -t care_site
#                          Default: all tables.
#   -j, --parallelism N   Max concurrent transfer workers (default: 16)
#   --dry-run              Show what would be downloaded without transferring anything
#   --list-tables          Print available table names and exit
#   -y, --yes               Skip the confirmation prompt
#   -h, --help               Show this help
#
# Requires: gcloud CLI, authenticated as an account with read access to
# gs://omop-sus (project shc-project-275622).

set -euo pipefail

PROJECT="shc-project-275622"
BUCKET_ROOT="gs://omop-sus/exports/ihealth_omop_sus"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${SCRIPT_DIR}/../data/omop-sus"
PARALLELISM=16
DRY_RUN=false
LIST_TABLES=false
ASSUME_YES=false
declare -a TABLES=()

ALL_TABLES=(
  apac_condition_occurrence
  apac_drug_exposure
  apac_person
  apac_visit_occurrence
  care_site
  cid_to_snomed_map
  condition_occurrence
  distinct_cids
  distinct_sigtap_codes
  location
  normalized_cids
  person
  procedure_occurrence
  sigtap_to_snomed_procedure_map
  sus_internacao_resumo
  visit_occurrence
)

usage() {
  sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--dest) DEST_DIR="$2"; shift 2 ;;
    -t|--table) TABLES+=("$2"); shift 2 ;;
    -j|--parallelism) PARALLELISM="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --list-tables) LIST_TABLES=true; shift ;;
    -y|--yes) ASSUME_YES=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if $LIST_TABLES; then
  printf '%s\n' "${ALL_TABLES[@]}"
  exit 0
fi

if [[ ${#TABLES[@]} -eq 0 ]]; then
  TABLES=("${ALL_TABLES[@]}")
fi

command -v gcloud >/dev/null 2>&1 || { echo "gcloud CLI not found in PATH." >&2; exit 1; }

if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
  echo "No active gcloud account. Run: gcloud auth login" >&2
  exit 1
fi

echo "Account: $(gcloud auth list --filter=status:ACTIVE --format='value(account)')"
echo "Project: ${PROJECT}"
echo "Source:  ${BUCKET_ROOT}"
echo "Dest:    ${DEST_DIR}"
echo "Tables:  ${TABLES[*]}"
echo

echo "Checking source size..."
TOTAL_SIZE_LINE=$(gcloud storage du -s --readable-sizes --project="${PROJECT}" "${BUCKET_ROOT}" 2>&1)
echo "  ${TOTAL_SIZE_LINE}"

AVAIL_KB=$(df -Pk "${SCRIPT_DIR}" | awk 'NR==2 {print $4}')
AVAIL_GIB=$(( AVAIL_KB / 1024 / 1024 ))
echo "  Local free space at destination: ${AVAIL_GIB} GiB"
echo

if ! $ASSUME_YES && ! $DRY_RUN; then
  read -r -p "Proceed with download? [y/N] " REPLY
  [[ "${REPLY}" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

mkdir -p "${DEST_DIR}"
LOG_FILE="${DEST_DIR}/download-$(date +%Y%m%d-%H%M%S 2>/dev/null || echo run).log"
echo "Logging to ${LOG_FILE}"
echo

RSYNC_FLAGS=(-r --project="${PROJECT}")
$DRY_RUN && RSYNC_FLAGS+=(--dry-run)

FAILED=()
for TABLE in "${TABLES[@]}"; do
  SRC="${BUCKET_ROOT}/${TABLE}"
  DST="${DEST_DIR}/${TABLE}"
  mkdir -p "${DST}"
  echo "=== ${TABLE} ==="
  if gcloud storage rsync "${RSYNC_FLAGS[@]}" "${SRC}" "${DST}" 2>&1 | tee -a "${LOG_FILE}"; then
    echo "  done: ${TABLE}"
  else
    echo "  FAILED: ${TABLE}" | tee -a "${LOG_FILE}"
    FAILED+=("${TABLE}")
  fi
  echo
done

if $DRY_RUN; then
  echo "Dry run complete. No files were transferred."
  exit 0
fi

echo "=== Verifying ==="
LOCAL_SIZE=$(du -sh "${DEST_DIR}" 2>/dev/null | awk '{print $1}')
echo "Local total size: ${LOCAL_SIZE}"
echo "Remote total size: ${TOTAL_SIZE_LINE}"

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo
  echo "The following tables had errors and should be re-run:"
  printf '  %s\n' "${FAILED[@]}"
  echo "Re-run this script (safe to repeat) to retry failed/incomplete tables — already-synced files are skipped."
  exit 1
fi

echo
echo "All tables synced successfully."
