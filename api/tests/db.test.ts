import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initDatabase,
  isMongoMode,
  createTrace,
  getTraceById,
  getTraces,
  addTracePhoto,
  getTracePhotos,
  updateTraceStatus,
  updateTrace,
  deleteTrace,
  addAuditLog,
  getAuditLogs,
  addNotifySignup,
  closeDatabase,
  TraceRecord,
} from "../db";

// Test SQLite backend
describe("Database Layer - SQLite", () => {
  const dbPath = join(tmpdir(), `granada-test-${Date.now()}.sqlite3`);

  beforeAll(async () => {
    await initDatabase(dbPath);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("should initialize in SQLite mode when no MONGO_URI", async () => {
    expect(isMongoMode()).toBe(false);
  });

  it("should seed the database with SEED_TRACES", async () => {
    const traces = await getTraces(true);
    const berlin = traces.find((t) => t.id === "seed-berlin");
    expect(berlin).toBeTruthy();
    expect(berlin?.name).toBe("Clara Munoz");
    expect(berlin?.status).toBe("approved");
    expect(berlin?.deletion_token_hash).toBeNull();
  });

  it("should create and retrieve a trace", async () => {
    const trace: TraceRecord = {
      id: "trace-1",
      name: "Test User",
      email: "test@example.com",
      city: "Granada",
      country: "Spain",
      lat: 37.1882,
      lng: -3.6385,
      relation: "visited",
      emotion: "nostalgia",
      feeling: "Beautiful place",
      photo: "/uploads/test-1.jpg",
      status: "pending",
      consent: 1,
      created_at: new Date().toISOString(),
      deletion_token_hash: null,
    };

    await createTrace(trace);
    const retrieved = await getTraceById("trace-1");

    expect(retrieved).toBeTruthy();
    expect(retrieved?.id).toBe("trace-1");
    expect(retrieved?.name).toBe("Test User");
    expect(retrieved?.status).toBe("pending");
  });

  it("should add and retrieve trace photos", async () => {
    const traceId = "trace-photos-test";
    const trace: TraceRecord = {
      id: traceId,
      name: "Photo Test",
      email: "photo@example.com",
      city: "Granada",
      country: "Spain",
      lat: 37.1882,
      lng: -3.6385,
      relation: "lived",
      emotion: "asombro",
      feeling: "Amazing",
      photo: "/uploads/main.jpg",
      status: "pending",
      consent: 1,
      created_at: new Date().toISOString(),
      deletion_token_hash: null,
    };

    await createTrace(trace);
    await addTracePhoto(traceId, "photo-1", "/uploads/extra-1.jpg", 1, new Date().toISOString());
    await addTracePhoto(traceId, "photo-2", "/uploads/extra-2.jpg", 2, new Date().toISOString());

    const photos = await getTracePhotos(traceId);
    expect(photos.length).toBe(2);
    expect(photos[0].position).toBe(1);
    expect(photos[1].position).toBe(2);
  });

  it("should update trace status", async () => {
    const traceId = "trace-status-test";
    const trace: TraceRecord = {
      id: traceId,
      name: "Status Test",
      email: "status@example.com",
      city: "Granada",
      country: "Spain",
      lat: 37.1882,
      lng: -3.6385,
      relation: "visited",
      emotion: "nostalgia",
      feeling: "Good memories",
      photo: "/uploads/status.jpg",
      status: "pending",
      consent: 1,
      created_at: new Date().toISOString(),
      deletion_token_hash: null,
    };

    await createTrace(trace);
    const updated = await updateTraceStatus(traceId, "approved");

    expect(updated).toBe(true);
    const retrieved = await getTraceById(traceId);
    expect(retrieved?.status).toBe("approved");
  });

  it("should update trace (feeling only)", async () => {
    const traceId = "trace-update-test";
    const trace: TraceRecord = {
      id: traceId,
      name: "Update Test",
      email: "update@example.com",
      city: "Granada",
      country: "Spain",
      lat: 37.1882,
      lng: -3.6385,
      relation: "visited",
      emotion: "nostalgia",
      feeling: "Original feeling",
      photo: "/uploads/update.jpg",
      status: "pending",
      consent: 1,
      created_at: new Date().toISOString(),
      deletion_token_hash: null,
    };

    await createTrace(trace);
    const updated = await updateTrace(traceId, { feeling: "Updated feeling" });

    expect(updated).toBe(true);
    const retrieved = await getTraceById(traceId);
    expect(retrieved?.feeling).toBe("Updated feeling");
  });

  it("should delete a trace and its photos", async () => {
    const traceId = "trace-delete-test";
    const trace: TraceRecord = {
      id: traceId,
      name: "Delete Test",
      email: "delete@example.com",
      city: "Granada",
      country: "Spain",
      lat: 37.1882,
      lng: -3.6385,
      relation: "visited",
      emotion: "nostalgia",
      feeling: "To be deleted",
      photo: "/uploads/delete.jpg",
      status: "pending",
      consent: 1,
      created_at: new Date().toISOString(),
      deletion_token_hash: null,
    };

    await createTrace(trace);
    await addTracePhoto(traceId, "photo-del", "/uploads/extra-del.jpg", 1, new Date().toISOString());

    const deleted = await deleteTrace(traceId);
    expect(deleted?.id).toBe(traceId);

    const retrieved = await getTraceById(traceId);
    expect(retrieved).toBeNull();

    const photos = await getTracePhotos(traceId);
    expect(photos.length).toBe(0);
  });

  it("should record and retrieve audit logs", async () => {
    const logId = `audit-${Date.now()}`;
    await addAuditLog(logId, "test_action", "trace-123", "127.0.0.1", new Date().toISOString());

    const logs = await getAuditLogs(10);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.id === logId)).toBe(true);
  });
});

// Test MongoDB backend (only if GRANADA_TEST_MONGO_URI is set)
describe.skipIf(!process.env.GRANADA_TEST_MONGO_URI)("Database Layer - MongoDB", () => {
  beforeAll(async () => {
    const mongoUri = process.env.GRANADA_TEST_MONGO_URI!;
    await initDatabase("unused-path.db", mongoUri);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("should initialize in MongoDB mode when MONGO_URI is set", async () => {
    expect(isMongoMode()).toBe(true);
  });

  it("should create and retrieve a trace from MongoDB", async () => {
    const trace: TraceRecord = {
      id: `mongo-trace-${Date.now()}`,
      name: "Mongo User",
      email: "mongo@example.com",
      city: "Granada",
      country: "Spain",
      lat: 37.1882,
      lng: -3.6385,
      relation: "visited",
      emotion: "nostalgia",
      feeling: "Beautiful",
      photo: "/uploads/mongo-1.jpg",
      status: "pending",
      consent: 1,
      created_at: new Date().toISOString(),
      deletion_token_hash: null,
    };

    await createTrace(trace);
    const retrieved = await getTraceById(trace.id);

    expect(retrieved).toBeTruthy();
    expect(retrieved?.id).toBe(trace.id);
    expect(retrieved?.name).toBe("Mongo User");
    expect(retrieved?.lat).toBe(37.1882);
    expect(retrieved?.lng).toBe(-3.6385);
  });

  it("should add and retrieve trace photos in MongoDB", async () => {
    const traceId = `mongo-photos-${Date.now()}`;
    const trace: TraceRecord = {
      id: traceId,
      name: "Mongo Photos",
      email: "mongophoto@example.com",
      city: "Granada",
      country: "Spain",
      lat: 37.1882,
      lng: -3.6385,
      relation: "lived",
      emotion: "asombro",
      feeling: "Amazing",
      photo: "/uploads/mongo-main.jpg",
      status: "pending",
      consent: 1,
      created_at: new Date().toISOString(),
      deletion_token_hash: null,
    };

    await createTrace(trace);
    await addTracePhoto(traceId, "mongophoto-1", "/uploads/mongo-extra-1.jpg", 1, new Date().toISOString());
    await addTracePhoto(traceId, "mongophoto-2", "/uploads/mongo-extra-2.jpg", 2, new Date().toISOString());

    const photos = await getTracePhotos(traceId);
    expect(photos.length).toBe(2);
    expect(photos[0].position).toBe(1);
    expect(photos[1].position).toBe(2);
  });

  it("should update trace status in MongoDB", async () => {
    const traceId = `mongo-status-${Date.now()}`;
    const trace: TraceRecord = {
      id: traceId,
      name: "Mongo Status",
      email: "mongostatus@example.com",
      city: "Granada",
      country: "Spain",
      lat: 37.1882,
      lng: -3.6385,
      relation: "visited",
      emotion: "nostalgia",
      feeling: "Memories",
      photo: "/uploads/mongo-status.jpg",
      status: "pending",
      consent: 1,
      created_at: new Date().toISOString(),
      deletion_token_hash: null,
    };

    await createTrace(trace);
    const updated = await updateTraceStatus(traceId, "approved");

    expect(updated).toBe(true);
    const retrieved = await getTraceById(traceId);
    expect(retrieved?.status).toBe("approved");
  });

  it("should delete a trace in MongoDB", async () => {
    const traceId = `mongo-delete-${Date.now()}`;
    const trace: TraceRecord = {
      id: traceId,
      name: "Mongo Delete",
      email: "mongodelete@example.com",
      city: "Granada",
      country: "Spain",
      lat: 37.1882,
      lng: -3.6385,
      relation: "visited",
      emotion: "nostalgia",
      feeling: "Bye",
      photo: "/uploads/mongo-delete.jpg",
      status: "pending",
      consent: 1,
      created_at: new Date().toISOString(),
      deletion_token_hash: null,
    };

    await createTrace(trace);
    const deleted = await deleteTrace(traceId);

    expect(deleted?.id).toBe(traceId);
    const retrieved = await getTraceById(traceId);
    expect(retrieved).toBeNull();
  });

  it("should record audit logs in MongoDB", async () => {
    const logId = `mongo-audit-${Date.now()}`;
    await addAuditLog(logId, "mongo_test", "mongo-trace-123", "127.0.0.1", new Date().toISOString());

    const logs = await getAuditLogs(10);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.id === logId)).toBe(true);
  });
});
