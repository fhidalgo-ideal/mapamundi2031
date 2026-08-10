/**
 * Baseline. Creates the indexes the application relies on.
 *
 * initDatabase() in api/db.ts already creates these on boot, and createIndex
 * is idempotent, so on an existing deployment this migration is a no-op that
 * exists to record a known starting version. From here on, schema changes
 * belong in numbered migrations rather than in the boot path, so that they run
 * once, in order, and leave a record of when they were applied.
 */
import type { Db } from "mongodb";

export const description = "Baseline indexes for traces, photos, audit log and signups";

export async function up(db: Db): Promise<void> {
  await db.collection("traces").createIndex({ status: 1, created_at: 1 });
  await db.collection("traces").createIndex({ location: "2dsphere" });
  await db.collection("traces").createIndex({ id: 1 }, { unique: true });
  await db.collection("trace_photos").createIndex({ trace_id: 1 });
  await db.collection("audit_log").createIndex({ created_at: 1 });
  await db.collection("notify_signups").createIndex({ email: 1 }, { unique: true });
}
