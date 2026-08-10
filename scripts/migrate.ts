#!/usr/bin/env bun
/**
 * MongoDB migration runner.
 *
 * Applies every file in migrations/ that has not been applied yet, in
 * filename order, and records each one in the schema_migrations collection so
 * it never runs twice. Designed to be safe to run on every deploy: with no
 * pending migrations it connects, finds nothing to do and exits 0.
 *
 * Migration files are named NNNN-description.ts and export:
 *
 *   export const description = "what this changes"
 *   export async function up(db) { ... }
 *
 * Writing them additively (create a field, backfill it, and only drop the old
 * one in a later migration once nothing reads it) is what keeps a deploy
 * reversible: the previous version of the app keeps working against the new
 * schema, so a rollback does not need a restore.
 *
 * Usage:
 *   bun run scripts/migrate.ts            # apply pending migrations
 *   bun run scripts/migrate.ts --status   # list applied/pending, change nothing
 *   bun run scripts/migrate.ts --dry-run  # show what would run, change nothing
 */

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MongoClient } from "mongodb";
import type { Db } from "mongodb";

const ROOT_DIR = join(import.meta.dir, "..");
const MIGRATIONS_DIR = join(ROOT_DIR, "migrations");
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME ?? "granada2031";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const STATUS_ONLY = args.has("--status");

if (!MONGO_URI) {
  console.error("Error: MONGO_URI is required");
  process.exit(1);
}

interface Migration {
  version: string;
  name: string;
  file: string;
  description?: string;
  up: (db: Db) => Promise<void>;
}

interface MigrationModule {
  description?: string;
  up?: (db: Db) => Promise<void>;
}

function loadMigrations(): Promise<Migration[]> {
  if (!existsSync(MIGRATIONS_DIR)) return Promise.resolve([]);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}-.+\.ts$/.test(f))
    .sort();

  return Promise.all(
    files.map(async (file) => {
      const module = (await import(join(MIGRATIONS_DIR, file))) as MigrationModule;
      if (typeof module.up !== "function") {
        throw new Error(`Migration ${file} does not export an up() function`);
      }
      const version = file.slice(0, 4);
      return {
        version,
        name: file.replace(/\.ts$/, ""),
        file,
        description: module.description,
        up: module.up,
      };
    }),
  );
}

const client = new MongoClient(MONGO_URI);

try {
  await client.connect();
  const db = client.db(MONGO_DB_NAME);
  const applied = db.collection("schema_migrations");
  await applied.createIndex({ version: 1 }, { unique: true });

  const migrations = await loadMigrations();
  const appliedVersions = new Set(
    (await applied.find({}, { projection: { version: 1 } }).toArray()).map(
      (doc) => doc.version as string,
    ),
  );

  const pending = migrations.filter((m) => !appliedVersions.has(m.version));

  if (STATUS_ONLY) {
    console.log(`Database: ${MONGO_DB_NAME}`);
    for (const m of migrations) {
      const mark = appliedVersions.has(m.version) ? "applied" : "PENDING";
      console.log(`  [${mark}] ${m.name}${m.description ? ` — ${m.description}` : ""}`);
    }
    if (migrations.length === 0) console.log("  (no migration files)");
    process.exit(0);
  }

  if (pending.length === 0) {
    console.log("No pending migrations.");
    process.exit(0);
  }

  console.log(`${pending.length} pending migration(s):`);
  for (const m of pending) console.log(`  - ${m.name}`);

  if (DRY_RUN) {
    console.log("Dry run: nothing applied.");
    process.exit(0);
  }

  for (const migration of pending) {
    const startedAt = new Date();
    console.log(`Applying ${migration.name}...`);
    try {
      await migration.up(db);
    } catch (error) {
      // Stop at the first failure rather than pressing on: a later migration
      // almost certainly assumes this one succeeded, and a half-applied chain
      // is far harder to reason about than a clean stop at a known version.
      console.error(`Migration ${migration.name} failed:`, error);
      console.error("Stopping. No further migrations were applied.");
      process.exit(1);
    }
    await applied.insertOne({
      version: migration.version,
      name: migration.name,
      description: migration.description ?? null,
      applied_at: startedAt.toISOString(),
      duration_ms: Date.now() - startedAt.getTime(),
    });
    console.log(`  done (${Date.now() - startedAt.getTime()}ms)`);
  }

  console.log("All migrations applied.");
} finally {
  await client.close();
}
