#!/usr/bin/env bun
/**
 * SQLite to MongoDB migration script.
 *
 * Reads an existing SQLite database and upserts all documents into MongoDB.
 * Safe to re-run — uses upsert (updateOne with {upsert: true}) to avoid duplicates.
 *
 * Usage:
 *   MONGO_URI=mongodb://localhost:27017/granada2031 bun run scripts/migrate-sqlite-to-mongo.ts
 *
 * Or with custom SQLite path:
 *   GRANADA_DB_PATH=/path/to/db.sqlite3 MONGO_URI=... bun run scripts/migrate-sqlite-to-mongo.ts
 */

import { Database } from "bun:sqlite";
import { join } from "node:path";
import type { MongoClient as MC, Db, Collection } from "mongodb";
import { MongoClient } from "mongodb";
import { traceToMongoDoc } from "../api/db";

const ROOT_DIR = import.meta.dir + "/..";
const DATA_DIR = process.env.GRANADA_DATA_DIR ?? join(ROOT_DIR, "data");
const DB_PATH = process.env.GRANADA_DB_PATH ?? join(DATA_DIR, "granada2031.sqlite3");
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME ?? "granada2031";

if (!MONGO_URI) {
  console.error("Error: MONGO_URI environment variable is required");
  process.exit(1);
}

interface TraceRow {
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
}

interface TracePhotoRow {
  id: string;
  trace_id: string;
  path: string;
  position: number;
  created_at: string;
}

interface AuditLogRow {
  id: string;
  action: string;
  trace_id: string | null;
  source_ip: string;
  created_at: string;
}

interface NotifySignupRow {
  id: string;
  email: string;
  source_ip?: string;
  created_at: string;
}

async function migrate(): Promise<void> {
  console.log(`[migrate] Using SQLite: ${DB_PATH}`);
  const redactedUri = MONGO_URI.replace(/:[^:]+@/, ":***@");
  console.log(`[migrate] Using MongoDB: ${redactedUri}`);

  // Open SQLite
  let sqliteDb: Database;
  try {
    sqliteDb = new Database(DB_PATH);
    console.log("[migrate] SQLite database opened");
  } catch (err) {
    console.error(`[migrate] Failed to open SQLite at ${DB_PATH}:`, err);
    process.exit(1);
  }

  // Connect to MongoDB
  let mongoClient: MC;
  let mongoDb: Db;
  try {
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    mongoDb = mongoClient.db(MONGO_DB_NAME);
    console.log(`[migrate] MongoDB connected to ${MONGO_DB_NAME}`);
  } catch (err) {
    console.error("[migrate] Failed to connect to MongoDB:", err);
    process.exit(1);
  }

  const counts = {
    traces: 0,
    tracePhotos: 0,
    auditLogs: 0,
    notifySignups: 0,
  };

  try {
    // Migrate traces
    console.log("\n[migrate] Starting traces migration...");
    const tracesQuery = sqliteDb.query("SELECT * FROM traces");
    const tracesCollection: Collection = mongoDb.collection("traces");

    for (const traceRow of tracesQuery.all() as unknown as TraceRow[]) {
      const traceDoc = traceToMongoDoc({
        id: traceRow.id,
        name: traceRow.name,
        email: traceRow.email,
        city: traceRow.city,
        country: traceRow.country,
        lat: traceRow.lat,
        lng: traceRow.lng,
        relation: traceRow.relation,
        emotion: traceRow.emotion,
        feeling: traceRow.feeling,
        photo: traceRow.photo,
        status: traceRow.status,
        consent: traceRow.consent,
        created_at: traceRow.created_at,
        deletion_token_hash: traceRow.deletion_token_hash,
      });

      await tracesCollection.updateOne(
        { id: traceRow.id },
        { $set: traceDoc },
        { upsert: true }
      );
      counts.traces++;
    }
    console.log(`[migrate] Migrated ${counts.traces} traces`);

    // Migrate trace photos
    console.log("[migrate] Starting trace_photos migration...");
    const photosQuery = sqliteDb.query("SELECT * FROM trace_photos");
    const photosCollection: Collection = mongoDb.collection("trace_photos");

    for (const photoRow of photosQuery.all() as unknown as TracePhotoRow[]) {
      await photosCollection.updateOne(
        { id: photoRow.id },
        {
          $set: {
            id: photoRow.id,
            trace_id: photoRow.trace_id,
            path: photoRow.path,
            position: photoRow.position,
            created_at: photoRow.created_at,
          },
        },
        { upsert: true }
      );
      counts.tracePhotos++;
    }
    console.log(`[migrate] Migrated ${counts.tracePhotos} trace photos`);

    // Migrate audit logs
    console.log("[migrate] Starting audit_log migration...");
    const auditQuery = sqliteDb.query("SELECT * FROM audit_log");
    const auditCollection: Collection = mongoDb.collection("audit_log");

    for (const auditRow of auditQuery.all() as unknown as AuditLogRow[]) {
      await auditCollection.updateOne(
        { id: auditRow.id },
        {
          $set: {
            id: auditRow.id,
            action: auditRow.action,
            trace_id: auditRow.trace_id,
            source_ip: auditRow.source_ip,
            created_at: auditRow.created_at,
          },
        },
        { upsert: true }
      );
      counts.auditLogs++;
    }
    console.log(`[migrate] Migrated ${counts.auditLogs} audit log entries`);

    // Migrate notify_signups
    console.log("[migrate] Starting notify_signups migration...");
    const signupsQuery = sqliteDb.query("SELECT * FROM notify_signups");
    const signupsCollection: Collection = mongoDb.collection("notify_signups");

    for (const signupRow of signupsQuery.all() as unknown as NotifySignupRow[]) {
      await signupsCollection.updateOne(
        { id: signupRow.id },
        {
          $set: {
            id: signupRow.id,
            email: signupRow.email,
            source_ip: signupRow.source_ip,
            created_at: signupRow.created_at,
          },
        },
        { upsert: true }
      );
      counts.notifySignups++;
    }
    console.log(`[migrate] Migrated ${counts.notifySignups} signups`);

    // Print summary
    console.log("\n[migrate] ✓ Migration complete!");
    console.log("[migrate] Summary:");
    console.log(`  - traces: ${counts.traces}`);
    console.log(`  - trace_photos: ${counts.tracePhotos}`);
    console.log(`  - audit_log: ${counts.auditLogs}`);
    console.log(`  - notify_signups: ${counts.notifySignups}`);
  } catch (err) {
    console.error("[migrate] Migration failed:", err);
    process.exit(1);
  } finally {
    // Cleanup
    sqliteDb.close();
    await mongoClient.close();
  }
}

migrate().catch((err) => {
  console.error("[migrate] Fatal error:", err);
  process.exit(1);
});
