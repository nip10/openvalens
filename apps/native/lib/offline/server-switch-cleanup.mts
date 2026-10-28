import { Database } from "bun:sqlite";
import { describe, expect, mock, test } from "bun:test";

import { OFFLINE_SCHEMA_SQL } from "./schema";

const sqlite = new Database(":memory:");
sqlite.exec(OFFLINE_SCHEMA_SQL);
const expoDb = {
  execSync: (sql: string) => sqlite.exec(sql),
  getAllSync: <T,>(sql: string, ...params: unknown[]) =>
    sqlite.query(sql).all(...(params as never[])) as T[],
  getFirstSync: <T,>(sql: string, ...params: unknown[]) =>
    (sqlite.query(sql).get(...(params as never[])) ?? null) as T | null,
  runSync: (sql: string, ...params: unknown[]) => sqlite.query(sql).run(...(params as never[])),
};
mock.module("expo-sqlite", () => ({ openDatabaseSync: () => expoDb }));

const { clearAllServerData, countQueuedWrites, getDb } = await import("./cache");

function count(table: string): number {
  return (sqlite.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function seed() {
  const db = getDb();
  db.runSync(
    "INSERT INTO outbox (dedupe_hash, payload, last_error, saved_at, scope) VALUES ('a|1', '{}', NULL, 1, 'a')",
  );
  // A row from before account scoping: never sent, so not "unsynced".
  db.runSync(
    "INSERT INTO outbox (dedupe_hash, payload, last_error, saved_at, scope) VALUES ('legacy', '{}', NULL, 1, NULL)",
  );
  db.runSync("INSERT INTO nutrition_outbox (scope, id, item) VALUES ('a', 'n1', '{}')");
  db.runSync("INSERT INTO plain_water_outbox (scope, id, item) VALUES ('a', 'w1', '{}')");
  db.runSync("INSERT INTO plain_water_outbox (scope, id, item) VALUES ('b', 'w2', '{}')");
  db.runSync("INSERT INTO workout_outbox (scope, id, item) VALUES ('a', 'k1', '{}')");
  db.runSync("INSERT INTO workout_drafts (scope, item) VALUES ('a', '{}')");
  db.runSync(
    "INSERT INTO workout_acks (scope, clientMutationId, serverId, version, result, acknowledgedAt) VALUES ('a', 'm1', 1, 1, '{}', 1)",
  );
  db.runSync("INSERT INTO query_cache (key, data, saved_at) VALUES ('a:x', '{}', 1)");
}

describe("offline data on a server switch (#295)", () => {
  test("counts queued writes in every lane and account", () => {
    seed();
    expect(countQueuedWrites()).toBe(5);
  });

  test("wipes cached reads, every outbox, and workout drafts and acknowledgements", () => {
    clearAllServerData();
    expect(countQueuedWrites()).toBe(0);
    for (const table of [
      "query_cache",
      "outbox",
      "nutrition_outbox",
      "plain_water_outbox",
      "workout_outbox",
      "workout_drafts",
      "workout_acks",
    ]) {
      expect(count(table)).toBe(0);
    }
  });
});
