import type { WaterItem, WaterStore } from "./outbox";

// The prefix keeps water ids visually distinct from meal mutation ids. Rows
// themselves live in `plain_water_outbox`, never the meal outbox.
const prefix = "plain-water:";
export type WaterSqlite = {
  getAllSync<T>(query: string, ...params: unknown[]): T[];
  getFirstSync<T>(query: string, ...params: unknown[]): T | null;
  runSync(query: string, ...params: unknown[]): { changes: number };
};

export function createSqliteWaterStore(db: WaterSqlite): WaterStore {
  return {
    list(scope) {
      const rows = db.getAllSync<{ seq: number; scope: string; id: string; item: string }>(
        "SELECT seq,scope,id,item FROM plain_water_outbox WHERE scope=? AND id LIKE ? ORDER BY seq ASC",
        scope,
        `${prefix}%`,
      );
      return rows.flatMap((row) => {
        try {
          return [
            {
              ...(JSON.parse(row.item) as WaterItem),
              id: row.id.slice(prefix.length),
              scope: row.scope,
              seq: row.seq,
            },
          ];
        } catch {
          return [];
        }
      });
    },
    put(item) {
      const id = `${prefix}${item.id}`;
      const json = JSON.stringify(item);
      const updated = db.runSync(
        "UPDATE plain_water_outbox SET item=? WHERE scope=? AND id=?",
        json,
        item.scope,
        id,
      );
      if (!updated.changes)
        db.runSync(
          "INSERT INTO plain_water_outbox(scope,id,item) VALUES(?,?,?)",
          item.scope,
          id,
          json,
        );
    },
    remove(scope, id) {
      db.runSync("DELETE FROM plain_water_outbox WHERE scope=? AND id=?", scope, `${prefix}${id}`);
    },
    nextSeq() {
      return (
        db.getFirstSync<{ next: number }>(
          "SELECT coalesce(max(seq),0)+1 AS next FROM plain_water_outbox",
        )?.next ?? 1
      );
    },
  };
}
