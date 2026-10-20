import { getDb } from "@/lib/offline/cache";

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
  remove: (scope, id) => createSqliteOutboxStore(getDb()).remove(scope, id),
  nextSeq: () => createSqliteOutboxStore(getDb()).nextSeq(),
};

/** Removes this account's queued diary changes (the "clear diary data" action). */
export function clearDiaryOutbox(scope: string): void {
  clearDiaryOutboxIn(getDb(), scope);
}
