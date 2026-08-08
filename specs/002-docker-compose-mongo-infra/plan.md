# Implementation Plan: Docker Compose containerization with MongoDB

**Spec**: `specs/002-docker-compose-mongo-infra/spec.md`

## Architecture

```
                 ┌─────────────────────────┐
  :80  ────────► │  proxy  (nginx:alpine)  │
                 │  serves web/  at /      │
                 │  serves admin/ at /admin│
                 │  proxies /api/  ────────┼────►  ┌──────────────────────┐
                 │  proxies /uploads/ ─────┼────►  │  api (oven/bun)      │
                 └─────────────────────────┘       │  api/server.ts       │  :8080
                                                    │  MONGO_URI=mongo://db│
                                                    └──────────┬───────────┘
                                                               │
                                                    ┌──────────▼───────────┐
                                                    │  db (mongo:7.0)      │  :27017
                                                    │  volume: mongo_data  │
                                                    └──────────────────────┘
```

All three services share a bridge network (`granada_net`). Two named volumes: `mongo_data` (Mongo's
own data directory) and `uploads_data` (mounted read-write in `api`, read-only in `proxy` so Nginx
can serve `/uploads/*` directly without round-tripping through Bun).

## Database layer (`api/db.ts`)

A thin persistence module, imported by `api/server.ts`, exposing one async function per operation
the server needs — no ORM, no query builder, mirroring the existing inline SQL as closely as
possible so the diff in `server.ts` is a mechanical swap, not a rewrite:

```ts
initDatabase(sqlitePath: string, mongoUri?: string): Promise<void>
isMongoMode(): boolean
getTraces(approvedOnly: boolean): Promise<TraceRecord[]>
getTraceById(id: string): Promise<TraceRecord | null>
createTrace(trace: TraceRecord): Promise<void>
addTracePhoto(traceId, photoId, photoPath, position, createdAt): Promise<void>
getTracePhotos(traceId: string): Promise<TracePhotoRecord[]>
updateTraceStatus(id: string, status: string): Promise<boolean>
updateTrace(id: string, updates: Partial<TraceRecord>): Promise<boolean>   // feeling-only, enforced by the caller in server.ts, not by db.ts
deleteTrace(id: string): Promise<TraceRecord | null>                       // returns the row it deleted, for cleanup of files on disk
addAuditLog(id, action, traceId, sourceIp, createdAt): Promise<void>
getAuditLogs(limit: number): Promise<AuditLogRecord[]>
addNotifySignup(id, email, sourceIp, createdAt): Promise<void>
closeDatabase(): Promise<void>                                             // needed so `bun test` can spawn/kill server instances cleanly
```

Backend selection: if `mongoUri` (or `process.env.MONGO_URI`) is set, every function talks to
MongoDB (`mongodb` npm driver) collections `traces`, `trace_photos`, `audit_log`,
`notify_signups`. Otherwise every function falls back to the existing `bun:sqlite` tables, unchanged
in shape from what `initDb()` creates today.

MongoDB document shape for `traces` — GeoJSON so the `2dsphere` index is usable for future
geospatial queries:

```json
{
  "id": "...", "name": "...", "email": "...", "city": "...", "country": "...",
  "relation": "...", "emotion": "...", "feeling": "...", "consent": 1,
  "photo": "...", "photos": ["...", "..."], "status": "pending",
  "location": { "type": "Point", "coordinates": [lng, lat] },
  "lat": 0, "lng": 0, "created_at": "...", "deletion_token_hash": null
}
```

`lat`/`lng` are kept alongside `location` (denormalized) so `getTraces`/`getTraceById` don't need a
`$geoNear` just to answer "what are this trace's coordinates" — read them straight off the document
the same way SQLite reads its own columns.

## Wiring `api/server.ts` (the part the discarded attempt skipped)

Every one of these currently talks to `bun:sqlite` directly and must instead call the `db.ts`
functions above:

- `initDb()` (line ~340) → replaced by an `await initDatabase(DB_PATH, process.env.MONGO_URI)`
  call at startup (currently `initDb()` is called synchronously right before `Bun.serve()`, ~line
  1637 — `main` must become `async` if it isn't already, or the call site wrapped accordingly).
- `handleGetTraces` (~866), `handleGetAdminTraces` (~873) → `getTraces()`.
- `handleCreateTrace` (~1102) → `createTrace()` + `addTracePhoto()` per extra photo.
- `handleNotifySignup` (~1275) → `addNotifySignup()`.
- `handleUpdateStatus` (~1308) → `updateTraceStatus()`.
- `handleUpdateTrace` (~1328, feeling-only) → `updateTrace()`.
- `deleteTraceRow` (~1383), `handleDeleteTrace` (~1397), `handleSelfDeleteTrace` (~1412) →
  `deleteTrace()`, then the existing `unlinkUploadFile()` disk cleanup stays as-is (files are never
  stored in Mongo, only their paths).
- `recordAuditLog` (~904), `handleGetAuditLog` (~924) → `addAuditLog()` / `getAuditLogs()`.
- `GET /api/health` (inline in `handleRequest`, ~1524) → `storage` and `database` fields must
  reflect `isMongoMode()`, not be hardcoded to `"sqlite"`.

None of these functions are called from more than one place outside `handleRequest`, and
`handleRequest` is already `async` and already does `return handleX(...)` for all of them — making
the handlers themselves `async function` and returning `Promise<Response>` requires **no changes
in `handleRequest`** (an async function's `return <promise>` already awaits it for the caller).

## Docker artifacts

- `Dockerfile.api` — `oven/bun:1-alpine`, `bun install --frozen-lockfile --production`, copies
  `api/` and `config.json`, `HEALTHCHECK` against `GET /api/health`, `CMD ["bun", "run",
  "api/server.ts"]`.
- `Dockerfile.gateway` — `nginx:alpine`, copies `docker/nginx/default.conf`, copies `web/` and
  `admin/` into `/var/www/html/`.
- `docker/nginx/default.conf` — `location /` → static `web/`; `location /admin/` → static
  `admin/`; `location /api/` → `proxy_pass http://api:8080/api/`; `location /uploads/` → serves
  the shared `uploads_data` volume directly (read-only) so uploaded photos don't round-trip through
  Bun on every request.
- `docker-compose.yml` — services `db` (`mongo:7.0`, healthcheck via `mongosh --eval
  "db.adminCommand('ping')"`), `api` (`depends_on: db: condition: service_healthy`, env
  `MONGO_URI=mongodb://db:27017/granada2031`, volumes for `uploads_data` and — for the SQLite
  fallback path to also be safe under Docker — `data_data:/app/data`), `proxy` (`depends_on: api`,
  port `80:80`, read-only mount of `uploads_data`). Named volumes: `mongo_data`, `uploads_data`,
  `data_data`. Network: `granada_net` (bridge).
- `.env.example` — documents `MONGO_URI`, `MONGO_DB_NAME`, and the existing `GRANADA_*` env vars
  `server.ts` already supports.

## Testing strategy

The existing 31 `bun test` smoke tests in `api/tests/smoke.test.ts` must keep passing unmodified —
they exercise the SQLite fallback path and are the regression net for User Story 1's scenario 2.

A new test file, `api/tests/smoke-mongo.test.ts`, mirrors the same HTTP scenarios but only runs
when a real MongoDB is reachable: read `GRANADA_TEST_MONGO_URI` from the environment, and if unset,
skip the whole file (`test.skipIf(!process.env.GRANADA_TEST_MONGO_URI)`) rather than failing —
CI/local machines without Docker/Mongo installed must not break. Document in `README.md` how to run
it locally: start a throwaway Mongo (`docker run --rm -d -p 27017:0 mongo:7.0`) and export
`GRANADA_TEST_MONGO_URI` before `bun test`.

The Docker Compose acceptance test (User Story 2) is manual/scripted shell, not `bun test`: bring
the stack up, `curl` the three surfaces, submit a real trace through the HTTP API, and confirm the
document via `mongosh` inside the `db` container — this is the check that would have caught the
discarded attempt's core defect (a compose file wired to a server that ignored it).
