import type { OutboxStore, QueuedChange } from "./outbox";

/** Minimal synchronous SQLite surface shared by Expo SQLite and the test engine. */
export type NutritionSqlite = {
  getAllSync<T>(query: string, ...params: unknown[]): T[];
  getFirstSync<T>(query: string, ...params: unknown[]): T | null;
  runSync(query: string, ...params: unknown[]): { changes: number };
};

/** SQLite-backed meal-diary outbox, isolated to `nutrition_outbox`. */
export function createSqliteOutboxStore(db: NutritionSqlite): OutboxStore {
  return {
    list(scope) {
      const rows = db.getAllSync<{ seq: number; item: string }>(
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
      db.runSync("DELETE FROM nutrition_outbox WHERE scope = ? AND id = ?", scope, id);
    },
    nextSeq() {
      const row = db.getFirstSync<{ next: number }>(
        "SELECT coalesce(max(seq), 0) + 1 AS next FROM nutrition_outbox",
      );
      return row?.next ?? 1;
    },
  };
}

/** Removes this account's queued diary changes (the "clear diary data" action). */
export function clearDiaryOutboxIn(db: NutritionSqlite, scope: string): void {
  db.runSync("DELETE FROM nutrition_outbox WHERE scope = ?", scope);
}
