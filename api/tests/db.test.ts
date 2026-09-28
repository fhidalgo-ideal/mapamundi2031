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
  getTracePhotosForTraces,
  getPhotoById,
  setPhotoPath,
  updateTraceStatus,
  updateTrace,
  deleteTrace,
  addAuditLog,
  getAuditLogs,
  addNotifySignup,
  closeDatabase,
  listSponsors,
  getSponsorById,
  countActivePrincipalSponsors,
  createSponsor,
  updateSponsor,
  deleteSponsor,
  TraceRecord,
  SponsorRecord,
} from "../db";

// Same sponsor assertions against both backends. Ids are unique per run so a
// reused Mongo test database never collides with an earlier run's rows.
function sponsorTests() {
  const run = Date.now().toString(36);
  const make = (suffix: string, overrides: Partial<SponsorRecord> = {}): SponsorRecord => ({
    id: `sponsor-${run}-${suffix}`,
    name: `Sponsor ${suffix}`,
    url: "https://example.com/",
    tier: "colaborador",
    position: 0,
    active: true,
    logo: `/uploads/sponsors/${suffix}.png`,
    logo_width: 300,
    logo_height: 100,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  });
  const mine = (sponsors: SponsorRecord[]) => sponsors.filter((s) => s.id.startsWith(`sponsor-${run}-`));

  it("should create sponsors and list them by tier, position and name", async () => {
    await createSponsor(make("c2", { position: 2 }));
    await createSponsor(make("c1", { position: 1, name: "Beta" }));
    await createSponsor(make("c1b", { position: 1, name: "Alfa" }));
    await createSponsor(make("p1", { tier: "principal", position: 5 }));
    await createSponsor(make("hidden", { active: false }));

    const all = mine(await listSponsors());
    expect(all.map((s) => s.id.split("-").pop())).toEqual(["p1", "hidden", "c1b", "c1", "c2"]);
    expect(all.find((s) => s.id.endsWith("hidden"))?.active).toBe(false);

    const visible = mine(await listSponsors(true));
    expect(visible.some((s) => s.id.endsWith("hidden"))).toBe(false);
    expect(typeof visible[0].active).toBe("boolean");
    expect(visible[0].logo_width).toBe(300);
  });

  it("should count active principal sponsors, optionally excluding one", async () => {
    const before = await countActivePrincipalSponsors();
    await createSponsor(make("p2", { tier: "principal" }));
    await createSponsor(make("p3", { tier: "principal", active: false }));
    expect(await countActivePrincipalSponsors()).toBe(before + 1);
    expect(await countActivePrincipalSponsors(`sponsor-${run}-p2`)).toBe(before);
  });

  it("should update and delete a sponsor", async () => {
    const id = `sponsor-${run}-c2`;
    expect(await updateSponsor(id, { name: "Renamed", active: false, position: 9 })).toBe(true);
    const updated = await getSponsorById(id);
    expect(updated?.name).toBe("Renamed");
    expect(updated?.active).toBe(false);
    expect(updated?.position).toBe(9);
    expect(await updateSponsor("sponsor-missing", { name: "x" })).toBe(false);

    const deleted = await deleteSponsor(id);
    expect(deleted?.logo).toBe("/uploads/sponsors/c2.png");
    expect(await getSponsorById(id)).toBeNull();
    expect(await deleteSponsor(id)).toBeNull();
  });
}

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

  it("should resolve a photo id to the cover or an extra and repoint its file", async () => {
    // Reuses the trace + extras created by the previous test.
    expect(await getPhotoById("trace-photos-test")).toEqual({
      traceId: "trace-photos-test",
      path: "/uploads/main.jpg",
      isCover: true,
    });
    expect(await getPhotoById("photo-2")).toEqual({
      traceId: "trace-photos-test",
      path: "/uploads/extra-2.jpg",
      isCover: false,
    });
    expect(await getPhotoById("no-such-photo")).toBeNull();

    expect(await setPhotoPath("trace-photos-test", true, "/uploads/main-r1.jpg")).toBe(true);
    expect(await setPhotoPath("photo-2", false, "/uploads/extra-2-r1.jpg")).toBe(true);
    expect((await getTraceById("trace-photos-test"))?.photo).toBe("/uploads/main-r1.jpg");
    const photos = await getTracePhotos("trace-photos-test");
    expect(photos.map((photo) => photo.path)).toEqual(["/uploads/extra-1.jpg", "/uploads/extra-2-r1.jpg"]);
  });

  it("should load the extra photos of many traces in one call, grouped and ordered", async () => {
    const base = {
      email: "batch@example.com", city: "Granada", country: "Spain", lat: 37.1882, lng: -3.6385,
      relation: "lived", emotion: "asombro", feeling: "Batch", status: "pending", consent: 1,
      created_at: new Date().toISOString(), deletion_token_hash: null,
    };
    await createTrace({ ...base, id: "batch-a", name: "Batch A", photo: "/uploads/batch-a.jpg" } as TraceRecord);
    await createTrace({ ...base, id: "batch-b", name: "Batch B", photo: "/uploads/batch-b.jpg" } as TraceRecord);
    // Inserted out of order on purpose: the result must follow position.
    await addTracePhoto("batch-a", "batch-a-3", "/uploads/batch-a-3.jpg", 3, new Date().toISOString());
    await addTracePhoto("batch-a", "batch-a-1", "/uploads/batch-a-1.jpg", 1, new Date().toISOString());
    await addTracePhoto("batch-a", "batch-a-2", "/uploads/batch-a-2.jpg", 2, new Date().toISOString());

    const byTrace = await getTracePhotosForTraces(["batch-a", "batch-b", "trace-photos-test", "no-such-trace"]);
    expect(byTrace.get("batch-a")?.map((photo) => photo.id)).toEqual(["batch-a-1", "batch-a-2", "batch-a-3"]);
    expect(byTrace.has("batch-b")).toBe(false); // no extras
    expect(byTrace.get("trace-photos-test")?.length).toBe(2);
    expect(byTrace.has("no-such-trace")).toBe(false);
    // Same content as the one-trace-at-a-time lookup it replaces in lists.
    expect(byTrace.get("batch-a")).toEqual(await getTracePhotos("batch-a"));
    expect((await getTracePhotosForTraces([])).size).toBe(0);
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

  sponsorTests();
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

  it("should load the extra photos of many traces in one call in MongoDB", async () => {
    const stamp = Date.now();
    const base = {
      email: "mongobatch@example.com", city: "Granada", country: "Spain", lat: 37.1882, lng: -3.6385,
      relation: "lived", emotion: "asombro", feeling: "Batch", status: "pending", consent: 1,
      created_at: new Date().toISOString(), deletion_token_hash: null,
    };
    const a = `mongo-batch-a-${stamp}`;
    const b = `mongo-batch-b-${stamp}`;
    await createTrace({ ...base, id: a, name: "Batch A", photo: "/uploads/mb-a.jpg" } as TraceRecord);
    await createTrace({ ...base, id: b, name: "Batch B", photo: "/uploads/mb-b.jpg" } as TraceRecord);
    await addTracePhoto(a, `${a}-2`, "/uploads/mb-a-2.jpg", 2, new Date().toISOString());
    await addTracePhoto(a, `${a}-1`, "/uploads/mb-a-1.jpg", 1, new Date().toISOString());
    await addTracePhoto(b, `${b}-1`, "/uploads/mb-b-1.jpg", 1, new Date().toISOString());

    const byTrace = await getTracePhotosForTraces([a, b, "no-such-trace"]);
    expect(byTrace.get(a)?.map((photo) => photo.id)).toEqual([`${a}-1`, `${a}-2`]);
    expect(byTrace.get(b)?.map((photo) => photo.id)).toEqual([`${b}-1`]);
    expect(byTrace.has("no-such-trace")).toBe(false);
    expect(byTrace.get(a)).toEqual(await getTracePhotos(a));
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

  sponsorTests();
});
