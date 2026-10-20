import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  WATER_COPY,
  buildWaterDayView,
  describeWaterAttention,
  formatWaterSubtotal,
  type WaterDayWire,
} from "@openvalens/api/presenters/plain-water";
import { canDiscardWaterItem, discard } from "./outbox";
import { createSqliteWaterStore } from "./store-adapter";
import { readWaterQueueSnapshot } from "./queue-snapshot";

const scope = "member-a:org-a";
const day: WaterDayWire = {
  date: "2026-07-01",
  timeZone: "UTC",
  label: "Plain water subtotal",
  enabled: true,
  quantityMl: 0,
  personalGoalMl: null,
  entries: [],
};

function persisted(raw: Record<string, unknown>) {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE plain_water_outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    id TEXT NOT NULL,
    item TEXT NOT NULL,
    UNIQUE (scope, id)
  )`);
  db.query("INSERT INTO plain_water_outbox(scope,id,item) VALUES(?,?,?)").run(
    scope,
    "plain-water:op-1",
    JSON.stringify(raw),
  );
  const store = createSqliteWaterStore({
    getAllSync: (query, ...params) => db.query(query).all(...(params as never[])) as never,
    getFirstSync: (query, ...params) => db.query(query).get(...(params as never[])) as never,
    runSync: (query, ...params) => db.query(query).run(...(params as never[])),
  });
  const [item] = store.list(scope);
  return { db, store, item: item! };
}

const base = {
  id: "op-1",
  scope,
  seq: 1,
  op: {
    kind: "add",
    input: {
      quantity: 250,
      unit: "ml",
      observedAt: "2026-07-01T12:00:00.000Z",
      timeZone: "UTC",
      clientMutationId: "op-1",
    },
  },
  status: "needs_attention",
  attempts: 2,
  lastErrorCode: "FORBIDDEN",
  createdAt: 1,
};

describe("persisted water proof metadata", () => {
  test("missing conflict receipt after an attempted add remains uncertain and cannot be discarded", () => {
    const { db, store, item } = persisted(base);
    const view = buildWaterDayView(day, [item], false);
    expect(view.reconciliationUnknown).toBe(true);
    expect(view.subtotalMl).toBeNull();
    expect(view.incomplete).toBe(true);
    expect(formatWaterSubtotal(view, "ml", false)).toBe(WATER_COPY.reconciliationUnknown);
    expect(describeWaterAttention(view.attention[0]!, "ml").title).toBe(
      WATER_COPY.reconciliationUnknown,
    );
    expect(canDiscardWaterItem(item)).toBe(false);
    expect(discard(store, scope, item.id)).toBe(false);
    expect(store.list(scope)).toHaveLength(1);
    db.close();
  });

  test("invalid or contradictory receipts and attempt history do not prove non-application", () => {
    const invalid = [
      { ...base, conflict: "bad" },
      {
        ...base,
        conflict: { id: 1, revision: 2, quantityMl: "250", deleted: false },
        lastErrorCode: "CONFLICT",
      },
      {
        ...base,
        conflict: { id: 1, revision: 2, quantityMl: 250, deleted: false },
        lastErrorCode: "FORBIDDEN",
      },
      { ...base, attempts: undefined, conflict: null, lastErrorCode: "FORBIDDEN" },
      { ...base, attempts: -1, conflict: null, lastErrorCode: "FORBIDDEN" },
      { ...base, attempts: 1.5, conflict: null, lastErrorCode: "FORBIDDEN" },
    ];
    for (const raw of invalid) {
      const { db, store, item } = persisted(raw);
      const view = buildWaterDayView(day, [item], false);
      expect(view.reconciliationUnknown).toBe(true);
      expect(view.subtotalMl).toBeNull();
      expect(formatWaterSubtotal(view, "ml", false)).toBe(WATER_COPY.reconciliationUnknown);
      expect(canDiscardWaterItem(item)).toBe(false);
      expect(discard(store, scope, item.id)).toBe(false);
      db.close();
    }
  });

  test("valid conflict receipt with marker and first-attempt rejection remain authoritative", () => {
    const conflict = persisted({
      ...base,
      lastErrorCode: "CONFLICT",
      conflict: { id: 8, revision: 2, quantityMl: 250, deleted: false },
    });
    expect(buildWaterDayView(day, [conflict.item], false).reconciliationUnknown).toBe(false);
    expect(canDiscardWaterItem(conflict.item)).toBe(true);
    conflict.db.close();

    const firstReject = persisted({
      ...base,
      attempts: 1,
      conflict: null,
      lastErrorCode: "FORBIDDEN",
    });
    expect(buildWaterDayView(day, [firstReject.item], false).reconciliationUnknown).toBe(false);
    expect(canDiscardWaterItem(firstReject.item)).toBe(true);
    firstReject.db.close();
  });

  test("corrupt persisted queue JSON is reported rather than projected as an empty queue", () => {
    const db = new Database(":memory:");
    db.run(`CREATE TABLE plain_water_outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      id TEXT NOT NULL,
      item TEXT NOT NULL,
      UNIQUE (scope, id)
    )`);
    db.query("INSERT INTO plain_water_outbox(scope,id,item) VALUES(?,?,?)").run(
      scope,
      "plain-water:op-1",
      "{not-json",
    );
    const store = createSqliteWaterStore({
      getAllSync: (query, ...params) => db.query(query).all(...(params as never[])) as never,
      getFirstSync: (query, ...params) => db.query(query).get(...(params as never[])) as never,
      runSync: (query, ...params) => db.query(query).run(...(params as never[])),
    });
    expect(readWaterQueueSnapshot(store, null)).toEqual({ items: [], error: null });
    const original = db.query("SELECT item FROM plain_water_outbox WHERE scope=?").get(scope) as {
      item: string;
    };
    expect(readWaterQueueSnapshot(store, scope)).toEqual({ items: [], error: "STORAGE" });
    expect(
      (db.query("SELECT item FROM plain_water_outbox WHERE scope=?").get(scope) as { item: string })
        .item,
    ).toBe(original.item);
    db.query("UPDATE plain_water_outbox SET item=? WHERE scope=?").run(JSON.stringify(base), scope);
    const recovered = readWaterQueueSnapshot(store, scope);
    expect(recovered.error).toBeNull();
    expect(recovered.items).toHaveLength(1);
    db.query("DELETE FROM plain_water_outbox WHERE scope=?").run(scope);
    expect(readWaterQueueSnapshot(store, scope)).toEqual({ items: [], error: null });
    db.close();
  });
});
