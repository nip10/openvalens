import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import {
  createPlainWaterController,
  plainWaterDayKey,
  plainWaterPreferencesKey,
  type PlainWaterIntent,
  type PlainWaterOperation,
  type PlainWaterResult,
} from "./plain-water-controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fakeServer() {
  const receipts = new Map<string, PlainWaterResult>();
  const stored = new Map<string, PlainWaterOperation>();
  const calls: PlainWaterOperation[] = [];
  let loseFirstAck = true;
  const send = async (operation: PlainWaterOperation): Promise<PlainWaterResult> => {
    calls.push(operation);
    const id = operation.payload.clientMutationId;
    const existing = receipts.get(id);
    if (existing) return { outcome: "replayed" };
    stored.set(id, operation);
    const receipt: PlainWaterResult = { outcome: "applied" };
    receipts.set(id, receipt);
    if (loseFirstAck) {
      loseFirstAck = false;
      throw new Error("ack lost");
    }
    return receipt;
  };
  return { send, calls, stored };
}

const owner = { scope: "orgA:userA", date: "2026-07-01", timeZone: "America/Los_Angeles" };
const add = (): PlainWaterIntent => ({
  kind: "add",
  payload: {
    quantity: 250,
    unit: "ml",
    observedAt: "2026-07-01T10:00:00Z",
    timeZone: owner.timeZone,
  },
});

describe("plain water controller", () => {
  test("retries lost add acknowledgement with the same ID and exact payload", async () => {
    const server = fakeServer();
    let ids = 0;
    const controller = createPlainWaterController({
      owner,
      send: server.send,
      createId: () => `id-${++ids}`,
    });
    const uncertain = await controller.submit(add());
    expect(uncertain.status).toBe("uncertain");
    expect(server.stored.size).toBe(1);
    const operation = server.calls[0]!;
    await controller.submit({
      kind: "add",
      payload: {
        quantity: 900,
        unit: "ml",
        observedAt: "2026-07-01T10:00:00Z",
        timeZone: owner.timeZone,
      },
    });
    expect(server.calls).toHaveLength(1);
    const complete = await controller.retry();
    expect(complete.status).toBe("complete");
    expect(server.calls).toHaveLength(2);
    expect(server.calls[1]).toBe(operation);
    expect(server.calls[1]).toEqual(operation);
    expect(server.stored.size).toBe(1);
    expect(ids).toBe(1);
  });

  test("change and delete replay the same receipt and explicit conflict rebase gets a fresh ID/revision", async () => {
    let id = 0;
    let conflict = true;
    const calls: PlainWaterOperation[] = [];
    const receipts = new Map<string, PlainWaterResult>();
    const send = async (op: PlainWaterOperation): Promise<PlainWaterResult> => {
      calls.push(op);
      const prior = receipts.get(op.payload.clientMutationId);
      if (prior) return { outcome: "replayed" };
      if (conflict) {
        conflict = false;
        return { outcome: "conflict", server: { revision: 8, quantityMl: 300, deleted: false } };
      }
      const result: PlainWaterResult = { outcome: "applied" };
      receipts.set(op.payload.clientMutationId, result);
      return result;
    };
    const controller = createPlainWaterController({ owner, send, createId: () => `new-${++id}` });
    const change: PlainWaterIntent = {
      kind: "change",
      payload: { id: 4, expectedRevision: 3, quantity: 400, unit: "ml" },
    };
    expect((await controller.submit(change)).status).toBe("conflict");
    expect((await controller.submit(change)).status).toBe("conflict");
    expect(calls).toHaveLength(1);
    expect((await controller.rebase()).status).toBe("complete");
    expect(calls[1]?.payload.clientMutationId).toBe("new-2");
    if (calls[1]?.kind === "change") expect(calls[1].payload.expectedRevision).toBe(8);

    for (const operation of [
      {
        kind: "change",
        payload: { id: 4, expectedRevision: 3, observedAt: "2026-07-01T11:00:00Z" },
      },
      { kind: "delete", payload: { id: 4, expectedRevision: 3 } },
    ] as PlainWaterIntent[]) {
      const server = fakeServer();
      const c = createPlainWaterController({
        owner,
        send: server.send,
        createId: () => `op-${operation.kind}`,
      });
      await c.submit(operation);
      const sent = server.calls[0];
      await c.retry();
      expect(server.calls[1]).toBe(sent);
      expect(server.stored.size).toBe(1);
    }
  });

  test("keepOther releases only a confirmed conflict and permits a fresh intent", async () => {
    let id = 0;
    const calls: PlainWaterOperation[] = [];
    const controller = createPlainWaterController({
      owner,
      createId: () => `fresh-${++id}`,
      send: async (operation) => {
        calls.push(operation);
        return calls.length === 1
          ? { outcome: "conflict", server: { revision: 9, quantityMl: 250, deleted: false } }
          : { outcome: "applied" };
      },
    });
    expect((await controller.submit(add())).status).toBe("conflict");
    expect(controller.keepOther()).toBe(true);
    expect(controller.state.status).toBe("idle");
    expect((await controller.submit(add())).status).toBe("complete");
    expect(calls[0]?.payload.clientMutationId).toBe("fresh-1");
    expect(calls[1]?.payload.clientMutationId).toBe("fresh-2");
  });

  test("keepOther refuses busy or uncertain writes without releasing their retry", async () => {
    const calls: PlainWaterOperation[] = [];
    const replies: ReturnType<typeof deferred<PlainWaterResult>>[] = [];
    const controller = createPlainWaterController({
      owner,
      createId: () => "stable-id",
      send: (operation) => {
        calls.push(operation);
        const reply = deferred<PlainWaterResult>();
        replies.push(reply);
        return reply.promise;
      },
    });
    const first = controller.submit(add());
    expect(controller.keepOther()).toBe(false);
    const sent = calls[0];
    replies[0]!.reject(new Error("ack lost"));
    expect((await first).status).toBe("uncertain");
    expect(controller.keepOther()).toBe(false);
    const retry = controller.retry();
    expect(controller.keepOther()).toBe(false);
    expect(calls[1]).toBe(sent);
    replies[1]!.resolve({ outcome: "replayed" });
    expect((await retry).status).toBe("complete");
  });

  test("missing scope does not send; disposed scope/day/zone generations suppress late callbacks", async () => {
    let sends = 0;
    const missing = createPlainWaterController({
      owner: { ...owner, scope: null },
      createId: () => "x",
      send: async () => {
        sends++;
        return { outcome: "applied" };
      },
    });
    await missing.submit(add());
    expect(sends).toBe(0);
    const notices: string[] = [];
    for (const [index, nextOwner] of [
      { ...owner, scope: "orgB:userA" },
      { ...owner, date: "2026-07-02" },
      { ...owner, timeZone: "UTC" },
    ].entries()) {
      const reply = deferred<PlainWaterResult>();
      const c = createPlainWaterController({
        owner,
        createId: () => "old",
        send: () => reply.promise,
        onState: (s) => notices.push(s.status),
      });
      const pending = c.submit(add());
      c.dispose();
      const replacement = createPlainWaterController({
        owner: nextOwner,
        createId: () => "new",
        send: async () => ({ outcome: "applied" }),
      });
      reply.resolve({ outcome: "applied" });
      await pending;
      expect(notices).toEqual(Array(index + 1).fill("busy"));
      expect(replacement.state.status).toBe("idle");
    }
  });

  test("scope-partitioned QueryClient keys isolate populated caches from delayed old reads", async () => {
    const cache = new QueryClient();
    const a = { ...owner, scope: "scopeA" };
    const b = { ...owner, scope: "scopeB" };
    cache.setQueryData<string>(plainWaterDayKey(a), "A-day");
    cache.setQueryData<string>(plainWaterDayKey(b), "B-day");
    cache.setQueryData<string>(plainWaterPreferencesKey(a), "A-preferences");
    cache.setQueryData<string>(plainWaterPreferencesKey(b), "B-preferences");
    await cache.invalidateQueries({ queryKey: plainWaterDayKey(a) });
    const oldRead = deferred<string>();
    const request = cache.fetchQuery({
      queryKey: plainWaterDayKey(a),
      queryFn: () => oldRead.promise,
    });
    await Promise.resolve();
    oldRead.resolve("late-A");
    await request;
    expect(cache.getQueryData<string>(plainWaterDayKey(a))).toBe("late-A");
    expect(cache.getQueryData<string>(plainWaterDayKey(b))).toBe("B-day");
    expect(cache.getQueryData<string>(plainWaterPreferencesKey(a))).toBe("A-preferences");
    expect(cache.getQueryData<string>(plainWaterPreferencesKey(b))).toBe("B-preferences");
  });
});
