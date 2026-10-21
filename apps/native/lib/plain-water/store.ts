import { getDb } from "@/lib/offline/cache";
import type { WaterStore } from "./outbox";
import { createSqliteWaterStore } from "./store-adapter";

export const sqliteWaterStore: WaterStore = {
  list: (scope) => createSqliteWaterStore(getDb()).list(scope),
  put: (item) => createSqliteWaterStore(getDb()).put(item),
  remove: (scope, id) => createSqliteWaterStore(getDb()).remove(scope, id),
  nextSeq: () => createSqliteWaterStore(getDb()).nextSeq(),
  replaceConflict: (expected, replacement) =>
    createSqliteWaterStore(getDb()).replaceConflict?.(expected, replacement) ?? false,
};
