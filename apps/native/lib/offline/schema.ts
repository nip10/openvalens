/**
 * Offline SQLite schema, kept free of Expo imports so the exact DDL can be
 * exercised against a real SQLite engine in tests.
 *
 * Meal and water rows live in separate outboxes: neither lane may list, drain
 * or clear the other's pending operations.
 */
export const OFFLINE_SCHEMA_SQL = `
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
  CREATE TABLE IF NOT EXISTS nutrition_outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    id TEXT NOT NULL,
    item TEXT NOT NULL,
    UNIQUE (scope, id)
  );
  CREATE TABLE IF NOT EXISTS plain_water_outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    id TEXT NOT NULL,
    item TEXT NOT NULL,
    UNIQUE (scope, id)
  );
  CREATE TABLE IF NOT EXISTS workout_drafts (
    scope TEXT PRIMARY KEY,
    item TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workout_outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    id TEXT NOT NULL,
    item TEXT NOT NULL,
    UNIQUE (scope, id)
  );
  CREATE TABLE IF NOT EXISTS workout_acks (
    scope TEXT NOT NULL, clientMutationId TEXT NOT NULL, serverId INTEGER NOT NULL,
    version INTEGER NOT NULL, result TEXT NOT NULL, acknowledgedAt INTEGER NOT NULL,
    PRIMARY KEY(scope, clientMutationId)
  );
`;
