import { getDb, invalidateOfflineCleanupWrites } from "@/lib/offline/cache";

import type { OutboxStore } from "./outbox";
import { clearDiaryOutboxIn, createSqliteOutboxStore } from "./store-adapter";

/**
 * SQLite-backed meal-diary outbox (Issue #77), in the same encrypted-at-rest
 * offline database as the read cache. Writes are synchronous, so a change is
 * on disk before the UI reports it as queued and survives an app restart.
 *
 * Water operations live in a separate table and are never listed here.
 */
export const sqliteOutboxStore: OutboxStore = {
  list: (scope) => createSqliteOutboxStore(getDb()).list(scope),
  put: (item) => createSqliteOutboxStore(getDb()).put(item),
  updateEntryReceipts: (scope, entryId, revision) => {
    getDb().execSync(
      "CREATE TABLE IF NOT EXISTS nutrition_entry_receipt (scope TEXT NOT NULL, mutation_id TEXT NOT NULL, item_key TEXT NOT NULL DEFAULT '', entry_id TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(scope, mutation_id, item_key))",
    );
    createSqliteOutboxStore(getDb()).updateEntryReceipts?.(scope, entryId, revision);
  },
  remove: (scope, id) => createSqliteOutboxStore(getDb()).remove(scope, id),
  nextSeq: () => createSqliteOutboxStore(getDb()).nextSeq(),
  getEntryReceipt: (scope, mutationId, itemKey) => {
    getDb().execSync(
      "CREATE TABLE IF NOT EXISTS nutrition_entry_receipt (scope TEXT NOT NULL, mutation_id TEXT NOT NULL, item_key TEXT NOT NULL DEFAULT '', entry_id TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(scope, mutation_id, item_key))",
    );
    const row = getDb().getFirstSync<{ entry_id: string; revision: number }>(
      "SELECT entry_id, revision FROM nutrition_entry_receipt WHERE scope = ? AND mutation_id = ? AND item_key = ?",
      scope,
      mutationId,
      itemKey ?? "",
    );
    return row
      ? {
          entryId: /^\d+$/.test(row.entry_id) ? Number(row.entry_id) : row.entry_id,
          revision: row.revision,
        }
      : null;
  },
  putEntryReceipt: (scope, mutationId, itemKey, entryId, revision) => {
    getDb().execSync(
      "CREATE TABLE IF NOT EXISTS nutrition_entry_receipt (scope TEXT NOT NULL, mutation_id TEXT NOT NULL, item_key TEXT NOT NULL DEFAULT '', entry_id TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(scope, mutation_id, item_key))",
    );
    getDb().runSync(
      "INSERT OR REPLACE INTO nutrition_entry_receipt(scope, mutation_id, item_key, entry_id, revision) VALUES (?, ?, ?, ?, ?)",
      scope,
      mutationId,
      itemKey ?? "",
      String(entryId),
      revision,
    );
  },
};

/** Removes this account's queued diary changes (the "clear diary data" action). */
export function clearDiaryOutbox(scope: string): void {
  invalidateOfflineCleanupWrites();
  clearDiaryOutboxIn(getDb(), scope);
  getDb().execSync(
    "CREATE TABLE IF NOT EXISTS nutrition_entry_receipt (scope TEXT NOT NULL, mutation_id TEXT NOT NULL, item_key TEXT NOT NULL DEFAULT '', entry_id TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(scope, mutation_id, item_key))",
  );
  getDb().runSync("DELETE FROM nutrition_entry_receipt WHERE scope = ?", scope);
}
