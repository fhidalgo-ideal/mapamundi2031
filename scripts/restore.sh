#!/usr/bin/env bash
# Restores a backup produced by scripts/backup.sh.
#
# Usage:
#   scripts/restore.sh                       # list available backups
#   scripts/restore.sh <backup-dir> --yes    # restore that backup
#
# This overwrites the live database and uploads, so it refuses to run without
# --yes and takes a safety backup of the current state first.
set -euo pipefail

PROJECT=${COMPOSE_PROJECT_NAME:-granada}
BACKUP_ROOT=${GRANADA_BACKUP_DIR:-/var/backups/granada}
DB_CONTAINER="${PROJECT}-db"
API_CONTAINER="${PROJECT}-api"
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

SOURCE=${1:-}
CONFIRM=${2:-}

if [ -z "$SOURCE" ]; then
  echo "Available backups in ${BACKUP_ROOT}:"
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | while read -r dir; do
    printf '  %s  ' "$dir"
    grep -h '^traces=' "${dir}/manifest.txt" 2>/dev/null || echo "(no manifest)"
  done
  echo
  echo "Restore with: $0 <backup-dir> --yes"
  exit 0
fi

if [ ! -f "${SOURCE}/mongo.archive.gz" ]; then
  echo "Not a backup directory (no mongo.archive.gz): ${SOURCE}" >&2
  exit 1
fi

if [ "$CONFIRM" != "--yes" ]; then
  echo "This replaces the live database and uploads with ${SOURCE}." >&2
  echo "Re-run with --yes to proceed." >&2
  exit 1
fi

MONGO_DB_NAME_VALUE=${MONGO_DB_NAME:-granada2031}
AUTH_ARGS=()
if [ -n "${MONGO_ROOT_USER:-}" ]; then
  AUTH_ARGS=(--username "$MONGO_ROOT_USER" --password "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin)
fi

echo "=== Safety backup of current state ==="
"${SCRIPT_DIR}/backup.sh" pre-restore

echo "=== Restoring database ==="
# --drop replaces the collections present in the archive; combined with the
# safety backup above, that keeps the operation recoverable in both directions.
docker exec -i "$DB_CONTAINER" mongorestore \
  "${AUTH_ARGS[@]}" \
  --archive --gzip --drop < "${SOURCE}/mongo.archive.gz"

echo "=== Restoring uploads ==="
docker exec -i "$API_CONTAINER" sh -c 'rm -rf /app/uploads/* && tar xzf - -C /app/uploads' \
  < "${SOURCE}/uploads.tar.gz"

echo "=== Result ==="
docker exec "$DB_CONTAINER" mongosh --quiet "${AUTH_ARGS[@]}" "$MONGO_DB_NAME_VALUE" \
  --eval 'print("traces: " + db.traces.countDocuments({}))'
docker exec "$API_CONTAINER" sh -c 'echo "uploads: $(ls -1 /app/uploads | wc -l)"'

echo "Restore complete. Restart the API so it picks up the restored data:"
echo "  docker compose -p ${PROJECT} restart api"
