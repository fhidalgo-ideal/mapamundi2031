#!/usr/bin/env bash
# The single way to deploy this project.
#
# The GitHub Actions workflow calls this script, and so do you when you run it
# by hand on the server. There is deliberately no second procedure: if Actions
# is unavailable — the account ran out of credit, GitHub is down, the runner is
# offline — the fallback is the same script with the same steps, so what ships
# by hand is what would have shipped through CI.
#
#   scripts/deploy.sh              # deploy the current checkout
#   scripts/deploy.sh --pull       # fetch origin/main first, then deploy
#   scripts/deploy.sh --allow-dirty  # deploy uncommitted local changes
#
# Refuses by default to deploy code that is not on origin/main, so production
# always corresponds to a commit someone can look up.
set -euo pipefail

PROJECT=${COMPOSE_PROJECT_NAME:-granada}
REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE=${GRANADA_ENV_FILE:-/etc/granada/.env}
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)

PULL=false
ALLOW_DIRTY=false
for arg in "$@"; do
  case "$arg" in
    --pull) PULL=true ;;
    --allow-dirty) ALLOW_DIRTY=true ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

cd "$REPO_DIR"

# Production configuration lives on the server, never in the repository and
# never in GitHub: this file holds the database credentials.
if [ -f "$ENV_FILE" ]; then
  COMPOSE_FILES+=(--env-file "$ENV_FILE")
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  echo "Using env file: ${ENV_FILE}"
else
  echo "Warning: ${ENV_FILE} not found, falling back to compose defaults." >&2
fi

compose() { docker compose -p "$PROJECT" "${COMPOSE_FILES[@]}" "$@"; }

if [ "$PULL" = true ]; then
  echo "=== Fetching origin/main ==="
  git fetch --quiet origin main
  git reset --hard origin/main
fi

echo "=== Version check ==="
HEAD_SHA=$(git rev-parse HEAD)
if [ "$ALLOW_DIRTY" = false ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "Working tree has uncommitted changes. Commit and push them, or pass --allow-dirty." >&2
    exit 1
  fi
  # Best effort: if the remote is unreachable the check below still runs
  # against whatever origin/main this checkout already knows about.
  git fetch --quiet origin main 2>/dev/null || true
  ORIGIN_SHA=$(git rev-parse origin/main 2>/dev/null || echo "")
  if [ -z "$ORIGIN_SHA" ]; then
    echo "Cannot determine origin/main. Fetch it first, or pass --allow-dirty." >&2
    exit 1
  fi
  # Equality, not ancestry: a queued CI run can be dispatched long after it was
  # created — when a runner comes back online, say — and would otherwise happily
  # redeploy a commit that main has already moved past, silently reverting
  # everything merged since.
  if [ "$HEAD_SHA" != "$ORIGIN_SHA" ]; then
    echo "HEAD (${HEAD_SHA}) is not the tip of origin/main (${ORIGIN_SHA})." >&2
    echo "Refusing to deploy stale or unpushed code. Pass --allow-dirty to override." >&2
    exit 1
  fi
fi
echo "Deploying ${HEAD_SHA}"

echo "=== Database up ==="
compose up -d --wait db

echo "=== Backup before changing anything ==="
"${REPO_DIR}/scripts/backup.sh" "pre-deploy-${HEAD_SHA:0:7}"

echo "=== Build ==="
compose build

# Migrations run against the database with the new code, before the new API
# serves traffic, so the app never sees a schema it does not understand. The
# one-off container joins the compose network and exits when done.
echo "=== Migrations ==="
compose run --rm --no-deps -T api bun run scripts/migrate.ts

echo "=== Start ==="
compose up -d --remove-orphans

echo "=== Health ==="
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/api/health > /dev/null 2>&1; then
    echo "API healthy"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "API did not become healthy in 60s. Recent logs:" >&2
    compose logs --tail=50 api >&2
    exit 1
  fi
  sleep 2
done

curl -fsS -o /dev/null -w 'gateway: %{http_code}\n' http://127.0.0.1:8081/

docker image prune -f > /dev/null
echo "Deployed ${HEAD_SHA}"
