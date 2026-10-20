import { getDb } from "@/lib/offline/cache";
import type { WaterItem, WaterStore } from "./outbox";

const prefix = "plain-water:";
export const sqliteWaterStore: WaterStore = {
  list(scope) {
    const rows = getDb().getAllSync<{ seq: number; item: string }>(
      "SELECT seq,item FROM nutrition_outbox WHERE scope=? AND id LIKE ? ORDER BY seq ASC",
      scope,
      `${prefix}%`,
    );
    return rows.flatMap((row) => {
      try {
        return [{ ...(JSON.parse(row.item) as WaterItem), seq: row.seq }];
      } catch {
        return [];
      }
    });
  },
  put(item) {
    const db = getDb();
    const id = `${prefix}${item.id}`;
    const json = JSON.stringify(item);
    const updated = db.runSync(
      "UPDATE nutrition_outbox SET item=? WHERE scope=? AND id=?",
      json,
      item.scope,
      id,
    );
    if (!updated.changes)
      db.runSync("INSERT INTO nutrition_outbox(scope,id,item) VALUES(?,?,?)", item.scope, id, json);
  },
  remove(scope, id) {
    getDb().runSync("DELETE FROM nutrition_outbox WHERE scope=? AND id=?", scope, `${prefix}${id}`);
  },
  nextSeq() {
    return (
      getDb().getFirstSync<{ next: number }>(
        "SELECT coalesce(max(seq),0)+1 AS next FROM nutrition_outbox",
      )?.next ?? 1
    );
  },
};
