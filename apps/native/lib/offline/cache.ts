import { OUTBOX_MAX_ENTRIES, type OutboxEntry } from "@openvalens/api/presenters/offline";
import * as SQLite from "expo-sqlite";

/**
 * Native offline store (Issue #43). Backed by `expo-sqlite` — the same package
 * the HealthKit source already ships with. Mirrors the web cache/outbox shapes
 * so both platforms share behaviour.
 *
 * Tables:
 *   query_cache (key TEXT PRIMARY KEY, data TEXT, saved_at INTEGER)
 *   outbox      (id INTEGER PRIMARY KEY AUTOINCREMENT, dedupe_hash TEXT UNIQUE,
 *                payload TEXT, last_error TEXT, saved_at INTEGER)
 */

const DB_NAME = "openhealth-offline.db";

let database: SQLite.SQLiteDatabase | null = null;

function getDb(): SQLite.SQLiteDatabase {
  if (!database) {
    database = SQLite.openDatabaseSync(DB_NAME);
    database.execSync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS query_cache (
        key TEXT PRIMARY KEY,
        data TEXT,
        saved_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dedupe_hash TEXT UNIQUE,
        payload TEXT,
        last_error TEXT,
        saved_at INTEGER
      );
    `);
  }
  return database;
}

/** A cached query result plus when it was written. */
export type CacheEntry<T> = {
  data: T;
  savedAt: number;
};

/** Reads a cached query result, or `null` when absent/corrupt. */
export function readCache<T>(queryKey: string): CacheEntry<T> | null {
  const row = getDb().getFirstSync<{ data: string; saved_at: number }>(
    "SELECT data, saved_at FROM query_cache WHERE key = ?",
    queryKey,
  );
  if (!row) return null;
  try {
    return { data: JSON.parse(row.data) as T, savedAt: row.saved_at };
  } catch {
    return null;
  }
}

/** Writes a query result into the cache, stamped with the current time. */
export function writeCache<T>(queryKey: string, data: T, _ttlMs: number): void {
  getDb().runSync(
    "INSERT OR REPLACE INTO query_cache (key, data, saved_at) VALUES (?, ?, ?)",
    queryKey,
    JSON.stringify(data),
    Date.now(),
  );
}

/** Reads every queued write, oldest first. */
export function readOutbox(): OutboxEntry[] {
  const rows = getDb().getAllSync<{
    dedupe_hash: string;
    payload: string;
    last_error: string | null;
    saved_at: number;
  }>("SELECT dedupe_hash, payload, last_error, saved_at FROM outbox ORDER BY id ASC");

  const entries: OutboxEntry[] = [];
  for (const row of rows) {
    try {
      entries.push({
        dedupeHash: row.dedupe_hash,
        payload: JSON.parse(row.payload),
        savedAt: row.saved_at,
        lastError: row.last_error,
      });
    } catch {
      // Skip a corrupt row rather than wedging the whole queue.
    }
  }
  return entries;
}

/**
 * Upserts a queued write by `dedupeHash`, then drops the oldest rows once the
 * outbox exceeds `OUTBOX_MAX_ENTRIES`.
 */
export function pushOutbox(entry: OutboxEntry): void {
  const db = getDb();
  db.runSync(
    "INSERT OR REPLACE INTO outbox (dedupe_hash, payload, last_error, saved_at) VALUES (?, ?, ?, ?)",
    entry.dedupeHash,
    JSON.stringify(entry.payload),
    entry.lastError,
    entry.savedAt,
  );
  db.runSync(
    "DELETE FROM outbox WHERE id NOT IN (SELECT id FROM outbox ORDER BY id DESC LIMIT ?)",
    OUTBOX_MAX_ENTRIES,
  );
}

/** Removes and returns the oldest queued write, or `null` when empty. */
export function popOutbox(): OutboxEntry | null {
  const db = getDb();
  const row = db.getFirstSync<{
    id: number;
    dedupe_hash: string;
    payload: string;
    last_error: string | null;
    saved_at: number;
  }>("SELECT id, dedupe_hash, payload, last_error, saved_at FROM outbox ORDER BY id ASC LIMIT 1");
  if (!row) return null;
  db.runSync("DELETE FROM outbox WHERE id = ?", row.id);
  try {
    return {
      dedupeHash: row.dedupe_hash,
      payload: JSON.parse(row.payload),
      savedAt: row.saved_at,
      lastError: row.last_error,
    };
  } catch {
    return null;
  }
}

/** Empties the outbox. */
export function clearOutbox(): void {
  getDb().runSync("DELETE FROM outbox");
}
