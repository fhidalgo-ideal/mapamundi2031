#!/usr/bin/env bash
# Backs up the production database and the uploaded photos.
#
# Runs before every deploy and from a daily systemd timer. Each backup is a
# self-contained directory holding a mongodump archive and a tar of the uploads
# volume, so a restore never needs to reassemble pieces from different runs.
#
# Usage: scripts/backup.sh [label]
set -euo pipefail

PROJECT=${COMPOSE_PROJECT_NAME:-granada}
BACKUP_ROOT=${GRANADA_BACKUP_DIR:-/var/backups/granada}
RETENTION_DAYS=${GRANADA_BACKUP_RETENTION_DAYS:-30}
LABEL=${1:-manual}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST="${BACKUP_ROOT}/${STAMP}-${LABEL}"

DB_CONTAINER="${PROJECT}-db"
API_CONTAINER="${PROJECT}-api"

if ! docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null | grep -q true; then
  echo "Backup aborted: container ${DB_CONTAINER} is not running." >&2
  exit 1
fi

mkdir -p "$DEST"
echo "Backing up to ${DEST}"

# --archive writes a single stream, so the dump arrives as one file instead of
# a directory tree that has to be kept consistent with itself.
MONGO_DB_NAME_VALUE=${MONGO_DB_NAME:-granada2031}
AUTH_ARGS=()
if [ -n "${MONGO_ROOT_USER:-}" ]; then
  AUTH_ARGS=(--username "$MONGO_ROOT_USER" --password "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin)
fi

docker exec "$DB_CONTAINER" mongodump \
  --db "$MONGO_DB_NAME_VALUE" \
  "${AUTH_ARGS[@]}" \
  --archive --gzip > "${DEST}/mongo.archive.gz"

# Read the uploads out of the API container, which has the volume mounted. On a
# first deploy the API does not exist yet, so read the volume directly with a
# throwaway container instead of failing the backup that guards the deploy.
if docker inspect -f '{{.State.Running}}' "$API_CONTAINER" 2>/dev/null | grep -q true; then
  docker exec "$API_CONTAINER" tar czf - -C /app/uploads . > "${DEST}/uploads.tar.gz"
elif docker volume inspect "${PROJECT}_uploads_data" > /dev/null 2>&1; then
  echo "Note: ${API_CONTAINER} is not running; reading the uploads volume directly."
  docker run --rm -v "${PROJECT}_uploads_data:/uploads:ro" alpine:3 \
    tar czf - -C /uploads . > "${DEST}/uploads.tar.gz"
else
  # First deploy: the volume does not exist yet. Mounting it here would have
  # Docker create it outside Compose, which then warns on every later command.
  echo "Note: no uploads volume yet; recording an empty archive."
  tar czf "${DEST}/uploads.tar.gz" -T /dev/null
fi

# Record what produced this backup, so a restore can tell which code version
# the data belongs to.
{
  echo "timestamp=${STAMP}"
  echo "label=${LABEL}"
  echo "database=${MONGO_DB_NAME_VALUE}"
  echo "git_commit=$(git -C "$(dirname "$0")/.." rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "traces=$(docker exec "$DB_CONTAINER" mongosh --quiet "${AUTH_ARGS[@]}" "$MONGO_DB_NAME_VALUE" --eval 'db.traces.countDocuments({})' 2>/dev/null || echo unknown)"
} > "${DEST}/manifest.txt"

# A dump that cannot be read back is not a backup. Verifying now means the
# failure surfaces here, not during an emergency restore.
gzip -t "${DEST}/mongo.archive.gz"
gzip -t "${DEST}/uploads.tar.gz"

echo "--- manifest ---"
cat "${DEST}/manifest.txt"
du -sh "$DEST"

# Retention: drop directories older than the window, keeping at least the three
# most recent regardless of age, so a long quiet period cannot leave zero backups.
if [ -d "$BACKUP_ROOT" ]; then
  mapfile -t all < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d | sort)
  total=${#all[@]}
  if [ "$total" -gt 3 ]; then
    for dir in "${all[@]:0:$((total - 3))}"; do
      if [ -n "$(find "$dir" -maxdepth 0 -mtime "+${RETENTION_DAYS}")" ]; then
        echo "Pruning old backup: $dir"
        rm -rf "$dir"
      fi
    done
  fi
fi

echo "Backup complete: ${DEST}"
