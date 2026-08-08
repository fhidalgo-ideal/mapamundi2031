# Tasks: Production hardening of the participatory map platform

**Input**: Design documents from `specs/001-plataforma-mapa-participativo/`

**Prerequisites**: plan.md, spec.md

**Tests**: Yes — the project has no test suite today, and FR-012 requires a smoke test as the only
automated gate. Each user story extends `tests/smoke.test.ts` with its own assertions.

**Organization**: Tasks are grouped by user story so each can be implemented and verified
independently. Everything lives in the same repository (`granada2031`), so dependencies are
intra-project.

## Runtime note

The backend was rewritten from Python (`server.py`, stdlib-only) to Bun/TypeScript (`server.ts`,
using `bun:sqlite`, still zero external dependencies). Environment-variable overrides for storage
paths (`GRANADA_DATA_DIR`, `GRANADA_UPLOAD_DIR`, `GRANADA_DB_PATH`, `GRANADA_CONFIG_PATH`,
`GRANADA_SECRETS_PATH`) — originally tracked as T001 — already ship as part of that rewrite, so
T001 is done and the actionable backlog starts at T002.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel with other tasks in the same phase (different files, no dependency
  between them).
- **[Story]**: the user story this task belongs to (US1..US5). Setup/Foundational carry no tag.
- Every task includes exact file paths.

## Dependencies (summary — overrides the default phase-by-phase chaining)

Everything below touches `server.ts` and/or `tests/smoke.test.ts` — a single file each. Parallel
branches editing the same function (e.g. `handleCreateTrace`, which grows with T003, T005, T006,
T007, T009, and T010) would collide on rebase against `main`, and the merge routine (see
`kb://integrations/auto-work.md`) skips on any real conflict — so, unlike a monorepo with many
files, there's NO attempt at parallelism across stories here: the chain is linear, in the same
order tasks appear in this document (T002→T003→…→T018), except T014 (`README.md` only, unrelated
to any other touched file).

- T003 depends on T002. T004 depends on T003.
- T005 depends on T004. T006 depends on T005. T007 depends on T006. T008 depends on T007.
- T009 depends on T008. T010 depends on T009. T011 depends on T010. T012 depends on T011.
- T013 depends on T012. T014 depends only on T002 (independent of the rest, runs in parallel).
- T015 depends on T013. T016 depends on T015. T017 depends on T016 (reuses the rate-limiter
  structure from T003, already merged at this point in the chain). T018 depends on T017.

---

## Phase 1: Setup

**Purpose**: Isolate test data from production. Already done by the Python→Bun rewrite (see
"Runtime note" above) — env var overrides for storage paths ship with `server.ts` from day one.

- [x] T001 Environment-variable overrides for storage paths in `server.ts`:
  `GRANADA_DATA_DIR`, `GRANADA_UPLOAD_DIR`, `GRANADA_DB_PATH`, `GRANADA_CONFIG_PATH`,
  `GRANADA_SECRETS_PATH`, each falling back to the current default when unset. Default behavior
  in production is unchanged.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Give every story an automated way to verify itself, since the project has no test
today.

**⚠️ CRITICAL**: No user story is considered verified without extending this smoke test.

- [ ] T002 Create `tests/smoke.test.ts` (depends on T001): a `bun test` file that spawns
  `server.ts` on an ephemeral port via `Bun.spawn`, with the env vars from T001 pointing at a
  directory created with `fs.mkdtempSync(join(tmpdir(), "granada-smoke-"))`, and drives it with
  `fetch`. Covers the current happy path: `GET /api/health`, `GET /api/config`,
  `POST /api/traces` (with a minimal valid JPEG fixture), `GET /api/traces` (not visible until
  approved), `POST /api/admin/login` + `PATCH /api/admin/traces/{id}/status` +
  `GET /api/admin/traces` (visible after approval). Exits with a non-zero code and a clear
  message on failure (`bun test` handles this natively). Document `bun test` in a new section of
  `README.md`.

**Checkpoint**: From here on, the linear US1→US5 chain starts (see dependency summary above); only
T014 can run ahead in parallel.

---

## Phase 3: User Story 1 - Stop spam and abuse of the public form (Priority: P1) 🎯 MVP

**Goal**: `POST /api/traces` is no longer exploitable without limit by bots or repetition.

**Independent Test**: See spec.md US1.

- [ ] T003 [US1] Add a per-IP rate limiter to `POST /api/traces` in `server.ts`: an in-memory
  structure (`Map<ip, timestamp[]>`, configurable sliding window, e.g. 5 submissions/hour per IP
  using the request's remote address with a fallback to the `X-Forwarded-For` header when
  present), and a hidden honeypot field (`website`) in `index.html`/`app.js` that, if filled in,
  is rejected with the same generic error message without creating a record. When the limit is
  exceeded, respond `429` with a `Retry-After` header.
- [ ] T004 [US1] (depends on T003) Extend `tests/smoke.test.ts`: send more contributions than the
  configured limit from the same simulated IP and expect `429` starting from the one that exceeds
  it; submit the form with the honeypot filled in and expect rejection with no record created.

**Checkpoint**: US1 works and is independently verified.

---

## Phase 4: User Story 2 - Validate and sanitize every uploaded image (Priority: P1)

**Goal**: No image is persisted without verifying its actual content, its decoded size, and
having its EXIF metadata stripped.

**Independent Test**: See spec.md US2.

- [ ] T005 [US2] (depends on T004) Add `sniffImageSignature(headerBytes: Uint8Array): string |
  null` in `server.ts`: compares the first bytes of the uploaded file against the binary
  signatures for JPEG (`FF D8`), PNG (`89 50 4E 47`), and WEBP (`RIFF....WEBP`), independently of
  the `Content-Type`/extension declared in `handleCreateTrace`; rejects if it matches none of the
  supported signatures.
- [X] T006 [US2] (depends on T005) Add `readImageDimensions(data: Uint8Array, kind: string):
  [number, number]` in `server.ts`: parses width/height from the JPEG SOF header, PNG `IHDR`
  chunk, and WEBP `VP8`/`VP8L`/`VP8X` chunk without decoding the full image; reject in
  `handleCreateTrace` if it exceeds a configured maximum (e.g. 6000x6000 px).
- [X] T007 [US2] (depends on T006) Add `stripExif(data: Uint8Array, kind: string): Uint8Array` in
  `server.ts`: removes the JPEG `APP1`/EXIF segment, the PNG `eXIf` chunk, and the WEBP `EXIF`
  chunk before writing the file to `uploads/`; safe no-op if the format carries no EXIF.
- [ ] T008 [US2] (depends on T007) Extend `tests/smoke.test.ts` with binary fixtures: a
  non-image file with an image extension/`Content-Type` → rejected; an image with dimensions
  above the maximum → rejected; a fixture JPEG with known GPS EXIF → accepted, but the final file
  in `uploads/` no longer contains that EXIF.

**Checkpoint**: US1 and US2 work independently of each other.

---

## Phase 5: User Story 3 - Real consent and right to erasure (GDPR) (Priority: P2)

**Goal**: Submitted consent is actually honored, self-service deletion exists, and the legal pages
referenced by `config.json` respond with real content.

**Independent Test**: See spec.md US3.

- [ ] T009 [US3] (depends on T008) In `handleCreateTrace` (`server.ts`), replace the hardcoded
  `consent: 1` with the actual `consent` field from the form (accept `"true"/"on"/"1"` as truthy);
  reject creation with a clear message if it isn't truthy.
- [ ] T010 [US3] (depends on T009) Add self-service deletion: generate a random token per
  contribution in `handleCreateTrace`, return it once in the `POST /api/traces` response, store
  only its hash (`deletion_token_hash`, a new column on `traces` via an idempotent migration in
  `initDb()`); add a public `DELETE /api/traces/{id}` (no `requireAdmin`) that deletes the record
  + photo only if the `X-Deletion-Token` header matches (compared with `timingSafeEqual`),
  returning `403` if it doesn't match.
- [ ] T011 [US3] (depends on T010) Create `politica-de-privacidad.html` and `aviso-legal.html`
  with real content (GDPR: what data is collected, legal basis, retention period, how to exercise
  the right to erasure with the T010 token, contact details), served by `server.ts` at
  `/politica-de-privacidad` and `/aviso-legal` (routes already linked from `config.json` via
  `privacy_url`/`legal_url`, but currently 404); add default legal-text keys to
  `DEFAULT_PUBLIC_CONFIG` in `server.ts` and show the deletion token to the user after a
  successful submission in `index.html`/`app.js` ("save this code to delete your data").
- [ ] T012 [US3] (depends on T011) Extend `tests/smoke.test.ts`: submission with false or absent
  `consent` → rejected; full deletion cycle (create → delete with wrong token → `403` → delete
  with correct token → `200` → no longer appears in `GET /api/traces` after approval);
  `GET /politica-de-privacidad` and `GET /aviso-legal` → `200` with a non-empty body.

**Checkpoint**: US1, US2, and US3 work independently of each other.

---

## Phase 6: User Story 4 - Security headers on every response (Priority: P2)

**Goal**: Every server response carries the baseline security headers.

**Independent Test**: See spec.md US4.

- [ ] T013 [US4] (depends on T012) Add `withSecurityHeaders(response: Response): Response` in
  `server.ts` and wrap every response returned from `handleRequest` with it (this single
  fetch-handler entry point covers JSON responses, static files, and `/uploads/<file>` alike, so
  there's no need for a Python-style `end_headers` override): `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Content-Security-Policy: default-src 'self'` (adjusted if `index.html`/`admin.html` load
  anything from another origin).
- [ ] T014 [US4] [P] Update the recommended Nginx block in `README.md` to add
  `Strict-Transport-Security` and the same headers at the proxy level as defense in depth
  (complements T013, doesn't replace it).
- [ ] T015 [US4] (depends on T013) Extend `tests/smoke.test.ts`: check that `GET /`,
  `GET /api/health`, and `GET /api/traces` include the four headers from T013.

**Checkpoint**: US1-US4 work independently of each other.

---

## Phase 7: User Story 5 - Audit trail and brute-force throttling on the admin panel (Priority: P3)

**Goal**: Every admin action is logged, and login accepts only a limited number of failed
attempts per IP.

**Independent Test**: See spec.md US5.

- [ ] T016 [US5] (depends on T015) Add an `audit_log` table (id, action, trace_id, source_ip,
  created_at) via an idempotent migration in `initDb()`; insert a row from `handleUpdateStatus`,
  `handleUpdateTrace`, and `handleDeleteTrace`, and from `handleAdminLogin` (both success and
  failure); add `GET /api/admin/audit-log` (protected with `requireAdmin`), paginated by
  `created_at` descending.
- [ ] T017 [US5] (depends on T016) Apply per-IP lockout to `POST /api/admin/login`, reusing the
  rate-limiter structure from T003 (failure counter per IP, e.g. max 5 failed attempts in 15
  minutes → `429` until it expires, even with the correct password).
- [ ] T018 [US5] (depends on T017) Extend `tests/smoke.test.ts`: an admin action (e.g. approving
  a contribution) appears in `GET /api/admin/audit-log`; exceeding the max failed login attempts
  blocks further attempts with `429`.

**Checkpoint**: All five user stories work independently and together.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies, already done by the runtime rewrite.
- **Foundational (Phase 2)**: depends on Setup — blocks every user story from starting.
- **User Stories (Phase 3-7)**: form a single linear chain starting at T002 (see dependency
  summary); they don't run in parallel with each other because they share
  `server.ts`/`smoke.test.ts`.

### Execution

Linear chain T002→T018 over `server.ts`/`tests/smoke.test.ts` (see dependency summary); the only
real parallelism is T014 (`README.md`), independent of everything else.

## Notes

- There's no separate "Polish" phase: each story already includes its own smoke-test extension as
  its final step, instead of one global test phase at the end.
- One commit per task, as with the rest of the project — each task is independently verifiable by
  running `bun test` after T002.
