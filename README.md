# Granada 2031 - Geolocalizacion del Sentimiento

Navigable MVP with server-side storage for the "Geolocalizacion del Sentimiento" campaign.

The public map supports mouse-wheel zoom, `+`/`-` controls, view reset, and drag panning across regions with a high concentration of photos. The public site's visual design follows a reference provided by the project owner.

## Storage

The MVP uses SQLite as the server's local database:

- Database file: `data/granada2031.sqlite3`
- Uploaded images: `uploads/`
- Admin secrets: `.dev` (git-ignored)
- Public configuration: `config.json`
- Server: Bun (JavaScript/TypeScript runtime) with built-in SQLite support (`bun:sqlite`), no external server-side dependencies.

SQLite is the right choice for this phase: it needs no separate database service, backups are a single-file copy, and it comfortably handles a first moderated participatory campaign.

For a production phase with thousands of contributions, advanced geo search, analytics, or multi-user administration, the natural migration path is PostgreSQL with PostGIS and image storage in S3/MinIO.

## Frontend dependencies

The frontend includes **one external JavaScript dependency: Leaflet** (https://leafletjs.com), a lightweight map library. Leaflet is vendored as static assets under `web/vendor/leaflet/` and **not loaded from a CDN**. This removes external network dependencies at runtime.

The project uses Leaflet to render interactive OpenStreetMap (OSM) tiles for the participatory map. Per OSM's tile usage policy, the map includes proper attribution: "© OpenStreetMap contributors" (visible on the map's bottom-right corner via Leaflet's attribution control).

See `web/app.js` (lines 29–42) for Leaflet initialization and tile layer setup, including the required OSM attribution string.

## Project layout

Each concern lives in its own top-level folder:

```text
web/     # public site: index.html, app.js, styles.css, politica-de-privacidad.html, aviso-legal.html
admin/   # admin review panel: admin.html, admin.js
api/     # backend: server.ts and its test suite (api/tests/smoke.test.ts)
config.json   # public config (versioned)
.dev          # admin secrets (git-ignored)
data/         # SQLite database (runtime state)
uploads/      # uploaded images (runtime state)
```

The site still runs as a single Bun process (`api/server.ts`'s `Bun.serve`), which serves the
static files from `web/` and `admin/` and exposes the `/api/*` endpoints. Backend source under
`api/`, the `.dev` secrets file, and everything else outside the allowlisted static assets are
never reachable over HTTP.

## Running on Ubuntu 22.04

```bash
cd /path/to/project
bun run api/server.ts --host 0.0.0.0 --port 8080
```

Open:

```text
http://SERVER_IP:8080
```

Locally, if you're working on the machine itself:

```text
http://localhost:8080
```

Important: don't open `web/index.html` by double-clicking it or via a separate static server. Photo uploads need this same application served from `api/server.ts`, because that's where the API, SQLite, and the `uploads/` folder live.

## Running with Docker Compose (MongoDB stack)

For development and small deployments, the project includes a complete containerized stack using Docker Compose:

- **MongoDB** (`db` service): persistent document database at `mongodb://db:27017/granada2031`
- **Bun API** (`api` service): Granada server backed by MongoDB instead of SQLite
- **Nginx gateway** (`proxy` service): public site, admin panel, and API reverse proxy on port 80

All services are isolated in a custom bridge network (`granada_net`), with health checks to ensure startup order and reliability.

### Quick start with Docker Compose

1. **Copy the environment template:**

```bash
cp .env.example .env
```

The `.env` file sets up MongoDB connection (`MONGO_URI`), database name (`MONGO_DB_NAME`), and paths for uploads and data. You can accept the defaults for local development, or customize the values for your environment.

2. **Build and start all services:**

```bash
docker-compose up -d --build
```

The `--build` flag rebuilds the `api` and `proxy` images. The `-d` flag runs in the background. Docker Compose will:
- Start the MongoDB container and wait for it to be healthy (via `mongosh ping`)
- Build and start the API service, waiting for MongoDB to be ready
- Build and start the Nginx gateway, waiting for the API to be healthy

3. **Verify the stack is running:**

```bash
curl http://localhost/api/health
```

Expected response:

```json
{
  "ok": true,
  "service": "mapamundi",
  "storage": "mongodb"
}
```

Open `http://localhost` in your browser to see the public map and `http://localhost/admin/` for the admin panel.

### Migrating SQLite data to MongoDB

If you have an existing SQLite database (from running the server without Docker), the migration script safely upserts all documents into MongoDB without duplicating data.

**Before migrating:** stop any running `api/server.ts` process to avoid locks on the SQLite file.

1. **Run the migration against your local MongoDB:**

```bash
# Ensure the stack is running
docker-compose up -d

# Run the migration
MONGO_URI=mongodb://localhost:27017/granada2031 bun run scripts/migrate-sqlite-to-mongo.ts
```

The script reads from `data/granada2031.sqlite3` (or `$GRANADA_DB_PATH` if set), imports all traces, photos, audit logs, and signup notifications into MongoDB, and prints progress:

```
[migrate] Migrated 42 traces
[migrate] Migrated 87 trace photos
[migrate] Migrated 15 audit log entries
[migrate] Migrated 8 signups

[migrate] ✓ Migration complete!
[migrate] Summary:
  - traces: 42
  - trace_photos: 87
  - audit_log: 15
  - notify_signups: 8
```

2. **Verify the migration in MongoDB:**

```bash
docker exec granada-db mongosh granada2031 --eval "db.traces.countDocuments()"
```

The count should match the number of traces in your original SQLite database.

3. **Idempotency check** (safe to re-run):

The script uses `upsert` internally, so running it a second time is safe. Each row is processed again and the summary will show the same counts (confirming no documents were duplicated):

```bash
MONGO_URI=mongodb://localhost:27017/granada2031 bun run scripts/migrate-sqlite-to-mongo.ts
```

You will see the same summary output again — no duplicates, no errors.

### Stopping and cleaning up

To stop all services:

```bash
docker-compose down
```

To remove all volumes (database data, uploads, and app data):

```bash
docker-compose down -v
```

### Important: SQLite still works without Docker

Plain `bun run api/server.ts` with no Docker and no `MONGO_URI` environment variable continues to use SQLite exactly as before. The MongoDB feature is **optional** — you can use either backend, and the fallback is permanent.

To run SQLite mode locally:

```bash
bun run api/server.ts --host 0.0.0.0 --port 8080
```

Logs will show `[db.ts] SQLite initialized at ...`. No Docker, no external services required.

## Testing

### SQLite smoke tests (default)

The project has a smoke test file, `api/tests/smoke.test.ts`, run with Bun's built-in test runner:

```bash
bun test
```

It spawns `api/server.ts` as a real child process on an OS-assigned ephemeral port, pointed at a
throwaway temp directory (via `GRANADA_DATA_DIR`, `GRANADA_UPLOAD_DIR`, `GRANADA_DB_PATH`,
`GRANADA_CONFIG_PATH`, `GRANADA_SECRETS_PATH`), and drives it over HTTP with `fetch`. It never
touches `data/`, `uploads/`, `config.json`, or `.dev` in the project root. `bun test` exits
non-zero with a clear failure message if any check fails — no extra flags needed.

### MongoDB smoke tests (optional, requires Docker)

A second test file, `api/tests/smoke-mongo.test.ts`, mirrors the same scenarios but against a real
MongoDB database. This test file is **skipped automatically** when `GRANADA_TEST_MONGO_URI` is unset,
so machines without Docker/MongoDB installed will see tests reported as "skipped" rather than failed.

To run the MongoDB smoke tests locally:

1. **Start a throwaway MongoDB container:**

```bash
docker run --rm -d -p 27017:27017 --name granada-test-mongo mongo:7.0
```

2. **Export the MongoDB connection string:**

```bash
export GRANADA_TEST_MONGO_URI=mongodb://localhost:27017/granada2031-smoke
```

3. **Run the full test suite (both SQLite and MongoDB):**

```bash
bun test
```

4. **Clean up when done:**

```bash
docker stop granada-test-mongo
```

Both test files verify the exact same HTTP scenarios (health check, config, create trace, approval flow,
delete, notifications) and confirm that the API works identically whether backed by SQLite or MongoDB.

Extend `api/tests/smoke.test.ts` or `api/tests/smoke-mongo.test.ts` as new endpoints or behaviors land.

## Admin password

Administration is protected server-side. Secrets live in a local `.dev` file that **is not committed to the repository** (it's in `.gitignore`). If it doesn't exist, the server creates it on startup with a random session secret. Change these values before publishing:

```json
{
  "admin_password": "change-this-password",
  "admin_session_secret": "change-this-long-secret-too"
}
```

Visible text still lives in `config.json`, which is versioned. `/api/config` only returns the `public` block to the browser, never the password or the session secret:

```json
{
  "public": {
    "site_title": "Granada 2031 | Geolocalizacion del Sentimiento",
    "brand_name": "Granada 2031",
    "brand_subtitle": "Geolocalizacion del Sentimiento",
    "brand_logo": "/assets/logo-granada2031.png",
    "footer_text": "Granada 2031. Geolocalizacion del Sentimiento.",
    "privacy_label": "Politica de privacidad",
    "privacy_url": "/politica-de-privacidad",
    "legal_label": "Aviso legal",
    "legal_url": "/aviso-legal",
    "ideal_logo": "/assets/logo-ideal.png",
    "ideal_url": "https://www.ideal.es"
  }
}
```

These files must be at the project root:

```text
.dev          # secrets, git-ignored
config.json   # public text, versioned
```

After editing it:

```bash
sudo systemctl restart mapamundi
```

## Text, logos, and legal links

The homepage reads visible text from `config.json`, inside the `public` block. There you can change:

- Browser title, brand name/subtitle, and main logo.
- Hero, call-to-action, map, form, and archive text.
- Form consent text.
- Footer, privacy policy link, legal notice link, and IDEAL logo.

To use logos, upload the files to the project, e.g.:

```text
/var/www/mapamundi/assets/logo-granada2031.png
/var/www/mapamundi/assets/logo-ideal.png
```

And set their paths as relative URLs:

```json
{
  "public": {
    "brand_logo": "/assets/logo-granada2031.png",
    "ideal_logo": "/assets/logo-ideal.png"
  }
}
```

If you leave `brand_logo` or `ideal_logo` empty, the site falls back to the default visual placeholder and the `IDEAL` text.

## Quick API check

If the API is wired up correctly, this should return JSON:

```bash
curl http://localhost:8080/api/health
```

Expected response:

```json
{
  "ok": true,
  "service": "mapamundi",
  "storage": "sqlite"
}
```

If `https://mapamundi.2031granadaideal.es/api/health` returns 404, Nginx isn't forwarding `/api` to the Bun process.

## Recommended Nginx configuration

Use Nginx as a full proxy in front of `api/server.ts`. Don't serve `web/index.html` directly from Nginx in this MVP, since the API lives on the same Bun server.

```nginx
server {
    listen 80;
    server_name mapamundi.2031granadaideal.es;

    client_max_body_size 8M;

    # Security headers (defense in depth, complement server-side T013 headers)
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org" always;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Note on HTTPS:** When HTTPS is enabled (see "Production security note" below), create a second block with `listen 443 ssl http2` and include `Strict-Transport-Security` header. Browsers ignore HSTS over plain HTTP per RFC 6797, so it belongs only on the HTTPS block:

```nginx
server {
    listen 443 ssl http2;
    server_name mapamundi.2031granadaideal.es;

    # TLS certificates (e.g., from Let's Encrypt via Certbot)
    ssl_certificate /etc/letsencrypt/live/mapamundi.2031granadaideal.es/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mapamundi.2031granadaideal.es/privkey.pem;

    client_max_body_size 8M;

    # Security headers (same as HTTP block, plus HSTS which only works on HTTPS)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org" always;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Included API

```text
GET    /api/traces
GET    /api/config
POST   /api/traces
POST   /api/admin/login
GET    /api/admin/traces
PATCH  /api/admin/traces/{id}/status
PATCH  /api/admin/traces/{id}
DELETE /api/admin/traces/{id}
```

`GET /api/traces` only returns approved contributions.

`/api/admin/*` endpoints require login. The frontend obtains a temporary token using the password defined in `.dev`.

## Admin access

Open the admin panel from:

```text
https://mapamundi.2031granadaideal.es/admin
```

This also works:

```text
https://mapamundi.2031granadaideal.es/admin/
```

The public homepage doesn't surface the admin entry point. The review screen lives in `admin/admin.html`, served from `/admin` (and `/admin/`), which the server maps to that file directly.

Don't open routes like `/api/admin` or `/api/admin/login` directly; they're internal endpoints for the form.

If `/admin/` returns "File not found", check on the server:

```bash
ls -la /var/www/mapamundi/admin/
ls -la /var/www/mapamundi/admin/admin.html
sudo systemctl restart mapamundi
```

`POST /api/traces` accepts a `multipart/form-data` submission with:

- `name`
- `email`
- `city`
- `country`
- `relation`
- `emotion`
- `feeling`
- `consent`
- `photo`

New contributions come in as `pending`. From the "Review queue" section they can be approved or rejected.

## Troubleshooting

If a photo upload triggers a request or API error, check:

1. That the server is running:

```bash
bun run api/server.ts --host 0.0.0.0 --port 8080
```

2. That you opened the site from the server's URL:

```text
http://localhost:8080
```

3. That you're not accessing it via:

```text
file:///...
```

4. That the process user has write permissions on:

```text
data/
uploads/
```

## Backup

For a local SQLite database, stop the service or take an atomic backup:

```bash
sqlite3 data/granada2031.sqlite3 ".backup 'backup-granada2031.sqlite3'"
tar -czf backup-uploads.tar.gz uploads/
```

Production backups are covered under "Deployment" below.

## Deployment

Production runs the same two compose files as development, plus an overlay:

```bash
docker compose -p granada -f docker-compose.yml -f docker-compose.prod.yml up -d
```

`docker-compose.prod.yml` publishes nothing to a public interface. MongoDB gets
no host port at all — Docker publishes past the firewall, so `27017:27017`
would put the database on the internet — and the API and gateway bind to
loopback. The host's own Nginx terminates TLS and proxies to the gateway on
`127.0.0.1:8081`; see `deploy/nginx-mapamundi.conf`. When the stack is down or
mid-restart, that vhost serves `deploy/maintenance.html` instead of a bare
gateway error, preserving the 502/503/504 status so uptime checks still see a
failure.

### Configuration and credentials

MongoDB requires authentication. Two accounts exist: a root account for
administration and `mongodump`/`mongorestore`, and an application account with
`readWrite` on the application database only. Both are created by
`docker/mongo-init/01-app-user.js` the first time MongoDB initializes an empty
data directory — changing the passwords afterwards means altering the users in
the database, not just editing configuration.

Production values live in `/etc/granada/.env` on the server, owned by `root`
and readable by the `granada` group. They are not in this repository. For local
development, `cp .env.example .env` gives you the same authenticated setup with
development passwords, so what you run locally matches production rather than a
simplified variant of it.

### Deploying

`scripts/deploy.sh` is the only deployment procedure. The GitHub Actions
workflow calls it, and you call it directly on the server when Actions is
unavailable — out of credit, offline, runner down. Both paths run identical
steps, so a manual deploy cannot drift from a CI one.

```bash
# On the server, as the fallback path:
cd /opt/mapamundi
./scripts/deploy.sh --pull
```

It refuses by default to deploy a working tree with uncommitted changes, or a
commit that is not on `origin/main`, so production always corresponds to a
commit someone else can look up. `--allow-dirty` overrides this for emergencies.

The steps are: start the database, back up, build, apply pending migrations,
start the new containers, wait for health. Migrations run before the new API
serves traffic, so the application never meets a schema it does not understand.

### Migrations

Schema changes go in numbered files under `migrations/`, not in the boot path:

```ts
// migrations/0002-add-moderation-notes.ts
export const description = "Add moderation_notes to traces"

export async function up(db) {
  await db.collection("traces").updateMany(
    { moderation_notes: { $exists: false } },
    { $set: { moderation_notes: [] } },
  )
}
```

Each file runs exactly once, in filename order, recorded in the
`schema_migrations` collection.

```bash
docker compose -p granada run --rm --no-deps -T api bun run scripts/migrate.ts --status
docker compose -p granada run --rm --no-deps -T api bun run scripts/migrate.ts
```

Write them additively — add a field, backfill it, and only drop the old one in a
later migration once nothing reads it. That way the previous version of the
application keeps working against the new schema, so rolling back code does not
require restoring data.

### Backups and restore

`scripts/backup.sh` writes a `mongodump` archive, a tar of the uploads volume,
and a manifest naming the commit and the row count into one timestamped
directory under `/var/backups/granada`. It verifies both archives decompress
before reporting success, and prunes past the retention window while always
keeping the three most recent.

It runs before every deploy and nightly from a systemd timer
(`deploy/granada-backup.timer`).

```bash
scripts/restore.sh                          # list what is available
scripts/restore.sh /var/backups/granada/... --yes
```

`restore.sh` takes a safety backup of the current state before overwriting
anything, so a restore to the wrong snapshot is itself recoverable.

### Continuous integration

`.github/workflows/ci.yml` runs the test suites on pull requests, and
`deploy.yml` deploys pushes to `main`. Both use the self-hosted runner on the
production host, which costs no GitHub minutes.

Because that machine also serves production, the test workflow is kept
deliberately cheap: the SQLite suite needs no database, the MongoDB suite gets a
single throwaway container capped at one CPU and 512 MB, and superseded runs are
cancelled rather than queued.

Neither workflow uses secrets. The database credentials never leave
`/etc/granada/.env` on the server.

## Production security note

This MVP prioritizes navigability and technical flow. Before publishing it, the following should be added:

- Authentication for the review queue.
- HTTPS via Nginx/Caddy.
- Full GDPR policy.
- Image scanning/normalization.
- Per-IP limits and anti-spam protection.
- Separation between the public API and the admin panel.
