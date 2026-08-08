# Feature Specification: Docker Compose containerization with MongoDB

**Feature branch**: `002-docker-compose-mongo-infra`

**Created**: 2026-08-09

**Status**: Ready for implementation

**Input**: The MVP runs today as a single Bun process (`api/server.ts`) serving `web/` and `admin/`
as static files, backed by a local SQLite file (`bun:sqlite`). The request is to containerize the
three logical components (public web, admin panel, API) and switch the database to MongoDB, all
orchestrated with a single `docker-compose.yml`.

## Context & motivation

The site needs to run as a set of isolated, reproducible containers instead of a bare-metal Bun
process, and the persistence layer needs to move from a single-file SQLite database to MongoDB —
a document store fits the loosely-structured, participatory nature of the contributions (variable
metadata per submission, geospatial queries for the map) better than a single relational table.

## Non-negotiable lesson from a previous, discarded attempt

An earlier, unreviewed attempt at this same feature produced a `docker-compose.yml`, Dockerfiles,
and a standalone `api/db.ts` MongoDB abstraction — but `api/server.ts` never imported or called
`db.ts`, so the real server kept talking to SQLite regardless of `MONGO_URI`. The Docker Compose
file also never mounted a volume for the SQLite data directory, so — since Mongo was never actually
used — every container restart would have silently lost all submissions. The work was reported as
a finished migration; it was not. It was discarded before merge.

**The actionable lesson: "the module exists" and "tests for the module pass" are not acceptance
criteria. The only acceptance criterion that matters is that `api/server.ts` — the code that
actually serves traffic — reads and writes through the new database layer, verified end-to-end
against a real, running MongoDB container.** Every task below that touches the database layer
must show its work against the live HTTP surface, not just against an isolated unit test.

## User scenarios & requirements

### User Story 1 — MongoDB as the persistence layer (Priority: P1)

As the platform, I need every read/write currently going to SQLite (`traces`, `trace_photos`,
`audit_log`, `notify_signups`) to go through MongoDB when `MONGO_URI` is set, with zero change in
HTTP behavior — same endpoints, same JSON shapes, same status codes.

**Acceptance scenarios**:
1. **Given** `MONGO_URI` is set and a MongoDB instance is reachable, **when** the server starts,
   **then** it connects, creates the `traces`, `trace_photos`, `audit_log`, `notify_signups`
   collections, and creates a `2dsphere` index on `traces.location` (GeoJSON `Point`,
   `[lng, lat]`).
2. **Given** `MONGO_URI` is unset, **when** the server starts, **then** it falls back to the
   existing SQLite behavior unchanged — local `bun run api/server.ts` with no Docker and no Mongo
   must keep working exactly as it does today.
3. **Given** a submission via `POST /api/traces`, **when** MongoDB is active, **then** the document
   lands in the `traces` collection with a GeoJSON `location` field, and every other endpoint
   (`GET /api/traces`, `GET /api/admin/traces`, `PATCH .../status`, `PATCH .../{id}` (feeling-only
   edit), `DELETE /api/admin/traces/{id}`, `DELETE /api/traces/{id}` (self-delete), photo storage,
   `POST /api/notify-signup`, admin audit log) behaves identically to the SQLite path, verified by
   the existing `bun test` smoke suite passing unmodified against both backends.
4. **Given** `GET /api/health`, **when** MongoDB is active, **then** the response's `storage` field
   reads `"mongodb"` and `database` reflects the Mongo connection target (credentials redacted) —
   this field is relied on by humans and agents to confirm which backend/instance a running server
   is actually pointed at before issuing any mutating request against it. This must never regress.

### User Story 2 — Docker Compose orchestration (Priority: P1)

As whoever deploys this, I need `docker-compose up -d --build` to bring up the full stack — web,
admin, API, and MongoDB — connected and working, with no manual steps beyond providing a `.env`.

**Acceptance scenarios**:
1. **Given** the repository and a populated `.env` (from `.env.example`), **when**
   `docker-compose up -d --build` runs, **then** three services start: `db` (MongoDB), `api` (the
   Bun server, `MONGO_URI` pointing at `db`), `proxy` (Nginx serving `web/` at `/`, `admin/` at
   `/admin/`, and reverse-proxying `/api/` and `/uploads/` to the `api` service).
2. **Given** the stack is running, **when** a client browses to `http://localhost/`, **then** the
   public site loads and the OpenStreetMap/Leaflet map renders (this depends on the CSP header
   still allowing `*.tile.openstreetmap.org`, whichever container emits it).
3. **Given** the stack is running, **when** a client submits a contribution through the public
   form (`http://localhost/` → modal → `POST /api/traces` via the proxy) and an admin approves it
   at `http://localhost/admin/`, **then** the document is verifiably present in the `db` container's
   `traces` collection (checked directly, e.g. `docker exec <db container> mongosh --eval
   "db.traces.countDocuments()"`), not just returned successfully over HTTP.
4. **Given** a container restart (`docker-compose restart` or `down` + `up`), **when** the stack
   comes back, **then** both the MongoDB data (named volume) and uploaded photos (named volume)
   persist — nothing is lost.

### User Story 3 — One-time SQLite → MongoDB migration (Priority: P3)

As whoever operates an existing SQLite-backed deployment, I need a script that copies all existing
traces, extra photos, audit log entries, and notify signups into MongoDB, so switching backends
doesn't discard the site's history.

**Acceptance scenarios**:
1. **Given** an existing SQLite file with data and a target `MONGO_URI`, **when**
   `bun run scripts/migrate-sqlite-to-mongo.ts` runs, **then** every row is present as an
   equivalent document in MongoDB (byte-for-byte field parity, GeoJSON added), and running the
   script a second time does not create duplicates (idempotent upsert by `id`).

## Out of scope

- Removing SQLite support entirely. It stays as the zero-infrastructure local-dev default.
- Any change to the public-facing Spanish copy, the design system, or the map/upload UX.
- TLS/HTTPS termination, CI pipeline changes, or production deployment targets beyond a local
  `docker-compose up`.
