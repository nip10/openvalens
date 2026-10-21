import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { OFFLINE_SCHEMA_SQL } from "../offline/schema";
import {
  discard,
  drain,
  enqueue,
  resolveConflict,
  type WaterItem,
  type WaterOperation,
  type WaterStore,
} from "./outbox";
import { createSqliteWaterStore, type WaterSqlite } from "./store-adapter";

type SqlResult = { changes: number };
type SqlStatement = { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown };

class RealSqlite implements WaterSqlite {
  constructor(private readonly database: Database) {}
  exec(sql: string) {
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

const scope = "member-a:workspace-1";
const operation = (id: string, quantity = 500): WaterOperation => ({
  kind: "change",
  input: { id: 44, clientMutationId: id, expectedRevision: 3, quantity, unit: "ml" },
});
const conflictItem = (store: WaterStore, id = "old", quantity = 500): WaterItem => {
  const item = enqueue(store, scope, operation(id, quantity), 10);
  const conflicted = {
    ...item,
    status: "needs_attention" as const,
    attempts: 1,
    lastErrorCode: "CONFLICT",
    conflict: { id: 44, revision: 9, quantityMl: 250, deleted: false },
  };
  store.put(conflicted);
  return conflicted;
};
const makeDb = () => {
  const db = new RealSqlite(new Database(":memory:"));
  db.exec(OFFLINE_SCHEMA_SQL);
  return db;
};

describe("atomic native conflict replacement", () => {
  test("fails closed for unsupported capability, missing/wrong scope, and stale candidates", () => {
    const db = makeDb();
    const store = createSqliteWaterStore(db);
    const old = conflictItem(store);
    const unsupported: WaterStore = { ...store, replaceConflict: undefined };
    expect(resolveConflict(unsupported, scope, old.id, () => "fresh")).toBe(false);
    expect(resolveConflict(store, "other:workspace", old.id, () => "fresh")).toBe(false);
    expect(resolveConflict(store, scope, "missing", () => "fresh")).toBe(false);

    const snapshot = store.list(scope)[0]!;
    store.put({ ...snapshot, conflict: { ...snapshot.conflict!, revision: 10 } });
    const replacement = {
      ...snapshot,
      id: "fresh",
      op: operation("fresh"),
      status: "queued" as const,
      attempts: 0,
      lastErrorCode: null,
      conflict: null,
    };
    expect(store.replaceConflict?.(snapshot, replacement)).toBe(false);
    expect(store.list(scope)[0]?.id).toBe("old");
  });

  test("rejects changed status, revision, payload, deleted conflict, and invalid operation", () => {
    const db = makeDb();
    const store = createSqliteWaterStore(db);
    const old = conflictItem(store);
    const replacement = {
      ...old,
      id: "fresh",
      op: operation("fresh"),
      status: "queued" as const,
      attempts: 0,
      lastErrorCode: null,
      conflict: null,
    };
    for (const changed of [
      { ...old, status: "queued" as const },
      { ...old, op: operation("old", 501) },
      { ...old, conflict: { ...old.conflict!, revision: 10 } },
      { ...old, conflict: { ...old.conflict!, deleted: true } },
      { ...old, conflict: { ...old.conflict!, id: 45 } },
      {
        ...old,
        op: {
          kind: "add" as const,
          input: {
            quantity: 500,
            unit: "ml" as const,
            observedAt: "2026-07-01T12:00:00Z",
            timeZone: "UTC",
            clientMutationId: "old",
          },
        },
      },
    ]) {
      expect(store.replaceConflict?.(changed, replacement)).toBe(false);
    }
    expect(store.list(scope)[0]?.id).toBe("old");
  });

  test("one CAS swaps the row, preserves sequence/intent, survives adapter recreation, and leaves meal rows untouched", () => {
    const db = makeDb();
    const store = createSqliteWaterStore(db);
    const old = conflictItem(store);
    db.runSync(
      "INSERT INTO nutrition_outbox(scope,id,item) VALUES(?,?,?)",
      scope,
      "meal-id",
      JSON.stringify({
        id: "meal-id",
        scope,
        op: {
          kind: "setDayStatus",
          input: { localDate: "2026-07-01", complete: true, clientMutationId: "meal-id" },
        },
      }),
    );
    // The database sequence is authoritative; list() normalizes away this stale JSON sequence.
    db.runSync(
      "UPDATE plain_water_outbox SET item=? WHERE scope=? AND id=?",
      JSON.stringify({ ...old, seq: 777 }),
      scope,
      "plain-water:old",
    );
    const normalized = store.list(scope)[0]!;
    expect(normalized.seq).not.toBe(777);
    expect(resolveConflict(store, scope, old.id, () => "fresh")).toBe(true);
    expect(resolveConflict(store, scope, old.id, () => "another")).toBe(false);
    expect(discard(store, scope, old.id)).toBe(false);
    expect(store.list(scope)).toHaveLength(1);
    expect(store.list(scope)[0]).toMatchObject({
      id: "fresh",
      seq: normalized.seq,
      status: "queued",
      attempts: 0,
      op: {
        kind: "change",
        input: {
          id: 44,
          clientMutationId: "fresh",
          expectedRevision: 9,
          quantity: 500,
          unit: "ml",
        },
      },
    });
    const recreated = createSqliteWaterStore(db);
    expect(recreated.list(scope)[0]?.id).toBe("fresh");
    expect(
      db
        .getAllSync<{ id: string }>("SELECT id FROM nutrition_outbox WHERE scope=?", scope)
        .map((item) => item.id),
    ).toEqual(["meal-id"]);
  });

  test("ID collision and no-op/thrown updates leave the old row and create no replacement", () => {
    const db = makeDb();
    const store = createSqliteWaterStore(db);
    const old = conflictItem(store);
    enqueue(store, scope, operation("taken"), 11);
    expect(resolveConflict(store, scope, old.id, () => "taken")).toBe(false);
    expect(store.list(scope).map((item) => item.id)).toEqual(["old", "taken"]);
    expect(
      createSqliteWaterStore(db)
        .list(scope)
        .map((item) => item.id),
    ).toEqual(["old", "taken"]);

    for (const mode of ["noop", "throw"] as const) {
      const controlled: WaterStore = {
        ...store,
        replaceConflict(expected, replacement) {
          const adapter = createSqliteWaterStore({
            getAllSync: (sql, ...params) => db.getAllSync(sql, ...params),
            getFirstSync: (sql, ...params) => db.getFirstSync(sql, ...params),
            runSync(sql, ...params) {
              if (sql.startsWith("UPDATE plain_water_outbox SET id=?")) {
                if (mode === "throw") throw new Error("update failed");
                return { changes: 0 };
              }
              return db.runSync(sql, ...params);
            },
          });
          return adapter.replaceConflict?.(expected, replacement) ?? false;
        },
      };
      expect(resolveConflict(controlled, scope, old.id, () => `new-${mode}`)).toBe(false);
      expect(
        createSqliteWaterStore(db)
          .list(scope)
          .map((item) => item.id),
      ).toEqual(["old", "taken"]);
    }
    expect(discard(createSqliteWaterStore(db), scope, old.id)).toBe(true);
    expect(
      createSqliteWaterStore(db)
        .list(scope)
        .map((item) => item.id),
    ).toEqual(["taken"]);
  });

  test("replacement is persisted before transport, then ack-loss retries the same new ID and payload", async () => {
    const db = makeDb();
    const store = createSqliteWaterStore(db);
    const old = conflictItem(store);
    let sends = 0;
    const sent: Array<{ id: string; payload: unknown }> = [];
    const sender = {
      add: async () => {
        throw new Error("unexpected add");
      },
      change: async (input: Extract<WaterOperation, { kind: "change" }>["input"]) => {
        sends++;
        sent.push({ id: input.clientMutationId, payload: input });
        if (sends === 1) throw Object.assign(new Error("ack lost"), { code: "NETWORK" });
        return {
          outcome: "replayed" as const,
          entry: { id: 44, revision: 10, quantityMl: 500, deleted: false },
        };
      },
      delete: async () => {
        throw new Error("unexpected delete");
      },
    };
    expect(resolveConflict(store, scope, old.id, () => "fresh")).toBe(true);
    const payload = store.list(scope)[0]!.op;
    expect((await drain(store, sender, scope)).stopped).toBe("network");
    expect(store.list(scope)[0]?.id).toBe("fresh");
    await drain(store, sender, scope);
    expect(sent).toEqual([
      { id: "fresh", payload: (payload as Extract<WaterOperation, { kind: "change" }>).input },
      { id: "fresh", payload: (payload as Extract<WaterOperation, { kind: "change" }>).input },
    ]);
    expect(store.list(scope)).toHaveLength(0);
  });

  test("drain snapshot cannot send a conflict replaced at its scope-check barrier", async () => {
    const db = makeDb();
    const store = createSqliteWaterStore(db);
    const old = conflictItem(store);
    let release!: () => void;
    let checks = 0;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sends = 0;
    const sender = {
      add: async () => {
        throw new Error("unexpected add");
      },
      change: async () => {
        sends++;
        throw new Error("must not send stale snapshot");
      },
      delete: async () => {
        throw new Error("unexpected delete");
      },
    };
    const draining = drain(store, sender, scope, async () => {
      checks++;
      if (checks === 1) await barrier;
      return true;
    });
    expect(resolveConflict(store, scope, old.id, () => "fresh")).toBe(true);
    release();
    await draining;
    expect(sends).toBe(0);
    expect(store.list(scope).map((item) => item.id)).toEqual(["fresh"]);
  });

  test("a failed atomic write never makes a replacement eligible for transport", async () => {
    const db = makeDb();
    const adapter = createSqliteWaterStore(db);
    const old = conflictItem(adapter);
    const store: WaterStore = { ...adapter, replaceConflict: () => false };
    expect(resolveConflict(store, scope, old.id, () => "fresh")).toBe(false);
    let sends = 0;
    const sender = {
      add: async () => {
        sends++;
        throw new Error("must not send");
      },
      change: async () => {
        sends++;
        throw new Error("must not send");
      },
      delete: async () => {
        sends++;
        throw new Error("must not send");
      },
    };
    await drain(store, sender, scope);
    expect(sends).toBe(0);
    expect(
      createSqliteWaterStore(db)
        .list(scope)
        .map((item) => item.id),
    ).toEqual(["old"]);
  });
});
