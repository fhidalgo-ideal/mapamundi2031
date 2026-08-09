// MongoDB-backed smoke test: mirrors smoke.test.ts scenarios but against real MongoDB.
// Skipped entirely when GRANADA_TEST_MONGO_URI is unset (machines without Docker/Mongo).
// This ensures bun test stays green on all machines, with Mongo tests reported as skipped.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";

// A real, decoder-valid baseline JPEG (2x2 px, generated with Pillow and
// verified to decode). Exercises the full upload path — signature sniffing
// (T005) and the SOF dimension guard (T006) — with a genuine image payload
// instead of a hand-assembled blob that real decoders reject.
const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4p" +
  "LSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09P" +
  "T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAACAAIDASIA" +
  "AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA" +
  "AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3" +
  "ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm" +
  "p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA" +
  "AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx" +
  "BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK" +
  "U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3" +
  "uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCaiiiv" +
  "GPaP/9k=";

const NON_IMAGE_DECOY_BASE64 =
  "VGhpcyBpcyBub3QgYW4gaW1hZ2UuIFBsYWluIHRleHQgZGVjb3kgcGF5bG9hZCBmb3Igc2lnbmF0dX" +
  "JlLXNuaWZmaW5nIHNtb2tlIHRlc3Qu";

const OVERSIZED_PNG_HEADER_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAH0AAAB9A";

const GPS_EXIF_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/4QCsRXhpZgAATU0AKgAAAAgAAYglAAQAAAABAAAAGgAAAAAABQ" +
  "ABAAIAAAACTgAAAAACAAUAAAADAAAAXAADAAIAAAACVwAAAAAEAAUAAAADAAAAdAAcAAcAAAAXAAAA" +
  "jAAAAAAAAAAlAAAAAQAAAAoAAAABAAACaQAAADIAAAADAAAAAQAAACQAAAABAAAA5AAAAAVHUkFOQU" +
  "RBLUdQUy1DQU5BUlktOUYzRAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsN" +
  "DhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFB" +
  "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAEAAQDASIAAhEBAxEB" +
  "/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAA" +
  "QRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdI" +
  "SUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7" +
  "i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAA" +
  "AAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFE" +
  "KRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hp" +
  "anN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1d" +
  "bX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDyeiiivzw/sg//2Q==";

const STARTUP_TIMEOUT_MS = 10_000;

let dataDir: string;
let proc: Subprocess<"ignore", "pipe", "pipe">;
let baseUrl: string;

async function waitForListeningUrl(child: Subprocess<"ignore", "pipe", "pipe">): Promise<string> {
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const outcome = await Promise.race([
        reader.read(),
        child.exited.then(() => "exited" as const),
      ]);
      if (outcome === "exited") break;
      const { value, done } = outcome as ReadableStreamReadResult<Uint8Array>;
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const match = buffered.match(/escuchando en (http:\/\/\S+)/);
      if (match) return match[1];
    }
  } finally {
    reader.releaseLock();
  }
  const stderrText = await new Response(child.stderr).text().catch(() => "");
  throw new Error(
    `server.ts exited (code ${child.exitCode}) before it reported a listening URL.\n` +
      `stdout:\n${buffered || "(empty)"}\nstderr:\n${stderrText || "(empty)"}`,
  );
}

describe.skipIf(!process.env.GRANADA_TEST_MONGO_URI)("smoke-mongo", () => {
  let createdTraceId: string;
  let adminToken: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "granada-smoke-mongo-"));
    const mongoUri = process.env.GRANADA_TEST_MONGO_URI;

    proc = Bun.spawn({
      cmd: [process.execPath, join(import.meta.dir, "..", "server.ts"), "--host", "127.0.0.1", "--port", "0"],
      env: {
        ...process.env,
        MONGO_URI: mongoUri,
        GRANADA_DATA_DIR: dataDir,
        GRANADA_UPLOAD_DIR: join(dataDir, "uploads"),
        GRANADA_DB_PATH: join(dataDir, "granada2031.sqlite3"),
        GRANADA_CONFIG_PATH: join(dataDir, "config.json"),
        GRANADA_SECRETS_PATH: join(dataDir, ".dev"),
        // Point geocoding at an unreachable host so the suite never depends on
        // live Nominatim: known cities take the CITY_COORDINATES fast-path (no
        // network at all), and unlisted cities deterministically exercise the
        // COUNTRY_FALLBACK/hash fallback chain when the request fails fast.
        GRANADA_NOMINATIM_ENDPOINT: "http://127.0.0.1:1/search",
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Integration exception (see ts-no-test-timers): this bounds a genuine
    // child-process spawn, not a guessed sleep — waitForListeningUrl() awaits
    // the real readiness signal (server.ts's stdout line); the timer only
    // caps how long we wait for that signal so a stuck child fails fast.
    baseUrl = await Promise.race([
      waitForListeningUrl(proc),
      new Promise<string>((_, reject) =>
        setTimeout(
          () => reject(new Error(`server.ts did not start within ${STARTUP_TIMEOUT_MS}ms`)),
          STARTUP_TIMEOUT_MS,
        ),
      ),
    ]);
  });

  afterAll(async () => {
    proc.kill();
    await proc.exited;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("GET /api/health reports the running service with MongoDB backend", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("mapamundi");
    expect(body.storage).toBe("mongodb");
  });

  test("GET /api/config exposes the public config block", async () => {
    const response = await fetch(`${baseUrl}/api/config`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.config.brand_name).toBe("Granada 2031");
  });

  test("POST /api/traces creates a pending contribution", async () => {
    const photoBytes = Uint8Array.from(atob(TINY_JPEG_BASE64), (char) => char.charCodeAt(0));
    const form = new FormData();
    form.set("name", "Smoke Test");
    form.set("email", "smoke@example.com");
    form.set("city", "Granada");
    form.set("country", "Espana");
    form.set("relation", "Visitante");
    form.set("emotion", "asombro");
    form.set("feeling", "Prueba automatizada de humo.");
    form.set("consent", "true");
    form.set("photo", new File([photoBytes], "tiny.jpg", { type: "image/jpeg" }));

    const response = await fetch(`${baseUrl}/api/traces`, { method: "POST", body: form });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.trace.status).toBe("pending");
    // "Granada"/"Espana" is a curated CITY_COORDINATES entry, so it resolves
    // via the fast-path without ever hitting Nominatim (GEO01).
    expect(body.trace.lat).toBeCloseTo(37.1773, 4);
    expect(body.trace.lng).toBeCloseTo(-3.5986, 4);
    createdTraceId = body.trace.id;
    expect(createdTraceId).toBeTruthy();
  });

  test("GET /api/traces hides the contribution until it's approved", async () => {
    const response = await fetch(`${baseUrl}/api/traces`);
    expect(response.status).toBe(200);
    const body = await response.json();
    const ids = body.traces.map((trace: { id: string }) => trace.id);
    expect(ids).not.toContain(createdTraceId);
  });

  test("POST /api/admin/login returns a bearer token for the default password", async () => {
    const response = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "cambia-esta-password" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(typeof body.token).toBe("string");
    adminToken = body.token;
  });

  test("PATCH /api/admin/traces/{id}/status approves the contribution", async () => {
    const response = await fetch(`${baseUrl}/api/admin/traces/${createdTraceId}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: "approved" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.trace.status).toBe("approved");
  });

  test("GET /api/admin/traces lists the approved contribution", async () => {
    const response = await fetch(`${baseUrl}/api/admin/traces`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    const approved = body.traces.find((trace: { id: string }) => trace.id === createdTraceId);
    expect(approved?.status).toBe("approved");
  });

  test("GET /api/traces now shows the approved contribution publicly", async () => {
    const response = await fetch(`${baseUrl}/api/traces`);
    expect(response.status).toBe(200);
    const body = await response.json();
    const ids = body.traces.map((trace: { id: string }) => trace.id);
    expect(ids).toContain(createdTraceId);
  });

  test("DELETE /api/traces/{id} deletes the record and photo with the correct X-Deletion-Token", async () => {
    // Create a new trace specifically for deletion testing
    const photoBytes = Uint8Array.from(atob(TINY_JPEG_BASE64), (char) => char.charCodeAt(0));
    const form = new FormData();
    form.set("name", "Delete Test");
    form.set("email", "delete@example.com");
    form.set("city", "Granada");
    form.set("country", "Espana");
    form.set("relation", "Visitante");
    form.set("emotion", "asombro");
    form.set("feeling", "Sera eliminada.");
    form.set("consent", "true");
    form.set("photo", new File([photoBytes], "tiny.jpg", { type: "image/jpeg" }));

    const createResponse = await fetch(`${baseUrl}/api/traces`, {
      method: "POST",
      body: form,
    });
    expect(createResponse.status).toBe(201);
    const createBody = await createResponse.json();
    const deleteTraceId = createBody.trace.id;
    const deletionToken = createBody.deletionToken;

    // Delete the trace with the correct token
    const deleteResponse = await fetch(`${baseUrl}/api/traces/${deleteTraceId}`, {
      method: "DELETE",
      headers: { "X-Deletion-Token": deletionToken },
    });
    expect(deleteResponse.status).toBe(200);

    // Verify it's no longer in the admin list
    const adminResponse = await fetch(`${baseUrl}/api/admin/traces`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(adminResponse.status).toBe(200);
    const adminBody = await adminResponse.json();
    const found = adminBody.traces.find((trace: { id: string }) => trace.id === deleteTraceId);
    expect(found).toBeUndefined();
  });

  test("POST /api/notify-signup stores a valid email and returns 201", async () => {
    const response = await fetch(`${baseUrl}/api/notify-signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "notify@example.com" }),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });
});
