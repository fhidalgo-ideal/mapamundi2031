// Single smoke test for the whole project: spawns `server.ts` as a real child
// process on an OS-assigned ephemeral port, backed by a throwaway data
// directory, and drives it over HTTP with `fetch`. Covers the current happy
// path end to end. Extend this file (don't add new test files) as new
// endpoints/behaviors land — see specs/001-plataforma-mapa-participativo/.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";

// Smallest well-formed baseline JPEG (SOI/APP0/DQT/SOF2/DHT/SOS markers for a
// 1x1 image), so the upload exercises a real image/jpeg payload rather than
// an arbitrary byte blob.
const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////" +
  "////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAA" +
  "AP/aAAgBAQABPxA=";

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
});
