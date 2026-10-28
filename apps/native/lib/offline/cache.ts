import { OUTBOX_MAX_ENTRIES, type OutboxEntry } from "@openvalens/api/presenters/offline";
import * as SQLite from "expo-sqlite";

import { OFFLINE_SCHEMA_SQL } from "./schema";

/**
 * Native offline store (Issue #43). Backed by `expo-sqlite` — the same package
 * the HealthKit source already ships with. Mirrors the web cache/outbox shapes
 * so both platforms share behaviour.
 *
 * Tables:
 *   query_cache (key TEXT PRIMARY KEY, data TEXT, saved_at INTEGER)
 *   outbox      (id INTEGER PRIMARY KEY AUTOINCREMENT, dedupe_hash TEXT UNIQUE,
 *                payload TEXT, last_error TEXT, saved_at INTEGER, scope TEXT)
 *   nutrition_outbox (seq, scope, id, item) — meal-diary changes, see lib/nutrition
 *   plain_water_outbox (seq, scope, id, item) — plain-water changes, see lib/plain-water
 *
 * Meal and water operations never share a table, so one lane cannot list,
 * drain or clear the other's pending writes.
 *
 * Every cache key and outbox row carries the account scope from
 * `offlineScope`, so one account never reads or sends another's health data.
 * `dedupe_hash` stores `scope|hash` to keep dedupe per account. Rows written
 * before scoping existed have a NULL scope and are never sent.
 */

const DB_NAME = "openvalens-offline.db";

let database: SQLite.SQLiteDatabase | null = null;
let offlineCleanupGeneration = 0;

/** Generation used to fence asynchronous writes across offline-data cleanup. */
export function getOfflineCleanupGeneration(): number {
  return offlineCleanupGeneration;
}

/** Advance write authority before synchronously purging offline data. */
export function invalidateOfflineCleanupWrites(): void {
  offlineCleanupGeneration += 1;
}

/** The shared offline database (also holds the meal-diary outbox, Issue #77). */
export function getDb(): SQLite.SQLiteDatabase {
  if (!database) {
    database = SQLite.openDatabaseSync(DB_NAME);
    // Meal-diary (Issue #77) and plain-water outboxes are never size-capped;
    // rows leave only after the server confirms them or the member discards
    // them. They are separate tables so each lane owns only its own rows.
    database.execSync(OFFLINE_SCHEMA_SQL);
    const columns = database.getAllSync<{ name: string }>("PRAGMA table_info(outbox)");
    if (!columns.some((column) => column.name === "scope")) {
      database.execSync("ALTER TABLE outbox ADD COLUMN scope TEXT");
    }
  }
  return database;
}

type OutboxRow = {
  id: number;
  dedupe_hash: string;
  payload: string;
  last_error: string | null;
  saved_at: number;
  scope: string;
};

function rowKey(scope: string, dedupeHash: string): string {
  return `${scope}|${dedupeHash}`;
}

function toEntry(row: OutboxRow): OutboxEntry | null {
  try {
    return {
      scope: row.scope,
      dedupeHash: row.dedupe_hash.slice(row.scope.length + 1),
      payload: JSON.parse(row.payload),
      savedAt: row.saved_at,
      lastError: row.last_error,
    };
  } catch {
    return null;
  }
}

/** A cached query result plus when it was written. */
export type CacheEntry<T> = {
  data: T;
  savedAt: number;
};

/** Reads a cached query result for this account, or `null` when absent/corrupt. */
export function readCache<T>(scope: string, queryKey: string): CacheEntry<T> | null {
  const row = getDb().getFirstSync<{ data: string; saved_at: number }>(
    "SELECT data, saved_at FROM query_cache WHERE key = ?",
    `${scope}:${queryKey}`,
  );
  if (!row) return null;
  try {
    return { data: JSON.parse(row.data) as T, savedAt: row.saved_at };
  } catch {
    return null;
  }
}

/** Writes a query result into this account's cache, stamped with the current time. */
export function writeCache<T>(scope: string, queryKey: string, data: T): void {
  getDb().runSync(
    "INSERT OR REPLACE INTO query_cache (key, data, saved_at) VALUES (?, ?, ?)",
    `${scope}:${queryKey}`,
    JSON.stringify(data),
    Date.now(),
  );
}

/** This account's queued writes, oldest first. */
export function readOutbox(scope: string): OutboxEntry[] {
  const rows = getDb().getAllSync<OutboxRow>(
    "SELECT id, dedupe_hash, payload, last_error, saved_at, scope FROM outbox WHERE scope = ? ORDER BY id ASC",
    scope,
  );
  const entries: OutboxEntry[] = [];
  for (const row of rows) {
    const entry = toEntry(row);
    // Skip a corrupt row rather than wedging the whole queue.
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * Upserts a queued write by account + `dedupeHash`, then drops the oldest
 * rows once the outbox exceeds `OUTBOX_MAX_ENTRIES`.
 */
export function pushOutbox(entry: OutboxEntry): void {
  const db = getDb();
  db.runSync(
    "INSERT OR REPLACE INTO outbox (dedupe_hash, payload, last_error, saved_at, scope) VALUES (?, ?, ?, ?, ?)",
    rowKey(entry.scope, entry.dedupeHash),
    JSON.stringify(entry.payload),
    entry.lastError,
    entry.savedAt,
    entry.scope,
  );
  db.runSync(
    "DELETE FROM outbox WHERE id NOT IN (SELECT id FROM outbox ORDER BY id DESC LIMIT ?)",
    OUTBOX_MAX_ENTRIES,
  );
}

/** Removes and returns this account's oldest queued write, or `null` when empty. */
export function popOutbox(scope: string): OutboxEntry | null {
  const db = getDb();
  const row = db.getFirstSync<OutboxRow>(
    "SELECT id, dedupe_hash, payload, last_error, saved_at, scope FROM outbox WHERE scope = ? ORDER BY id ASC LIMIT 1",
    scope,
  );
  if (!row) return null;
  db.runSync("DELETE FROM outbox WHERE id = ?", row.id);
  return toEntry(row);
}

/** Removes this account's cached reads whose key starts with `prefix`. */
export function clearCachePrefix(scope: string, prefix: string): void {
  const pattern = `${scope}:${prefix}`.replace(/[\\%_]/g, (char) => `\\${char}`);
  getDb().runSync("DELETE FROM query_cache WHERE key LIKE ? ESCAPE '\\'", `${pattern}%`);
}

/** Wipes every cached read and queued write, for all accounts (sign-out). */
export function clearOfflineData(): void {
  invalidateOfflineCleanupWrites();
  const db = getDb();
  db.runSync("DELETE FROM query_cache");
  db.runSync("DELETE FROM outbox");
  db.runSync("DELETE FROM nutrition_outbox");
  // Receipt storage was introduced after the offline database. Create it if
  // needed so this also safely clears upgraded and never-initialized installs.
  db.execSync(
    "CREATE TABLE IF NOT EXISTS nutrition_entry_receipt (scope TEXT NOT NULL, mutation_id TEXT NOT NULL, item_key TEXT NOT NULL DEFAULT '', entry_id TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(scope, mutation_id, item_key))",
  );
  db.runSync("DELETE FROM nutrition_entry_receipt");
  db.runSync("DELETE FROM plain_water_outbox");
}

/**
 * Issue #295 — writes on this phone the server has not confirmed yet, across
 * every lane (metrics, meals, water, workouts) and account. Rows from before
 * account scoping are never sent, so they do not count.
 */
export function countQueuedWrites(): number {
  const row = getDb().getFirstSync<{ total: number }>(
    `SELECT
      (SELECT COUNT(*) FROM outbox WHERE scope IS NOT NULL) +
      (SELECT COUNT(*) FROM nutrition_outbox) +
      (SELECT COUNT(*) FROM plain_water_outbox) +
      (SELECT COUNT(*) FROM workout_outbox) AS total`,
  );
  return row?.total ?? 0;
}

/**
 * Issue #295 — on a server switch, wipe everything `clearOfflineData` does plus
 * workout drafts, queued workouts and their acknowledgements: none of it
 * belongs on the next server.
 */
export function clearAllServerData(): void {
  clearOfflineData();
  const db = getDb();
  db.runSync("DELETE FROM workout_drafts");
  db.runSync("DELETE FROM workout_outbox");
  db.runSync("DELETE FROM workout_acks");
}
