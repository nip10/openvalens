/**
 * Runs the exact offline DDL against a real SQLite engine (`bun:sqlite`).
 * Expo's native binding cannot be opened under Bun, so `getDb()` itself is not
 * exercised here; the adapter SQL and table layout are.
 */
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { drain as drainMeal, enqueue as enqueueMeal } from "../nutrition/outbox";
import { clearDiaryOutboxIn, createSqliteOutboxStore } from "../nutrition/store-adapter";
import { OFFLINE_SCHEMA_SQL } from "../offline/schema";
import { drain, enqueue, type WaterItem, type WaterOperation, type WaterSender } from "./outbox";
import { createSqliteWaterStore } from "./store-adapter";

const SCOPE = "user-a:org-a";

type SqlResult = { changes: number };
type SqlStatement = { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown };

/** Real SQLite engine behind the same synchronous surface Expo SQLite exposes. */
class RealSqlite {
  constructor(private readonly database: Database) {}
  exec(sql: string): void {
    this.database.exec(sql);
  }
  getAllSync<T>(sql: string, ...params: unknown[]): T[] {
    return (this.database.query(sql) as unknown as SqlStatement).all(...params) as T[];
  }
  getFirstSync<T>(sql: string, ...params: unknown[]): T | null {
    return ((this.database.query(sql) as unknown as SqlStatement).get(...params) ??
      null) as T | null;
  }
  runSync(sql: string, ...params: unknown[]): SqlResult {
    return (this.database.run as unknown as (query: string, ...values: unknown[]) => SqlResult)(
      sql,
      ...params,
    );
  }
}

const waterOperation = (id: string): WaterOperation => ({
  kind: "add",
  input: {
    quantity: 300,
    unit: "ml",
    observedAt: "2026-10-12T12:00:00Z",
    timeZone: "UTC",
    clientMutationId: id,
  },
});

const mealOperation = (id: string) => ({
  kind: "setDayStatus" as const,
  input: { localDate: "2026-10-12", complete: true, clientMutationId: id },
});

const waterSender = (calls: string[], outcome: "applied" | "conflict"): WaterSender => ({
  add: async (input) => {
    calls.push(input.clientMutationId);
    return outcome === "conflict"
      ? {
          outcome: "conflict" as const,
          entry: { id: 1, revision: 2, quantityMl: null, deleted: false },
        }
      : {
          outcome: "applied" as const,
          entry: { id: 1, revision: 1, quantityMl: 300, deleted: false },
        };
  },
  change: async () => {
    throw new Error("unexpected water change");
  },
  delete: async () => {
    throw new Error("unexpected water delete");
  },
});

const mealSender = (calls: string[]) => ({
  logEntry: async () => {
    throw new Error("unexpected meal log");
  },
  updateEntry: async () => {
    throw new Error("unexpected meal update");
  },
  deleteEntry: async () => {
    throw new Error("unexpected meal delete");
  },
  restoreEntry: async () => {
    throw new Error("unexpected meal restore");
  },
  setDayStatus: async (input: { clientMutationId?: string }) => {
    calls.push(input.clientMutationId ?? "missing-id");
  },
  copyDay: async () => {
    throw new Error("unexpected meal copy");
  },
});

describe("plain-water and meal outbox coexistence", () => {
  test("meal list, drain and clear never touch pending water rows", async () => {
    const sqlite = new RealSqlite(new Database(":memory:"));
    sqlite.exec(OFFLINE_SCHEMA_SQL);
    const water = createSqliteWaterStore(sqlite);
    const meal = createSqliteOutboxStore(sqlite);
    enqueue(water, SCOPE, waterOperation("water-1"), 1);
    enqueueMeal(meal, SCOPE, { op: mealOperation("meal-1") }, 2);

    expect(meal.list(SCOPE).map((item) => item.id)).toEqual(["meal-1"]);
    expect(water.list(SCOPE).map((item) => item.id)).toEqual(["water-1"]);

    const mealCalls: string[] = [];
    await drainMeal(meal, mealSender(mealCalls), SCOPE);
    expect(mealCalls).toEqual(["meal-1"]);
    expect(meal.list(SCOPE)).toHaveLength(0);
    expect(water.list(SCOPE)).toHaveLength(1);

    const waterCalls: string[] = [];
    expect((await drain(water, waterSender(waterCalls, "applied"), SCOPE)).sent).toBe(1);
    expect(waterCalls).toEqual(["water-1"]);
    expect(water.list(SCOPE)).toHaveLength(0);

    enqueue(water, SCOPE, waterOperation("water-conflict"), 3);
    enqueueMeal(meal, SCOPE, { op: mealOperation("meal-2") }, 4);
    await drain(water, waterSender([], "conflict"), SCOPE);
    expect(water.list(SCOPE)[0]).toMatchObject({
      status: "needs_attention",
      lastErrorCode: "CONFLICT",
      conflict: { revision: 2 },
    });
    expect(meal.list(SCOPE).map((item) => item.id)).toEqual(["meal-2"]);
    expect(meal.list(SCOPE)[0]?.conflict).toBeNull();

    clearDiaryOutboxIn(sqlite, SCOPE);
    expect(meal.list(SCOPE)).toHaveLength(0);
    expect(water.list(SCOPE)).toHaveLength(1);
    expect(water.list(SCOPE)[0]).toMatchObject({
      id: "water-conflict",
      status: "needs_attention",
      conflict: { revision: 2 },
    });
  });

  test("a persisted syncing row is requeued before it is sent", async () => {
    const sqlite = new RealSqlite(new Database(":memory:"));
    sqlite.exec(OFFLINE_SCHEMA_SQL);
    const base = createSqliteWaterStore(sqlite);
    const statuses: string[] = [];
    const store = {
      ...base,
      put(item: WaterItem) {
        statuses.push(item.status);
        base.put(item);
      },
    };
    const item = enqueue(store, SCOPE, waterOperation("crash"), 1);
    base.put({ ...item, status: "syncing", attempts: 1 });
    expect(base.list(SCOPE)[0]?.status).toBe("syncing");

    const calls: string[] = [];
    expect((await drain(store, waterSender(calls, "applied"), SCOPE)).sent).toBe(1);
    expect(calls).toEqual(["crash"]);
    expect(statuses.slice(0, 3)).toEqual(["queued", "queued", "syncing"]);
    expect(base.list(SCOPE)).toHaveLength(0);
  });

  test("crash-recovered syncing rows remain ineligible for discard", async () => {
    const sqlite = new RealSqlite(new Database(":memory:"));
    sqlite.exec(OFFLINE_SCHEMA_SQL);
    const store = createSqliteWaterStore(sqlite);
    const item = enqueue(store, SCOPE, waterOperation("uncertain-crash"), 1);
    store.put({ ...item, status: "syncing" });
    await drain(store, waterSender([], "conflict"), SCOPE);
    expect(store.list(SCOPE)[0]).toMatchObject({
      status: "needs_attention",
      attempts: 2,
      lastErrorCode: "CONFLICT",
    });
  });
});
