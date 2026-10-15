import { getDb } from "@/lib/offline/cache";

import type { OutboxStore, QueuedChange } from "./outbox";

/**
 * SQLite-backed meal-diary outbox (Issue #77), in the same encrypted-at-rest
 * offline database as the read cache. Writes are synchronous, so a change is
 * on disk before the UI reports it as queued and survives an app restart.
 */
export const sqliteOutboxStore: OutboxStore = {
  list(scope) {
    const rows = getDb().getAllSync<{ seq: number; item: string }>(
      "SELECT seq, item FROM nutrition_outbox WHERE scope = ? ORDER BY seq ASC",
      scope,
    );
    const items: QueuedChange[] = [];
    for (const row of rows) {
      try {
        items.push({ ...(JSON.parse(row.item) as QueuedChange), seq: row.seq });
      } catch {
        // A corrupt row is skipped rather than wedging the queue.
      }
    }
    return items;
  },
  put(item) {
    const db = getDb();
    const json = JSON.stringify(item);
    const updated = db.runSync(
      "UPDATE nutrition_outbox SET item = ? WHERE scope = ? AND id = ?",
      json,
      item.scope,
      item.id,
    );
    if (updated.changes === 0)
      db.runSync(
        "INSERT INTO nutrition_outbox (scope, id, item) VALUES (?, ?, ?)",
        item.scope,
        item.id,
        json,
      );
  },
  remove(scope, id) {
    getDb().runSync("DELETE FROM nutrition_outbox WHERE scope = ? AND id = ?", scope, id);
  },
  nextSeq() {
    const row = getDb().getFirstSync<{ next: number }>(
      "SELECT coalesce(max(seq), 0) + 1 AS next FROM nutrition_outbox",
    );
    return row?.next ?? 1;
  },
};

/** Removes this account's queued diary changes (the "clear diary data" action). */
export function clearDiaryOutbox(scope: string): void {
  getDb().runSync("DELETE FROM nutrition_outbox WHERE scope = ?", scope);
}
