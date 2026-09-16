import { Database } from "bun:sqlite";
import { existsSync, copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const BASE_DIR = dirname(import.meta.path);
const ROOT_DIR = join(BASE_DIR, "..");
const UPLOAD_DIR = process.env.GRANADA_UPLOAD_DIR ?? join(ROOT_DIR, "uploads");
const SEED_PHOTOS_DIR = join(BASE_DIR, "seed-photos");

// Demo traces are inserted whenever the database comes up empty, which is what
// you want in dev and in the tests but not in production — there a fresh
// deployment should start with nothing at all. Set GRANADA_SEED=false to skip
// both the demo rows and their photos.
const SEED_ENABLED = process.env.GRANADA_SEED !== "false";

// Seed photos ship as fixtures under api/seed-photos/<uuid>.jpg (tracked in git,
// since uploads/ itself is runtime-only and gitignored) and get copied into the
// real uploads folder on first seed, so they're served through the exact same
// /uploads/<uuid>.jpg path as a real user-submitted photo — no special-cased route.
function seedUploadPhotos(): void {
  if (!existsSync(SEED_PHOTOS_DIR)) return;
  mkdirSync(UPLOAD_DIR, { recursive: true });
  for (const file of readdirSync(SEED_PHOTOS_DIR)) {
    const dest = join(UPLOAD_DIR, file);
    if (!existsSync(dest)) copyFileSync(join(SEED_PHOTOS_DIR, file), dest);
  }
}

// MongoDB types for TypeScript - imported dynamically at runtime to avoid Bun load failure.
// In SQLite mode, mongodb is never loaded, allowing bun run to work without the package.
type MongoClient = any; // Dynamically imported in initDatabase Mongo branch
type Db = any;
type Collection = any;

export interface TraceRecord {
  id: string;
  name: string;
  email: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  relation: string;
  emotion: string;
  feeling: string;
  photo: string;
  status: string;
  consent?: number;
  created_at: string;
  deletion_token_hash: string | null;
  // Votes on the cover photo. The cover has no row of its own in trace_photos
  // (see TracePhotoRecord), so its vote count lives directly on the trace.
  photo_vote_count?: number;
}

export interface TracePhotoRecord {
  id: string;
  trace_id: string;
  path: string;
  position: number;
  created_at: string;
  vote_count?: number;
}

export interface PhotoVoteRecord {
  photo_id: string;
  ip_hash: string;
  created_at: string;
}

export interface AuditLogRecord {
  id: string;
  action: string;
  trace_id: string | null;
  source_ip: string;
  created_at: string;
}

export interface NotifySignupRecord {
  id: string;
  email: string;
  source_ip?: string;
  created_at: string;
}

// Seed traces: inserted when database is empty (same behavior as initDb() in server.ts).
// deletion_token_hash is NULL for all seed rows (as required by smoke tests).
interface SeedTrace {
  id: string;
  name: string;
  email: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  relation: string;
  emotion: string;
  feeling: string;
  photo: string;
  status: string;
  createdAt: string;
}

const SEED_TRACES: SeedTrace[] = [
  {
    id: "seed-berlin",
    name: "Clara Munoz",
    email: "clara@example.com",
    city: "Berlin",
    country: "Alemania",
    lat: 52.52,
    lng: 13.405,
    relation: "Erasmus en Granada",
    emotion: "nostalgia",
    feeling: "Encontre una baldosa azul en Kreuzberg que me llevo de golpe a las tardes del Albaicin.",
    photo: "/uploads/824f6704-0caa-4882-9786-6b79f5e9b6f6.jpg",
    status: "approved",
    createdAt: "2026-04-12T10:30:00+00:00",
  },
  {
    id: "seed-buenos-aires",
    name: "Mateo Rivas",
    email: "mateo@example.com",
    city: "Buenos Aires",
    country: "Argentina",
    lat: -34.6037,
    lng: -58.3816,
    relation: "Familia o comunidad granadina",
    emotion: "pertenencia",
    feeling: "Mi abuela aun cocina con palabras de Granada. La ciudad vive en nuestra mesa los domingos.",
    photo: "/uploads/4bbd2721-5fd7-4132-8faa-158c564ee03f.jpg",
    status: "approved",
    createdAt: "2026-03-02T16:20:00+00:00",
  },
  {
    id: "seed-tokyo",
    name: "Aiko Tanaka",
    email: "aiko@example.com",
    city: "Tokio",
    country: "Japon",
    lat: 35.6762,
    lng: 139.6503,
    relation: "Visitante",
    emotion: "asombro",
    feeling: "Una guitarra en una estacion de Tokio me devolvio el eco de una noche de flamenco en Sacromonte.",
    photo: "/uploads/b930a5a2-5c60-416b-aade-1e48a13532cf.jpg",
    status: "approved",
    createdAt: "2026-02-18T08:12:00+00:00",
  },
  {
    id: "seed-rabat",
    name: "Nadia El Amrani",
    email: "nadia@example.com",
    city: "Rabat",
    country: "Marruecos",
    lat: 34.0209,
    lng: -6.8416,
    relation: "Artista o investigador/a",
    emotion: "futuro",
    feeling:
      "Investigar Al-Andalus desde Rabat hace que Granada parezca una conversacion abierta, no un archivo cerrado.",
    photo: "/uploads/ebf895ab-a319-4777-9d93-da15a2127b93.jpg",
    status: "pending",
    createdAt: "2026-05-01T12:00:00+00:00",
  },
  {
    id: "seed-estambul",
    name: "Yusuf Aydin",
    email: "yusuf@example.com",
    city: "Estambul",
    country: "Turquia",
    lat: 41.0082,
    lng: 28.9784,
    relation: "Artista o investigador/a",
    emotion: "asombro",
    feeling:
      "Al atardecer, la silueta de las cupulas sobre el Bosforo me recuerda el perfil de la Alhambra recortado sobre Sierra Nevada.",
    photo: "/uploads/d4ab0d26-2df6-4c90-adad-dd3fe135f423.jpg",
    status: "approved",
    createdAt: "2026-06-20T18:45:00+00:00",
  },
];

let backend: "sqlite" | "mongodb" = "sqlite";
let sqliteDb: Database | null = null;
let mongoClient: MongoClient | null = null;
let mongoDb: Db | null = null;

// Collections
let tracesCollection: Collection | null = null;
let tracePhotosCollection: Collection | null = null;
let auditLogCollection: Collection | null = null;
let notifySignupsCollection: Collection | null = null;
let photoVotesCollection: Collection | null = null;

/**
 * Initialize the database with either SQLite (when mongoUri is unset) or MongoDB.
 * Signature per plan.md: initDatabase(sqlitePath, mongoUri?): Promise<void>
 * Internally seeds with SEED_TRACES if the database is empty.
 * MongoDB is imported dynamically only when mongoUri is set, avoiding the Bun load failure in SQLite mode.
 */
export async function initDatabase(sqlitePath: string, mongoUri?: string): Promise<void> {
  if (mongoUri || process.env.MONGO_URI) {
    // MongoDB mode: import dynamically to avoid loading mongodb in SQLite mode
    const { MongoClient: MC } = await import("mongodb");
    const uri = mongoUri || process.env.MONGO_URI!;
    const dbName = process.env.MONGO_DB_NAME || "granada2031";

    mongoClient = new MC(uri);
    await mongoClient.connect();
    mongoDb = mongoClient.db(dbName);

    // Create collections and indexes
    await mongoDb.collection("traces").createIndex({ status: 1, created_at: 1 });
    await mongoDb.collection("traces").createIndex({ location: "2dsphere" });
    await mongoDb.collection("traces").createIndex({ id: 1 }, { unique: true });

    await mongoDb.collection("trace_photos").createIndex({ trace_id: 1 });
    await mongoDb.collection("audit_log").createIndex({ created_at: 1 });
    await mongoDb.collection("notify_signups").createIndex({ email: 1 }, { unique: true });
    // One vote per IP per photo, enforced by the database rather than
    // application code — see migrations/0002-add-photo-votes.ts.
    await mongoDb
      .collection("photo_votes")
      .createIndex({ photo_id: 1, ip_hash: 1 }, { unique: true });

    tracesCollection = mongoDb.collection("traces");
    tracePhotosCollection = mongoDb.collection("trace_photos");
    auditLogCollection = mongoDb.collection("audit_log");
    notifySignupsCollection = mongoDb.collection("notify_signups");
    photoVotesCollection = mongoDb.collection("photo_votes");

    backend = "mongodb";

    // Redact credentials from both mongodb:// and mongodb+srv:// URIs
    const redactedUri = uri
      .replace(/mongodb\+srv:\/\/([^:]+):([^@]+)@/, "mongodb+srv://***:***@")
      .replace(/mongodb:\/\/([^:]+):([^@]+)@/, "mongodb://***:***@");
    console.log(`[db.ts] MongoDB connected to ${dbName} (${redactedUri})`);

    // Seed traces if collection is empty
    const count = await tracesCollection.countDocuments();
    if (count === 0 && SEED_ENABLED) {
      seedUploadPhotos();
      for (const trace of SEED_TRACES) {
        const [lng, lat] = [trace.lng, trace.lat];
        await tracesCollection.insertOne({
          id: trace.id,
          name: trace.name,
          email: trace.email,
          city: trace.city,
          country: trace.country,
          relation: trace.relation,
          emotion: trace.emotion,
          feeling: trace.feeling,
          consent: 1,
          photo: trace.photo,
          photos: [trace.photo],
          photo_vote_count: 0,
          status: trace.status,
          location: {
            type: "Point",
            coordinates: [lng, lat],
          },
          lat,
          lng,
          created_at: trace.createdAt,
          deletion_token_hash: null,
        });
      }
    }
  } else {
    // SQLite mode - mongodb is never imported, avoiding Bun's node:v8 load failure
    mkdirSync(sqlitePath.substring(0, sqlitePath.lastIndexOf("/")), { recursive: true });
    sqliteDb = new Database(sqlitePath);

    // Create tables (exact same schema as initDb() in server.ts)
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS traces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        city TEXT NOT NULL,
        country TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        relation TEXT NOT NULL,
        emotion TEXT NOT NULL,
        feeling TEXT NOT NULL,
        photo TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
        consent INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `);

    // Add deletion_token_hash column if it doesn't exist
    const traceColumns = sqliteDb
      .query("PRAGMA table_info(traces)")
      .all() as { name: string }[];
    if (!traceColumns.some((col) => col.name === "deletion_token_hash")) {
      sqliteDb.exec("ALTER TABLE traces ADD COLUMN deletion_token_hash TEXT");
    }
    // Add photo_vote_count column if it doesn't exist (votes on the cover photo).
    if (!traceColumns.some((col) => col.name === "photo_vote_count")) {
      sqliteDb.exec("ALTER TABLE traces ADD COLUMN photo_vote_count INTEGER NOT NULL DEFAULT 0");
    }

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        trace_id TEXT,
        source_ip TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS notify_signups (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      )
    `);

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS trace_photos (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        path TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    // Add vote_count column if it doesn't exist (votes on extra/non-cover photos).
    const tracePhotoColumns = sqliteDb
      .query("PRAGMA table_info(trace_photos)")
      .all() as { name: string }[];
    if (!tracePhotoColumns.some((col) => col.name === "vote_count")) {
      sqliteDb.exec("ALTER TABLE trace_photos ADD COLUMN vote_count INTEGER NOT NULL DEFAULT 0");
    }

    // One vote per IP per photo: the primary key IS the uniqueness constraint,
    // same role as the Mongo unique index on (photo_id, ip_hash).
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS photo_votes (
        photo_id TEXT NOT NULL,
        ip_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (photo_id, ip_hash)
      )
    `);

    backend = "sqlite";
    console.log(`[db.ts] SQLite initialized at ${sqlitePath}`);

    // Seed traces if table is empty (exact same behavior as initDb() in server.ts)
    const { count } = sqliteDb.query("SELECT COUNT(*) as count FROM traces").get() as {
      count: number;
    };

    if (count === 0 && SEED_ENABLED) {
      seedUploadPhotos();
      const insert = sqliteDb.prepare(`
        INSERT INTO traces (
          id, name, email, city, country, lat, lng, relation, emotion,
          feeling, photo, status, consent, created_at, deletion_token_hash
        )
        VALUES ($id, $name, $email, $city, $country, $lat, $lng, $relation,
          $emotion, $feeling, $photo, $status, 1, $createdAt, NULL)
      `);

      const insertMany = sqliteDb.transaction((traces: SeedTrace[]) => {
        for (const trace of traces) {
          insert.run({
            $id: trace.id,
            $name: trace.name,
            $email: trace.email,
            $city: trace.city,
            $country: trace.country,
            $lat: trace.lat,
            $lng: trace.lng,
            $relation: trace.relation,
            $emotion: trace.emotion,
            $feeling: trace.feeling,
            $photo: trace.photo,
            $status: trace.status,
            $createdAt: trace.createdAt,
          });
        }
      });

      insertMany(SEED_TRACES);
    }
  }
}

/**
 * Check if MongoDB mode is active.
 */
export function isMongoMode(): boolean {
  return backend === "mongodb";
}

/**
 * Get traces (approved only if approvedOnly is true, otherwise all for admin).
 * Both backends return identical shape and ordering for parity.
 * Note: `photos` field is NOT returned (caller fetches separately via getTracePhotos).
 */
export async function getTraces(approvedOnly: boolean = false): Promise<TraceRecord[]> {
  if (backend === "mongodb") {
    const filter = approvedOnly ? { status: "approved" } : {};
    let docs = await tracesCollection!.find(filter).toArray();

    // Match SQLite's CASE ordering: admin sorts pending→approved→rejected, then by created_at DESC.
    if (!approvedOnly) {
      const statusOrder: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };
      docs.sort((a: any, b: any) => {
        const aStatus = (a.status as string) ?? "";
        const bStatus = (b.status as string) ?? "";
        const statusDiff = (statusOrder[aStatus] ?? 3) - (statusOrder[bStatus] ?? 3);
        if (statusDiff !== 0) return statusDiff;
        return (
          new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime()
        );
      });
    } else {
      // Approved only: sort by created_at DESC
      docs.sort((a: any, b: any) =>
        new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime(),
      );

    }

    return docs.map(mongoDocToTrace);
  } else {
    let query: string;
    if (approvedOnly) {
      query = "SELECT * FROM traces WHERE status = 'approved' ORDER BY datetime(created_at) DESC";
    } else {
      query = `SELECT * FROM traces
       ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, datetime(created_at) DESC`;
    }
    const rows = sqliteDb!.query(query).all() as TraceRecord[];
    return rows;
  }
}

/**
 * Get a single trace by ID.
 */
export async function getTraceById(id: string): Promise<TraceRecord | null> {
  if (backend === "mongodb") {
    const doc = await tracesCollection!.findOne({ id });
    return doc ? mongoDocToTrace(doc) : null;
  } else {
    const row = sqliteDb!.query("SELECT * FROM traces WHERE id = ?").get(id) as
      | TraceRecord
      | undefined;
    return row || null;
  }
}

/**
 * Create a new trace.
 */
export async function createTrace(trace: TraceRecord): Promise<void> {
  if (backend === "mongodb") {
    const doc = traceToMongoDoc(trace);
    await tracesCollection!.insertOne(doc);
  } else {
    sqliteDb!
      .prepare(
        `INSERT INTO traces (
          id, name, email, city, country, lat, lng, relation, emotion,
          feeling, photo, status, consent, created_at, deletion_token_hash
        ) VALUES ($id, $name, $email, $city, $country, $lat, $lng, $relation,
          $emotion, $feeling, $photo, $status, $consent, $created_at, $deletion_token_hash)`,
      )
      .run({
        $id: trace.id,
        $name: trace.name,
        $email: trace.email,
        $city: trace.city,
        $country: trace.country,
        $lat: trace.lat,
        $lng: trace.lng,
        $relation: trace.relation,
        $emotion: trace.emotion,
        $feeling: trace.feeling,
        $photo: trace.photo,
        $status: trace.status,
        $consent: trace.consent ?? 0,
        $created_at: trace.created_at,
        $deletion_token_hash: trace.deletion_token_hash,
      });
  }
}

/**
 * Add a trace photo.
 */
export async function addTracePhoto(
  traceId: string,
  photoId: string,
  photoPath: string,
  position: number,
  createdAt: string,
): Promise<void> {
  if (backend === "mongodb") {
    await tracePhotosCollection!.insertOne({
      id: photoId,
      trace_id: traceId,
      path: photoPath,
      position,
      created_at: createdAt,
      vote_count: 0,
    });
  } else {
    sqliteDb!
      .prepare(
        `INSERT INTO trace_photos (id, trace_id, path, position, created_at)
         VALUES ($id, $trace_id, $path, $position, $created_at)`,
      )
      .run({
        $id: photoId,
        $trace_id: traceId,
        $path: photoPath,
        $position: position,
        $created_at: createdAt,
      });
  }
}

/**
 * Get all photos for a trace, ordered by position.
 */
export async function getTracePhotos(traceId: string): Promise<TracePhotoRecord[]> {
  if (backend === "mongodb") {
    const docs = await tracePhotosCollection!.find({ trace_id: traceId })
      .sort({ position: 1 })
      .toArray();
    return docs.map((doc: any) => ({
      id: doc.id as string,
      trace_id: doc.trace_id as string,
      path: doc.path as string,
      position: doc.position as number,
      created_at: doc.created_at as string,
      vote_count: (doc.vote_count as number) ?? 0,
    }));
  } else {
    const rows = sqliteDb!
      .query("SELECT * FROM trace_photos WHERE trace_id = ? ORDER BY position ASC")
      .all(traceId) as TracePhotoRecord[];
    return rows;
  }
}

/**
 * Cast a vote for a photo from a given (already-hashed) IP.
 *
 * photoId is either a trace's id (the cover photo, which has no row of its
 * own in trace_photos) or a trace_photos.id (an extra photo). Returns null
 * if photoId matches neither. A repeat vote from the same ip_hash is
 * idempotent — it does not throw and does not increment the counter again,
 * because there is no real way to distinguish "the same visitor voting
 * twice" from "a different visitor behind the same IP" without login.
 */
export async function voteForPhoto(
  photoId: string,
  ipHash: string,
  createdAt: string,
): Promise<{ alreadyVoted: boolean; count: number } | null> {
  if (backend === "mongodb") {
    const extraPhoto = await tracePhotosCollection!.findOne({ id: photoId });
    const isExtra = extraPhoto !== null;
    if (!isExtra && !(await tracesCollection!.findOne({ id: photoId }))) {
      return null;
    }
    const targetCollection = isExtra ? tracePhotosCollection! : tracesCollection!;
    const countField = isExtra ? "vote_count" : "photo_vote_count";

    let alreadyVoted = false;
    try {
      await photoVotesCollection!.insertOne({ photo_id: photoId, ip_hash: ipHash, created_at: createdAt });
    } catch (error: unknown) {
      if (!isMongoDuplicateKeyError(error)) throw error;
      alreadyVoted = true;
    }

    if (!alreadyVoted) {
      await targetCollection.updateOne({ id: photoId }, { $inc: { [countField]: 1 } });
    }

    const doc = await targetCollection.findOne({ id: photoId });
    return { alreadyVoted, count: (doc?.[countField] as number) ?? 0 };
  } else {
    // bun:sqlite's .get() returns null (not undefined) when no row matches.
    const extraPhoto = sqliteDb!
      .query("SELECT id FROM trace_photos WHERE id = ?")
      .get(photoId) as { id: string } | null;
    const isExtra = extraPhoto !== null;
    if (!isExtra) {
      const trace = sqliteDb!.query("SELECT id FROM traces WHERE id = ?").get(photoId);
      if (!trace) return null;
    }

    let alreadyVoted = false;
    const castVote = sqliteDb!.transaction(() => {
      const result = sqliteDb!
        .prepare(
          "INSERT OR IGNORE INTO photo_votes (photo_id, ip_hash, created_at) VALUES ($photoId, $ipHash, $createdAt)",
        )
        .run({ $photoId: photoId, $ipHash: ipHash, $createdAt: createdAt });
      if (result.changes === 0) {
        alreadyVoted = true;
        return;
      }
      if (isExtra) {
        sqliteDb!.prepare("UPDATE trace_photos SET vote_count = vote_count + 1 WHERE id = ?").run(photoId);
      } else {
        sqliteDb!.prepare("UPDATE traces SET photo_vote_count = photo_vote_count + 1 WHERE id = ?").run(photoId);
      }
    });
    castVote();

    const countRow = isExtra
      ? (sqliteDb!.query("SELECT vote_count FROM trace_photos WHERE id = ?").get(photoId) as
          | { vote_count: number }
          | undefined)
      : (sqliteDb!.query("SELECT photo_vote_count FROM traces WHERE id = ?").get(photoId) as
          | { photo_vote_count: number }
          | undefined);
    const count = isExtra
      ? (countRow as { vote_count: number } | undefined)?.vote_count ?? 0
      : (countRow as { photo_vote_count: number } | undefined)?.photo_vote_count ?? 0;
    return { alreadyVoted, count };
  }
}

/**
 * Update trace status.
 */
export async function updateTraceStatus(id: string, status: string): Promise<boolean> {
  if (backend === "mongodb") {
    const result = await tracesCollection!.updateOne({ id }, { $set: { status } });
    return result.modifiedCount > 0;
  } else {
    const stmt = sqliteDb!.prepare("UPDATE traces SET status = ? WHERE id = ?");
    const result = stmt.run(status, id);
    return result.changes > 0;
  }
}

/**
 * Update trace (feeling-only in practice, caller enforces the restriction).
 */
export async function updateTrace(
  id: string,
  updates: Partial<TraceRecord>,
): Promise<boolean> {
  if (backend === "mongodb") {
    const result = await tracesCollection!.updateOne({ id }, { $set: updates });
    return result.modifiedCount > 0;
  } else {
    // Build the SET clause dynamically based on provided updates
    const keys = Object.keys(updates).filter((k) => k !== "id");
    if (keys.length === 0) return false;

    const setClauses = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map((k) => updates[k as keyof TraceRecord] ?? null);
    const stmt = sqliteDb!.prepare(`UPDATE traces SET ${setClauses} WHERE id = ?`);
    const result = stmt.run(...values, id);
    return result.changes > 0;
  }
}

/**
 * Delete a trace (returns the deleted row for cleanup purposes).
 */
export async function deleteTrace(id: string): Promise<TraceRecord | null> {
  if (backend === "mongodb") {
    // Get the trace first, then delete
    const doc = await tracesCollection!.findOne({ id });
    if (doc) {
      await tracePhotosCollection!.deleteMany({ trace_id: id });
      await tracesCollection!.deleteOne({ id });
      return mongoDocToTrace(doc);
    }
    return null;
  } else {
    // Get the trace and photos
    const row = sqliteDb!.query("SELECT * FROM traces WHERE id = ?").get(id) as
      | TraceRecord
      | undefined;

    if (row) {
      sqliteDb!.prepare("DELETE FROM trace_photos WHERE trace_id = ?").run(id);
      sqliteDb!.prepare("DELETE FROM traces WHERE id = ?").run(id);
      return row;
    }
    return null;
  }
}

/**
 * Add an audit log entry (best-effort).
 */
export async function addAuditLog(
  id: string,
  action: string,
  traceId: string | null,
  sourceIp: string,
  createdAt: string,
): Promise<void> {
  try {
    if (backend === "mongodb") {
      await auditLogCollection!.insertOne({
        id,
        action,
        trace_id: traceId,
        source_ip: sourceIp,
        created_at: createdAt,
      });
    } else {
      sqliteDb!
        .prepare(
          `INSERT INTO audit_log (id, action, trace_id, source_ip, created_at)
           VALUES ($id, $action, $traceId, $sourceIp, $createdAt)`,
        )
        .run({
          $id: id,
          $action: action,
          $traceId: traceId,
          $sourceIp: sourceIp,
          $createdAt: createdAt,
        });
    }
  } catch (error) {
    console.error("[db.ts] No se pudo registrar la entrada de auditoria:", error);
  }
}

/**
 * Get audit log entries (most recent first).
 */
export async function getAuditLogs(limit: number = 50): Promise<AuditLogRecord[]> {
  if (backend === "mongodb") {
    const docs = await auditLogCollection!
      .find({})
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();
    return docs.map((doc: any) => ({
      id: doc.id as string,
      action: doc.action as string,
      trace_id: (doc.trace_id ?? null) as string | null,
      source_ip: doc.source_ip as string,
      created_at: doc.created_at as string,
    }));
  } else {
    const rows = sqliteDb!
      .query("SELECT * FROM audit_log ORDER BY datetime(created_at) DESC LIMIT ?")
      .all(limit) as AuditLogRecord[];
    return rows;
  }
}

/**
 * Add a newsletter signup.
 */
// MongoDB duplicate key error code is 11000 — thrown when an insertOne hits a
// unique index (notify_signups.email, photo_votes' (photo_id, ip_hash) pair).
function isMongoDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "number" &&
    (error as { code: number }).code === 11000
  );
}

export async function addNotifySignup(
  id: string,
  email: string,
  sourceIp: string,
  createdAt: string,
): Promise<void> {
  if (backend === "mongodb") {
    // Idempotent: ignore duplicate email errors from the unique index
    try {
      await notifySignupsCollection!.insertOne({
        id,
        email,
        source_ip: sourceIp,
        created_at: createdAt,
      });
    } catch (error: unknown) {
      if (!isMongoDuplicateKeyError(error)) {
        throw error;
      }
      // Duplicate email — silently ignore to match INSERT OR IGNORE behavior
    }
  } else {
    // SQLite: INSERT OR IGNORE makes repeated emails idempotent
    sqliteDb!
      .prepare(
        `INSERT OR IGNORE INTO notify_signups (id, email, created_at)
         VALUES ($id, $email, $createdAt)`,
      )
      .run({
        $id: id,
        $email: email,
        $createdAt: createdAt,
      });
  }
}

/**
 * Close the database connection.
 */
export async function closeDatabase(): Promise<void> {
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
    mongoDb = null;
    tracesCollection = null;
    tracePhotosCollection = null;
    auditLogCollection = null;
    notifySignupsCollection = null;
    photoVotesCollection = null;
  }

  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
  }

  backend = "sqlite";
}

// Helpers for MongoDB ↔ TraceRecord conversion.
// traceToMongoDoc stores photos array for internal MongoDB use.
// mongoDocToTrace intentionally omits photos (caller fetches separately via getTracePhotos).

export function traceToMongoDoc(trace: TraceRecord): Record<string, unknown> {
  const [lng, lat] = [trace.lng, trace.lat];
  return {
    id: trace.id,
    name: trace.name,
    email: trace.email,
    city: trace.city,
    country: trace.country,
    relation: trace.relation,
    emotion: trace.emotion,
    feeling: trace.feeling,
    consent: trace.consent ?? 0,
    photo: trace.photo,
    photos: [trace.photo],
    photo_vote_count: trace.photo_vote_count ?? 0,
    status: trace.status,
    location: {
      type: "Point",
      coordinates: [lng, lat],
    },
    lat,
    lng,
    created_at: trace.created_at,
    deletion_token_hash: trace.deletion_token_hash,
  };
}

// CRITICAL: mongoDocToTrace does NOT include `photos` field.
// This ensures identical shape between SQLite and MongoDB backends.
// Callers fetch extra photos separately via getTracePhotos().
export function mongoDocToTrace(doc: Record<string, unknown>): TraceRecord {
  return {
    id: doc.id as string,
    name: doc.name as string,
    email: doc.email as string,
    city: doc.city as string,
    country: doc.country as string,
    lat: doc.lat as number,
    lng: doc.lng as number,
    relation: doc.relation as string,
    emotion: doc.emotion as string,
    feeling: doc.feeling as string,
    photo: doc.photo as string,
    status: doc.status as string,
    consent: doc.consent as number | undefined,
    created_at: doc.created_at as string,
    deletion_token_hash: (doc.deletion_token_hash ?? null) as string | null,
    photo_vote_count: (doc.photo_vote_count as number | undefined) ?? 0,
  };
}

