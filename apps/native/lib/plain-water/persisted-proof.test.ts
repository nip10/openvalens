import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  WATER_COPY,
  buildWaterDayView,
  describeWaterAttention,
  formatWaterSubtotal,
  type WaterDayWire,
} from "@openvalens/api/presenters/plain-water";
import { canDiscardWaterItem, discard, drain, retry, type WaterItem } from "./outbox";
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

function persisted(raw: unknown) {
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
  let item;
  try {
    [item] = store.list(scope);
  } catch {
    // Invalid persisted rows are intentionally inaccessible via the adapter.
  }
  return { db, store, item: item as WaterItem };
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
  test("missing conflict metadata is quarantined; valid uncertain attempts remain projectable", () => {
    const { db, store } = persisted(base);
    expect(readWaterQueueSnapshot(store, scope)).toEqual({ items: [], error: "STORAGE" });
    db.query("UPDATE plain_water_outbox SET item=? WHERE scope=?").run(
      JSON.stringify({ ...base, conflict: null }),
      scope,
    );
    const valid = store.list(scope);
    const view = buildWaterDayView(day, valid, false);
    expect(view.reconciliationUnknown).toBe(true);
    expect(view.subtotalMl).toBeNull();
    expect(formatWaterSubtotal(view, "ml", false)).toBe(WATER_COPY.reconciliationUnknown);
    expect(describeWaterAttention(view.attention[0]!, "ml").title).toBe(
      WATER_COPY.reconciliationUnknown,
    );
    expect(canDiscardWaterItem(valid[0]!)).toBe(false);
    expect(discard(store, scope, valid[0]!.id)).toBe(false);
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
      { ...base, attempts: Number.NaN, conflict: null, lastErrorCode: "FORBIDDEN" },
      { ...base, attempts: Number.POSITIVE_INFINITY, conflict: null, lastErrorCode: "FORBIDDEN" },
      { ...base, attempts: 2, conflict: null, lastErrorCode: "CONFLICT" },
      {
        ...base,
        conflict: { id: 0, revision: 2, quantityMl: 250, deleted: false },
        lastErrorCode: "CONFLICT",
      },
    ];
    for (const raw of invalid) {
      const { db, store } = persisted(raw);
      expect(readWaterQueueSnapshot(store, scope)).toEqual({ items: [], error: "STORAGE" });
      db.close();
    }
  });

  test("parseable but structurally corrupt rows enter storage recovery instead of projection", () => {
    const invalid: unknown[] = [
      null,
      {},
      [],
      { ...base, conflict: null, op: null },
      { ...base, conflict: null, op: { kind: "add", input: null } },
      { ...base, conflict: null, op: { kind: "unknown", input: {} } },
      {
        ...base,
        conflict: null,
        op: { kind: "add", input: { ...base.op.input, unit: "gallons" } },
      },
      {
        ...base,
        conflict: null,
        op: { kind: "add", input: { ...base.op.input, clientMutationId: "" } },
      },
    ];
    for (const raw of invalid) {
      const { db, store } = persisted(raw);
      const before = (
        db.query("SELECT item FROM plain_water_outbox WHERE scope=?").get(scope) as { item: string }
      ).item;
      expect(readWaterQueueSnapshot(store, scope)).toEqual({ items: [], error: "STORAGE" });
      expect(
        (
          db.query("SELECT item FROM plain_water_outbox WHERE scope=?").get(scope) as {
            item: string;
          }
        ).item,
      ).toBe(before);
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

  test("presenter and discard share fail-closed queued proof", () => {
    const valid = persisted({
      ...base,
      status: "queued",
      attempts: 0,
      lastErrorCode: null,
      conflict: null,
    });
    const corrupt = { ...valid.item, conflict: "bad" as unknown as WaterItem["conflict"] };
    expect(canDiscardWaterItem(corrupt)).toBe(false);
    const view = buildWaterDayView(day, [corrupt], false);
    expect(view.reconciliationUnknown).toBe(true);
    expect(view.rows).toHaveLength(0);
    expect(view.subtotalMl).toBeNull();
    valid.db.close();
  });

  test("invalid persisted attempt history is quarantined before retry can manufacture proof", async () => {
    const invalid = persisted({ ...base, attempts: -1, conflict: null });
    let sends = 0;
    const sender = {
      async add() {
        sends++;
        throw Object.assign(new Error("denied"), { code: "FORBIDDEN" });
      },
      async change() {
        throw new Error("unexpected");
      },
      async delete() {
        throw new Error("unexpected");
      },
    };
    const rawBefore = (
      invalid.db.query("SELECT item FROM plain_water_outbox WHERE scope=?").get(scope) as {
        item: string;
      }
    ).item;
    expect(() => retry(invalid.store, scope, "op-1")).toThrow(
      "Could not read persisted plain-water changes",
    );
    await expect(drain(invalid.store, sender, scope)).rejects.toThrow();
    const snapshot = readWaterQueueSnapshot(invalid.store, scope);
    expect(snapshot.error).toBe("STORAGE");
    expect(sends).toBe(0);
    expect(() => discard(invalid.store, scope, "op-1")).toThrow(
      "Could not read persisted plain-water changes",
    );
    expect(
      (
        invalid.db.query("SELECT item FROM plain_water_outbox WHERE scope=?").get(scope) as {
          item: string;
        }
      ).item,
    ).toBe(rawBefore);
    invalid.db.close();
  });

  test("malformed conflict attention is storage recovery, not a dead retry action", () => {
    const invalid = persisted({ ...base, conflict: { id: "bad" }, lastErrorCode: "CONFLICT" });
    expect(readWaterQueueSnapshot(invalid.store, scope)).toEqual({ items: [], error: "STORAGE" });
    const raw = (
      invalid.db.query("SELECT item FROM plain_water_outbox WHERE scope=?").get(scope) as {
        item: string;
      }
    ).item;
    expect(JSON.parse(raw).conflict).toEqual({ id: "bad" });
    invalid.db.close();
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
    db.query("UPDATE plain_water_outbox SET item=? WHERE scope=?").run(
      JSON.stringify({ ...base, conflict: null }),
      scope,
    );
    const recovered = readWaterQueueSnapshot(store, scope);
    expect(recovered.error).toBeNull();
    expect(recovered.items).toHaveLength(1);
    db.query("DELETE FROM plain_water_outbox WHERE scope=?").run(scope);
    expect(readWaterQueueSnapshot(store, scope)).toEqual({ items: [], error: null });
    db.close();
  });
});
