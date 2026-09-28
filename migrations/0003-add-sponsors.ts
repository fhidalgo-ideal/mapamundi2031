/**
 * Adds the sponsors collection behind the public "Patrocinadores" section and
 * its admin panel. Purely additive: the previous app version never reads it,
 * so a rollback needs no restore.
 */
import type { Db } from "mongodb";

export const description = "Add sponsors collection and its indexes";

export async function up(db: Db): Promise<void> {
  await db.collection("sponsors").createIndex({ id: 1 }, { unique: true });
  // Serves the public listing (active only, grouped by tier, in position order).
  await db.collection("sponsors").createIndex({ active: 1, tier: 1, position: 1 });
}
