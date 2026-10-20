import { describe, expect, test } from "bun:test";
import {
  discard,
  drain,
  enqueue,
  retry,
  type WaterItem,
  type WaterOperation,
  type WaterStore,
} from "./outbox";

function memory(): WaterStore {
  const rows = new Map<string, WaterItem>();
  let seq = 0;
  return {
    list: (scope) =>
      [...rows.values()].filter((x) => x.scope === scope).sort((a, b) => a.seq - b.seq),
    put: (x) => {
      rows.set(`${x.scope}:${x.id}`, x);
    },
    remove: (scope, id) => {
      rows.delete(`${scope}:${id}`);
    },
    nextSeq: () => ++seq,
  };
}
const op: WaterOperation = {
  kind: "add",
  input: {
    quantity: 300,
    unit: "ml",
    observedAt: "2026-03-29T01:30:00+01:00",
    timeZone: "Europe/Lisbon",
    clientMutationId: "water-op-1",
  },
};
describe("plain-water outbox", () => {
  test("keeps IDs and payload stable across a lost acknowledgement; scopes independently", async () => {
    const store = memory();
    const a = enqueue(store, "user-a:org-a", op, 1);
    expect(enqueue(store, "user-a:org-a", op, 20).createdAt).toBe(1);
    const reordered: WaterOperation = {
      input: {
        timeZone: op.input.timeZone,
        unit: op.input.unit,
        quantity: op.input.quantity,
        observedAt: op.input.observedAt,
        clientMutationId: op.input.clientMutationId,
      },
      kind: "add",
    };
    expect(enqueue(store, "user-a:org-a", reordered, 30).createdAt).toBe(1);
    expect(() =>
      enqueue(store, "user-a:org-a", { ...op, input: { ...op.input, quantity: 301 } }),
    ).toThrow("Mutation ID already queued");
    enqueue(store, "user-b:org-a", { ...op, input: { ...op.input, clientMutationId: "other" } });
    let sends = 0;
    const sender = {
      add: async (input: typeof op.input) => {
        sends++;
        expect(input).toEqual(op.input);
        if (sends === 1) throw new Error("lost ack");
        return {
          outcome: "replayed" as const,
          entry: { id: 1, revision: 1, quantityMl: 300, deleted: false },
        };
      },
      change: async () => {
        throw new Error();
      },
      delete: async () => {
        throw new Error();
      },
    };
    await drain(store, sender, a.scope);
    expect(store.list(a.scope)[0]?.id).toBe(a.id);
    await drain(store, sender, a.scope);
    expect(sends).toBe(2);
    expect(store.list(a.scope)).toHaveLength(0);
    expect(store.list("user-b:org-a")).toHaveLength(1);
  });
  test("keeps conflicts for explicit resolution and stops when scope changes", async () => {
    const store = memory();
    const item = enqueue(store, "a:o", op);
    await drain(
      store,
      {
        add: async () => ({
          outcome: "conflict",
          entry: { id: 2, revision: 2, quantityMl: 300, deleted: false },
        }),
        change: async () => {
          throw new Error();
        },
        delete: async () => {
          throw new Error();
        },
      },
      "a:o",
    );
    expect(store.list("a:o")[0]).toMatchObject({
      status: "needs_attention",
      conflict: { revision: 2 },
    });
    retry(store, "a:o", item.id);
    expect(store.list("a:o")[0]?.status).toBe("needs_attention");
    const stopped = await drain(
      store,
      {
        add: async () => {
          throw new Error();
        },
        change: async () => {
          throw new Error();
        },
        delete: async () => {
          throw new Error();
        },
      },
      "a:o",
      () => false,
    );
    expect(stopped.stopped).toBe("scope_changed");
    discard(store, "a:o", item.id);
    expect(store.list("a:o")).toHaveLength(0);
  });

  test("checks scope again immediately before transport and serializes drains for a scope", async () => {
    let current = true;
    const base = memory();
    const store: WaterStore = {
      ...base,
      put(item) {
        base.put(item);
        if (item.status === "syncing") current = false;
      },
    };
    enqueue(store, "a:o", op);
    let calls = 0;
    const sender = {
      add: async () => {
        calls++;
        return {
          outcome: "applied" as const,
          entry: { id: 1, revision: 1, quantityMl: 300, deleted: false },
        };
      },
      change: async () => {
        throw new Error();
      },
      delete: async () => {
        throw new Error();
      },
    };
    const stopped = await drain(store, sender, "a:o", () => current);
    expect(stopped.stopped).toBe("scope_changed");
    expect(calls).toBe(0);
    expect(store.list("a:o")[0]?.status).toBe("queued");
    expect(store.list("b:o")).toHaveLength(0);
  });

  test("concurrent drains of the same scope cannot send a queued item twice", async () => {
    const store = memory();
    enqueue(store, "a:o", op);
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const sender = {
      add: async () => {
        calls++;
        await gate;
        return {
          outcome: "applied" as const,
          entry: { id: 1, revision: 1, quantityMl: 300, deleted: false },
        };
      },
      change: async () => {
        throw new Error();
      },
      delete: async () => {
        throw new Error();
      },
    };
    const first = drain(store, sender, "a:o");
    expect((await drain(store, sender, "a:o")).stopped).toBe("already_draining");
    release();
    await first;
    expect(calls).toBe(1);
    expect(store.list("a:o")).toHaveLength(0);
  });
});
