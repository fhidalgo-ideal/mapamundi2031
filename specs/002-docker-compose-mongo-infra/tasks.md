# Tasks: Docker Compose containerization with MongoDB

**Input**: `specs/002-docker-compose-mongo-infra/spec.md`, `plan.md`

**Tests**: Yes — every task that touches request handling must keep `bun test` (31 existing smoke
tests) green, and User Story 1 adds a Mongo-specific test file per the strategy in `plan.md`.

## Format: `[ID] [P?] Priority/Difficulty — Description`

- **[P]**: can run in parallel with other open tasks (different files, no dependency).
- Priority: P1 (blocking, nothing else matters without it) → P4 (nice-to-have last).
- Difficulty: easy / medium / hard — sizes the task, not its importance.

## Dependency chain

T001 and T002 both rewrite large parts of `api/server.ts` and `api/db.ts` — same files, so they
are strictly serial (T002 depends on T001). T003 (tests) depends on T002, since it tests the
wiring T002 produces. T004 (`Dockerfile.api`) only needs the final `package.json`/`bun.lock` from
T001 and is otherwise a brand-new, unrelated file — it can run in parallel with T002/T003. T005
(`Dockerfile.gateway` + nginx config) touches no file any other task touches and has no
dependency at all. T006 (`docker-compose.yml`) needs T003, T004, and T005 all done, since its
acceptance criteria require the real, wired-up server plus both Dockerfiles. T007 (migration
script) only needs the `db.ts` API surface from T001 and is a new file — parallel with
T002 onward. T008 (README) documents T006 and T007, so it comes last.

```
T001 ──► T002 ──► T003 ──┐
      └► T004 ───────────┼──► T006 ──► T008
      └► T007 (needs T001 only) ───────┘
T005 (fully independent) ─────────────► T006
```

---

## T001 — P1, medium — MongoDB-or-SQLite persistence module (`api/db.ts`)

Add the `mongodb` npm dependency (`bun add mongodb`) and create `api/db.ts` implementing the full
function surface specified in `plan.md`'s "Database layer" section, backed by SQLite when
`MONGO_URI` is unset (reusing exactly the table/column shapes `initDb()` in `api/server.ts`
creates today — do not change the SQLite schema) and by MongoDB (with the GeoJSON `location` field
and the `2dsphere`/`status+created_at`/unique-`id` indexes described in `plan.md`) when it is set.

This module is not used by anything yet — that's T002. Ship it with its own isolated unit test
(`api/tests/db.test.ts`) covering both backends (Mongo tests behind
`test.skipIf(!process.env.GRANADA_TEST_MONGO_URI)`, same as the strategy in `plan.md`).

**Done when**: `bun test` passes (existing 31 + new db.ts tests), `bunx tsc --noEmit` (or
equivalent typecheck the repo uses) is clean, and `api/db.ts` exports exactly the function
signatures listed in `plan.md`.

## T002 — P1, hard — Wire `api/server.ts` to use `api/db.ts` (depends on T001)

Replace every direct `bun:sqlite` call in `api/server.ts` with a call into the `api/db.ts` module
from T001, per the exact mapping in `plan.md`'s "Wiring `api/server.ts`" section: `initDb()` →
`initDatabase()`, `handleGetTraces`/`handleGetAdminTraces` → `getTraces()`, `handleCreateTrace` →
`createTrace()`/`addTracePhoto()`, `handleNotifySignup` → `addNotifySignup()`,
`handleUpdateStatus` → `updateTraceStatus()`, `handleUpdateTrace` → `updateTrace()` (still
feeling-only — that restriction lives in `server.ts`'s request validation, not in `db.ts`, and
must not regress), `deleteTraceRow`/`handleDeleteTrace`/`handleSelfDeleteTrace` → `deleteTrace()`
(keeping the existing `unlinkUploadFile()` disk cleanup), `recordAuditLog`/`handleGetAuditLog` →
`addAuditLog()`/`getAuditLogs()`.

Update the inline `GET /api/health` handler so `storage` reads `"mongodb"` or `"sqlite"` from
`isMongoMode()`, and `database` reflects whichever backend is actually active (redact credentials
from a Mongo URI the same way `plan.md`'s `initDatabase` log line does) — **this field is used to
verify which server instance a request is about to hit before running anything destructive against
it; it must always be accurate.**

Delete the old inline SQLite code (`let db: Database`, `function initDb()`, and the raw
`sqliteDb.query(...)` calls inside each handler) once every call site goes through `db.ts` — no
dead code left behind.

**Done when**: the existing 31 smoke tests in `api/tests/smoke.test.ts` pass **unmodified**
(nothing about the SQLite-mode HTTP behavior may change), and manually running
`MONGO_URI=mongodb://localhost:27017/granada2031-manual-check bun run api/server.ts` against a
throwaway local Mongo container successfully serves `POST /api/traces` → `GET /api/admin/traces`
→ `PATCH .../status` → `GET /api/traces`, with the document visible via `mongosh`.

## T003 — P1, medium — Mongo-backed smoke tests (depends on T002)

Add `api/tests/smoke-mongo.test.ts`, mirroring the scenarios already covered in
`api/tests/smoke.test.ts` (health, config, create trace, list before/after approval, admin login,
status update, feeling-only edit, delete, notify-signup) but run against a real MongoDB reached via
`GRANADA_TEST_MONGO_URI`. Skip the whole file with `test.skipIf(!process.env.GRANADA_TEST_MONGO_URI)`
when that variable is unset, so `bun test` stays green on machines without Docker/Mongo. Document
in `README.md`'s testing section how to run it locally (spin up a throwaway `mongo:7.0` container,
export the env var, `bun test`).

**Done when**: with a local Mongo running and `GRANADA_TEST_MONGO_URI` exported, `bun test` runs
and passes both smoke files; without it, `bun test` passes with the Mongo file's tests reported as
skipped, not failed.

## T004 [P] — P2, easy — `Dockerfile.api` (depends on T001)

Multi-stage `oven/bun:1-alpine` image: `bun install --frozen-lockfile --production`, copy `api/`
and `config.json`, create `/app/data` and `/app/uploads`, `EXPOSE 8080`, a `HEALTHCHECK` that
curls/wgets `GET /api/health` and treats non-2xx as unhealthy, `CMD ["bun", "run",
"api/server.ts"]`.

**Done when**: `docker build -f Dockerfile.api -t granada-api .` succeeds and `docker run -p
8080:8080 granada-api` serves `GET /api/health` with `{"ok": true, ...}` (SQLite fallback mode,
since no `MONGO_URI` is passed in this standalone check).

## T005 [P] — P2, easy — `Dockerfile.gateway` + Nginx config (no dependencies)

Create `docker/nginx/default.conf`: `location /` serves static `web/`; `location /admin/` serves
static `admin/`; `location /api/` proxies to `http://api:8080/api/`; `location /uploads/` serves
the shared uploads volume directly, read-only. Create `Dockerfile.gateway` (`nginx:alpine`,
copies the config plus `web/` and `admin/` into the image).

**Done when**: `docker build -f Dockerfile.gateway -t granada-gateway .` succeeds. Full routing
is verified in T006 once `api` exists to proxy to.

## T006 — P2, medium — `docker-compose.yml` end-to-end (depends on T003, T004, T005)

Write `docker-compose.yml` per `plan.md`'s architecture: services `db` (`mongo:7.0`, healthcheck,
`mongo_data` volume), `api` (build `Dockerfile.api`, `MONGO_URI=mongodb://db:27017/granada2031`,
`depends_on: db: condition: service_healthy`, volumes for `uploads_data` and `data_data`), `proxy`
(build `Dockerfile.gateway`, `depends_on: api`, port `80:80`, read-only `uploads_data` mount).
Network `granada_net`. Write `.env.example` documenting `MONGO_URI`, `MONGO_DB_NAME`, and the
existing `GRANADA_*` variables.

**Done when** — run this exact sequence and paste the output in the PR description, per the
lesson in `spec.md` about the previous discarded attempt:
1. `docker-compose up -d --build`
2. `curl -s http://localhost/ | head` → public site HTML.
3. `curl -s http://localhost/admin/ | head` → admin panel HTML.
4. `curl -s http://localhost/api/health` → `{"ok":true,"storage":"mongodb",...}`.
5. Submit one real trace through `POST http://localhost/api/traces` (multipart, minimal valid
   JPEG fixture), then `docker exec <db-container> mongosh granada2031 --eval
   "db.traces.countDocuments()"` → count increased by 1.
6. `docker-compose restart` → repeat step 5's count check → data survived the restart.

No task is "done" here on the strength of `docker-compose config` validating or the containers
merely starting — the count-in-Mongo check is the actual proof.

## T007 [P] — P3, medium — SQLite → MongoDB migration script (depends on T001)

Create `scripts/migrate-sqlite-to-mongo.ts`: reads the existing SQLite file (`GRANADA_DB_PATH` or
default), and for every row in `traces`, `trace_photos`, `audit_log`, `notify_signups`, upserts
(by `id`) an equivalent document into the MongoDB collections via `api/db.ts`'s exported
connection helpers, adding the GeoJSON `location` field for traces. Prints a summary count per
collection. Safe to re-run (upsert, not insert) — running it twice must not duplicate documents.

**Done when**: run against a SQLite file seeded with a few traces (including one with extra
photos) plus a target Mongo, then verify document counts and field parity via `mongosh` match the
source SQLite rows; run the script a second time and confirm counts are unchanged.

## T008 — P4, easy — Document Docker + migration in `README.md` (depends on T006, T007)

Add a section to `README.md`: how to run `docker-compose up -d --build` with a `.env` copied from
`.env.example`, what each service does, how to run the migration script, and an explicit note that
plain `bun run api/server.ts` with no Docker and no `MONGO_URI` keeps working exactly as before
(SQLite fallback is not going away).

**Done when**: a developer who has never seen this feature can follow the README section alone to
get the full stack running against Mongo and migrate existing SQLite data into it.
