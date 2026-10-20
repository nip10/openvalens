import { describe, expect, test } from "bun:test";
import { createSqliteWaterStore, type WaterSqlite } from "./store-adapter";
import { drain, enqueue, type WaterItem, type WaterOperation } from "./outbox";

class FakeSqlite implements WaterSqlite {
  rows: { seq: number; scope: string; id: string; item: string }[] = [];
  failWrites = false;
  getAllSync<T>(_sql: string, scope: unknown, idPrefix: unknown): T[] {
    return this.rows
      .filter((row) => row.scope === scope && row.id.startsWith(String(idPrefix).replace("%", "")))
      .map(({ seq, scope, id, item }) => ({ seq, scope, id, item }) as T);
  }
  getFirstSync<T>(_sql: string): T | null {
    return { next: Math.max(0, ...this.rows.map((row) => row.seq)) + 1 } as T;
  }
  runSync(sql: string, ...args: unknown[]): { changes: number } {
    if (this.failWrites) throw new Error("synthetic storage write failure");
    if (sql.startsWith("UPDATE")) {
      const [item, scope, id] = args as [string, string, string];
      const row = this.rows.find((candidate) => candidate.scope === scope && candidate.id === id);
      if (row) row.item = item;
      return { changes: row ? 1 : 0 };
    }
    if (sql.startsWith("INSERT")) {
      const [scope, id, item] = args as [string, string, string];
      this.rows.push({ seq: this.rows.length + 1, scope, id, item });
      return { changes: 1 };
    }
    const [scope, id] = args as [string, string];
    this.rows = this.rows.filter((row) => row.scope !== scope || row.id !== id);
    return { changes: 1 };
  }
}

const sample = (scope: string): WaterItem => ({
  id: "mut-1",
  scope,
  seq: 1,
  op: {
    kind: "add",
    input: {
      quantity: 355,
      unit: "ml",
      observedAt: "2026-11-01T01:30:00-04:00",
      timeZone: "America/New_York",
      clientMutationId: "mut-1",
    },
  },
  status: "queued",
  attempts: 0,
  lastErrorCode: null,
  conflict: null,
  createdAt: 5,
});

const operation = (clientMutationId: string): WaterOperation => ({
  kind: "add",
  input: {
    quantity: 355,
    unit: "ml",
    observedAt: "2026-11-01T01:30:00-04:00",
    timeZone: "America/New_York",
    clientMutationId,
  },
});
const sender = (send: () => Promise<void>) => ({
  add: async () => {
    await send();
    return {
      outcome: "applied" as const,
      entry: { id: 1, revision: 1, quantityMl: 355, deleted: false },
    };
  },
  change: async () => {
    throw new Error("unexpected change");
  },
  delete: async () => {
    throw new Error("unexpected delete");
  },
});

describe("plain-water SQLite adapter", () => {
  test("isolates persisted rows by user and organization scope", () => {
    const db = new FakeSqlite();
    const store = createSqliteWaterStore(db);
    store.put(sample("user-a:org-a"));
    store.put(sample("user-b:org-a"));
    expect(store.list("user-a:org-a")).toHaveLength(1);
    expect(store.list("user-b:org-a")[0]?.op).toEqual(sample("user-b:org-a").op);
    expect(store.list("user-a:org-b")).toHaveLength(0);
    const stored = db.rows.find((row) => row.scope === "user-a:org-a")!;
    stored.item = JSON.stringify({
      ...JSON.parse(stored.item),
      id: "forged",
      scope: "user-b:org-a",
    });
    expect(store.list("user-a:org-a")[0]?.scope).toBe("user-a:org-a");
    expect(store.list("user-a:org-a")[0]?.id).toBe("mut-1");
  });
  test("storage failure is thrown and never reported as a persisted item", () => {
    const db = new FakeSqlite();
    const store = createSqliteWaterStore(db);
    db.failWrites = true;
    expect(() => store.put(sample("user-a:org-a"))).toThrow("synthetic storage write failure");
    db.failWrites = false;
    expect(store.list("user-a:org-a")).toHaveLength(0);
  });
  test("held adapter transport serializes same-scope drains and skips another scope", async () => {
    const db = new FakeSqlite();
    const store = createSqliteWaterStore(db);
    enqueue(store, "user-a:org-a", operation("held"), 1);
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const transport = sender(async () => {
      calls++;
      await gate;
    });
    const first = drain(store, transport, "user-a:org-a");
    expect((await drain(store, transport, "user-a:org-a")).stopped).toBe("already_draining");
    expect((await drain(store, transport, "user-b:org-a")).sent).toBe(0);
    expect(store.list("user-b:org-a")).toHaveLength(0);
    release();
    await first;
    expect(calls).toBe(1);
    expect(store.list("user-a:org-a")).toHaveLength(0);
  });
  test("adapter-scoped drain stops before transport when the scope changes", async () => {
    const db = new FakeSqlite();
    const base = createSqliteWaterStore(db);
    let current = "user-a:org-a";
    const store = {
      ...base,
      put(item: WaterItem) {
        base.put(item);
        if (item.status === "syncing") current = "user-b:org-a";
      },
    };
    enqueue(store, "user-a:org-a", operation("switch"), 1);
    let calls = 0;
    const result = await drain(
      store,
      sender(async () => {
        calls++;
      }),
      "user-a:org-a",
      () => current === "user-a:org-a",
    );
    expect(result.stopped).toBe("scope_changed");
    expect(calls).toBe(0);
    const [queued] = store.list("user-a:org-a");
    expect(queued).toMatchObject({ id: "switch", seq: 1, status: "queued" });
    expect(queued?.op.input).toMatchObject({
      observedAt: "2026-11-01T01:30:00-04:00",
      timeZone: "America/New_York",
    });
    expect(store.list("user-b:org-a")).toHaveLength(0);
    expect(db.rows.every((row) => row.scope === "user-a:org-a")).toBe(true);
  });
});
