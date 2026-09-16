/**
 * Adds photo voting: one vote per IP per photo, enforced by a unique index on
 * (photo_id, ip_hash) rather than in application code, plus the denormalized
 * counters the API reads on every listing.
 */
import type { Db } from "mongodb";

export const description = "Add photo_votes collection and vote_count counters";

export async function up(db: Db): Promise<void> {
  await db
    .collection("photo_votes")
    .createIndex({ photo_id: 1, ip_hash: 1 }, { unique: true });

  await db
    .collection("traces")
    .updateMany({ photo_vote_count: { $exists: false } }, { $set: { photo_vote_count: 0 } });
  await db
    .collection("trace_photos")
    .updateMany({ vote_count: { $exists: false } }, { $set: { vote_count: 0 } });
}
