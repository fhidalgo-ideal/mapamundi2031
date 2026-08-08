// Single smoke test for the whole project: spawns `server.ts` as a real child
// process on an OS-assigned ephemeral port, backed by a throwaway data
// directory, and drives it over HTTP with `fetch`. Covers the current happy
// path end to end. Extend this file (don't add new test files) as new
// endpoints/behaviors land — see specs/001-plataforma-mapa-participativo/.
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
  "T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAACAAIDASIA" +
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
  "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAEAAQDASIAAhEBAxEB" +
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

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "granada-smoke-"));
  proc = Bun.spawn({
    cmd: [process.execPath, join(import.meta.dir, "..", "server.ts"), "--host", "127.0.0.1", "--port", "0"],
    env: {
      ...process.env,
      GRANADA_DATA_DIR: dataDir,
      GRANADA_UPLOAD_DIR: join(dataDir, "uploads"),
      GRANADA_DB_PATH: join(dataDir, "granada2031.sqlite3"),
      GRANADA_CONFIG_PATH: join(dataDir, "config.json"),
      GRANADA_SECRETS_PATH: join(dataDir, ".dev"),
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

describe("smoke", () => {
  let createdTraceId: string;
  let adminToken: string;

  test("GET /api/health reports the running service", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("mapamundi");
    expect(body.storage).toBe("sqlite");
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

  test("POST /api/traces exceeds rate limit and returns 429 after max hits", async () => {
    // Use a distinct X-Forwarded-For IP to isolate the rate-limit bucket
    // (the previous test already consumed 1 slot on 127.0.0.1)
    const clientIp = "203.0.113.10";
    const photoBytes = Uint8Array.from(atob(TINY_JPEG_BASE64), (char) => char.charCodeAt(0));
    const baseHeaders = {
      "X-Forwarded-For": clientIp,
    };

    // Send 5 submissions (at limit) — should all succeed with 201
    for (let i = 1; i <= 5; i++) {
      const form = new FormData();
      form.set("name", `Rate Limit Test #${i}`);
      form.set("email", `ratelimit${i}@example.com`);
      form.set("city", "Granada");
      form.set("country", "Espana");
      form.set("relation", "Visitante");
      form.set("emotion", "asombro");
      form.set("feeling", "Testing rate limit enforcement.");
      form.set("consent", "true");
      form.set("photo", new File([photoBytes], "tiny.jpg", { type: "image/jpeg" }));

      const response = await fetch(`${baseUrl}/api/traces`, {
        method: "POST",
        headers: baseHeaders,
        body: form,
      });
      expect(response.status).toBe(201);
    }

    // 6th submission from same IP should be rejected with 429
    const finalForm = new FormData();
    finalForm.set("name", "Rate Limit Test #6");
    finalForm.set("email", "ratelimit6@example.com");
    finalForm.set("city", "Granada");
    finalForm.set("country", "Espana");
    finalForm.set("relation", "Visitante");
    finalForm.set("emotion", "asombro");
    finalForm.set("feeling", "Testing rate limit enforcement.");
    finalForm.set("consent", "true");
    finalForm.set("photo", new File([photoBytes], "tiny.jpg", { type: "image/jpeg" }));

    const response = await fetch(`${baseUrl}/api/traces`, {
      method: "POST",
      headers: baseHeaders,
      body: finalForm,
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
  });

  test("POST /api/traces with honeypot field filled is rejected without creating a record", async () => {
    const photoBytes = Uint8Array.from(atob(TINY_JPEG_BASE64), (char) => char.charCodeAt(0));
    const clientIp = "203.0.113.20"; // Distinct IP to avoid rate-limit collision
    const honeypotEmail = "honeypot@example.com";

    // Count existing traces before the honeypot submission
    const beforeResponse = await fetch(`${baseUrl}/api/admin/traces`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(beforeResponse.status).toBe(200);
    const beforeBody = await beforeResponse.json();
    const beforeCount = beforeBody.traces.length;

    // Submit form with honeypot field filled
    const form = new FormData();
    form.set("name", "Honeypot Test");
    form.set("email", honeypotEmail);
    form.set("city", "Granada");
    form.set("country", "Espana");
    form.set("relation", "Visitante");
    form.set("emotion", "asombro");
    form.set("feeling", "Testing honeypot field.");
    form.set("consent", "true");
    form.set("website", "http://spam-bot.example.com"); // Honeypot field
    form.set("photo", new File([photoBytes], "tiny.jpg", { type: "image/jpeg" }));

    const response = await fetch(`${baseUrl}/api/traces`, {
      method: "POST",
      headers: { "X-Forwarded-For": clientIp },
      body: form,
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeTruthy();

    // Verify the record was NOT created by checking admin trace list
    const afterResponse = await fetch(`${baseUrl}/api/admin/traces`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(afterResponse.status).toBe(200);
    const afterBody = await afterResponse.json();
    const afterCount = afterBody.traces.length;
    expect(afterCount).toBe(beforeCount); // Count should not increase

    // Also verify the honeypot email doesn't appear in admin list
    const honeypotRecords = afterBody.traces.filter(
      (trace: { email: string }) => trace.email === honeypotEmail,
    );
    expect(honeypotRecords.length).toBe(0);
  });

  test("POST /api/traces rejects a non-image file disguised with an image extension/Content-Type", async () => {
    // T008: T005's signature sniffing must reject payloads whose actual bytes
    // don't match any supported image signature, regardless of what the
    // client claims via filename/Content-Type.
    const clientIp = "203.0.113.30"; // Distinct IP to avoid rate-limit collision
    const decoyBytes = Uint8Array.from(atob(NON_IMAGE_DECOY_BASE64), (char) => char.charCodeAt(0));

    const form = new FormData();
    form.set("name", "Decoy Upload Test");
    form.set("email", "decoy@example.com");
    form.set("city", "Granada");
    form.set("country", "Espana");
    form.set("relation", "Visitante");
    form.set("emotion", "asombro");
    form.set("feeling", "Testing non-image signature rejection.");
    form.set("consent", "true");
    form.set("photo", new File([decoyBytes], "photo.jpg", { type: "image/jpeg" }));

    const response = await fetch(`${baseUrl}/api/traces`, {
      method: "POST",
      headers: { "X-Forwarded-For": clientIp },
      body: form,
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });

  test("POST /api/traces rejects an image whose declared dimensions exceed the maximum", async () => {
    // T008: T006's dimension guard must reject an oversized canvas using only
    // the container header (IHDR), before any pixel data would be decoded.
    const clientIp = "203.0.113.40"; // Distinct IP to avoid rate-limit collision
    const oversizedBytes = Uint8Array.from(
      atob(OVERSIZED_PNG_HEADER_BASE64),
      (char) => char.charCodeAt(0),
    );

    const form = new FormData();
    form.set("name", "Oversized Image Test");
    form.set("email", "oversized@example.com");
    form.set("city", "Granada");
    form.set("country", "Espana");
    form.set("relation", "Visitante");
    form.set("emotion", "asombro");
    form.set("feeling", "Testing dimension guard rejection.");
    form.set("consent", "true");
    form.set("photo", new File([oversizedBytes], "huge.png", { type: "image/png" }));

    const response = await fetch(`${baseUrl}/api/traces`, {
      method: "POST",
      headers: { "X-Forwarded-For": clientIp },
      body: form,
    });
    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });

  test("POST /api/traces accepts a GPS-tagged JPEG but strips its EXIF before persisting", async () => {
    // T008: T007's stripExif() must remove the whole APP1/Exif segment (which
    // carries the GPS IFD) from the bytes actually written to uploads/, even
    // though the upload itself is accepted.
    const clientIp = "203.0.113.50"; // Distinct IP to avoid rate-limit collision
    const gpsPhotoBytes = Uint8Array.from(atob(GPS_EXIF_JPEG_BASE64), (char) => char.charCodeAt(0));

    // Sanity-check the fixture itself: it must actually carry the EXIF/GPS
    // canary before upload, otherwise the assertion below would be vacuous.
    const originalAscii = Buffer.from(gpsPhotoBytes).toString("latin1");
    expect(originalAscii).toContain("Exif");
    expect(originalAscii).toContain("GRANADA-GPS-CANARY-9F3D");

    const form = new FormData();
    form.set("name", "GPS EXIF Test");
    form.set("email", "gps-exif@example.com");
    form.set("city", "Granada");
    form.set("country", "Espana");
    form.set("relation", "Visitante");
    form.set("emotion", "asombro");
    form.set("feeling", "Testing EXIF stripping.");
    form.set("consent", "true");
    form.set("photo", new File([gpsPhotoBytes], "gps.jpg", { type: "image/jpeg" }));

    const response = await fetch(`${baseUrl}/api/traces`, {
      method: "POST",
      headers: { "X-Forwarded-For": clientIp },
      body: form,
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.trace.status).toBe("pending");
    expect(typeof body.trace.photo).toBe("string");

    const persistedBytes = readFileSync(join(dataDir, body.trace.photo));
    // Still a valid JPEG (SOI marker) — the sanitizer works on the container
    // bytes without re-encoding pixels.
    expect(persistedBytes[0]).toBe(0xff);
    expect(persistedBytes[1]).toBe(0xd8);

    const persistedAscii = Buffer.from(persistedBytes).toString("latin1");
    expect(persistedAscii).not.toContain("Exif");
    expect(persistedAscii).not.toContain("GRANADA-GPS-CANARY-9F3D");
  });

  test("DELETE /api/traces/{id} deletes the record and photo with the correct X-Deletion-Token", async () => {
    // T010: the token is minted per-contribution in handleCreateTrace and
    // returned once in the POST response; only its hash is persisted.
    const clientIp = "203.0.113.60"; // Distinct IP to avoid rate-limit collision
    const photoBytes = Uint8Array.from(atob(TINY_JPEG_BASE64), (char) => char.charCodeAt(0));
    const form = new FormData();
    form.set("name", "Deletion Token Test");
    form.set("email", "deletion-token@example.com");
    form.set("city", "Granada");
    form.set("country", "Espana");
    form.set("relation", "Visitante");
    form.set("emotion", "asombro");
    form.set("feeling", "Prueba de borrado con token.");
    form.set("consent", "true");
    form.set("photo", new File([photoBytes], "tiny.jpg", { type: "image/jpeg" }));

    const createResponse = await fetch(`${baseUrl}/api/traces`, {
      method: "POST",
      headers: { "X-Forwarded-For": clientIp },
      body: form,
    });
    expect(createResponse.status).toBe(201);
    const createBody = await createResponse.json();
    expect(typeof createBody.deletionToken).toBe("string");
    expect(createBody.deletionToken.length).toBeGreaterThan(0);
    const traceId = createBody.trace.id as string;
    const deletionToken = createBody.deletionToken as string;
    const photoPath = join(dataDir, createBody.trace.photo);
    expect(existsSync(photoPath)).toBe(true);

    const wrongTokenResponse = await fetch(`${baseUrl}/api/traces/${traceId}`, {
      method: "DELETE",
      headers: { "X-Deletion-Token": "not-the-real-token" },
    });
    expect(wrongTokenResponse.status).toBe(403);

    const noTokenResponse = await fetch(`${baseUrl}/api/traces/${traceId}`, { method: "DELETE" });
    expect(noTokenResponse.status).toBe(403);

    // Still present after both failed attempts — visible to admin regardless
    // of public approval status.
    const stillThereResponse = await fetch(`${baseUrl}/api/admin/traces`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const stillThereBody = await stillThereResponse.json();
    expect(stillThereBody.traces.some((trace: { id: string }) => trace.id === traceId)).toBe(true);

    const deleteResponse = await fetch(`${baseUrl}/api/traces/${traceId}`, {
      method: "DELETE",
      headers: { "X-Deletion-Token": deletionToken },
    });
    expect(deleteResponse.status).toBe(200);
    const deleteBody = await deleteResponse.json();
    expect(deleteBody.deleted).toBe(true);
    expect(deleteBody.id).toBe(traceId);
    expect(existsSync(photoPath)).toBe(false);

    const goneResponse = await fetch(`${baseUrl}/api/admin/traces`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const goneBody = await goneResponse.json();
    expect(goneBody.traces.some((trace: { id: string }) => trace.id === traceId)).toBe(false);

    // Already deleted: a second attempt with the same valid token now 404s.
    const repeatResponse = await fetch(`${baseUrl}/api/traces/${traceId}`, {
      method: "DELETE",
      headers: { "X-Deletion-Token": deletionToken },
    });
    expect(repeatResponse.status).toBe(404);
  });

  test("DELETE /api/traces/{id} rejects seed data that has no deletion token hash", async () => {
    // Seed rows are inserted without a deletion_token_hash (pre-dating T010),
    // so self-service deletion must never succeed for them regardless of
    // what header is sent.
    const response = await fetch(`${baseUrl}/api/traces/seed-berlin`, {
      method: "DELETE",
      headers: { "X-Deletion-Token": "anything" },
    });
    expect(response.status).toBe(403);

    const stillThereResponse = await fetch(`${baseUrl}/api/traces`);
    const stillThereBody = await stillThereResponse.json();
    expect(stillThereBody.traces.some((trace: { id: string }) => trace.id === "seed-berlin")).toBe(true);
  });
});
