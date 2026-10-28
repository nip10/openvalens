import { describe, expect, mock, test } from "bun:test";
mock.module("expo-crypto", () => ({ randomUUID: () => "33333333-3333-4333-8333-333333333333" }));
import { createWorkoutSyncEngine } from "./engine";
import type { WorkoutQueueItem } from "./sync";

const idA = "11111111-1111-4111-8111-111111111111";
const payload = (id: string) => ({
  clientMutationId: id,
  date: "2026-02-03",
  type: "weights" as const,
  notes: null,
  intensity: null,
  effortRating: null,
  exercises: [],
});
function item(id: string, scope = "user:org-a"): WorkoutQueueItem {
  return {
    id,
    scope,
    payload: payload(id),
    finishedAt: "2026-02-03T04:10:00Z",
    state: "pending",
    attempts: 0,
    error: null,
    createdAt: 1,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("workout sync engine", () => {
  test("credential race sends immutable expectedScope and retains on server scope mismatch", async () => {
    const queue = [item(idA)],
      credential = deferred<string>();
    const engine = createWorkoutSyncEngine({
      store: {
        list: () => queue.slice(),
        update: (next) => {
          queue[0] = next;
        },
        remove: (_scope, id) => {
          const i = queue.findIndex((x) => x.id === id);
          if (i >= 0) queue.splice(i, 1);
        },
      },
      isCurrentScope: () => true,
      send: async (request) => {
        expect(request.expectedScope).toBe("user:org-a");
        const cookieScope = await credential.promise;
        if (cookieScope !== request.expectedScope)
          throw Object.assign(new Error("scope mismatch"), { code: "TENANT_VIOLATION" });
      },
    });
    const pending = engine.sync("user:org-a");
    credential.resolve("user:org-b");
    await pending;
    expect(queue).toHaveLength(1);
    expect(queue[0]?.state).toBe("blocked");
    expect(queue[0]?.id).toBe(idA);
  });
  test("scope switch before send does not transport old account row", async () => {
    let current = true,
      calls = 0;
    const queue = [item(idA)];
    const engine = createWorkoutSyncEngine({
      store: {
        list: () => queue,
        update: (next) => {
          queue[0] = next;
        },
        remove: () => {
          queue.length = 0;
        },
      },
      isCurrentScope: () => current,
      send: async () => {
        calls++;
      },
    });
    current = false;
    await engine.sync("user:org-a");
    expect(calls).toBe(0);
    expect(queue).toHaveLength(1);
  });
  test("same-user organization switch during the final preflight check blocks send", async () => {
    let checks = 0,
      calls = 0;
    const queue = [item(idA, "user-1:org-a")];
    const engine = createWorkoutSyncEngine({
      store: {
        list: () => queue,
        update: (next) => {
          queue[0] = next;
        },
        remove: () => {
          queue.length = 0;
        },
      },
      isCurrentScope: async () => ++checks === 1,
      send: async () => {
        calls++;
      },
    });
    await engine.sync("user-1:org-a");
    expect(checks).toBe(2);
    expect(calls).toBe(0);
    expect(queue).toHaveLength(1);
  });
  test("sync request during a drain reruns and sends rows added during the first request", async () => {
    const queue = [item(idA)],
      entered = deferred<void>(),
      release = deferred<void>();
    let sends = 0;
    const engine = createWorkoutSyncEngine({
      store: {
        list: () => queue.slice(),
        update: (next) => {
          const i = queue.findIndex((x) => x.id === next.id);
          if (i >= 0) queue[i] = next;
        },
        remove: (_scope, id) => {
          const i = queue.findIndex((x) => x.id === id);
          if (i >= 0) queue.splice(i, 1);
        },
      },
      isCurrentScope: () => true,
      send: async () => {
        sends++;
        if (sends === 1) {
          entered.resolve();
          await release.promise;
        }
      },
    });
    const first = engine.sync("user:org-a");
    await entered.promise;
    queue.push(item("22222222-2222-4222-8222-222222222222"));
    const rerun = engine.sync("user:org-a");
    release.resolve();
    await Promise.all([first, rerun]);
    expect(sends).toBe(2);
    expect(queue).toHaveLength(0);
  });
  test("blocked mutation holds later mutations for its target but not independent workouts", async () => {
    const base = item(idA),
      idB = "22222222-2222-4222-8222-222222222222",
      idC = "33333333-3333-4333-8333-333333333333";
    const queue: WorkoutQueueItem[] = [
      {
        ...base,
        operation: "update",
        targetId: 8,
        payload: {
          clientMutationId: idA,
          id: 8,
          expectedVersion: 2,
          workout: {
            date: "2026-02-03",
            type: "weights",
            notes: null,
            intensity: null,
            effortRating: null,
            exercises: [],
          },
        },
      },
      {
        ...item(idB),
        operation: "delete",
        targetId: 8,
        payload: { clientMutationId: idB, id: 8, expectedVersion: 3 },
      },
      {
        ...item(idC),
        operation: "delete",
        targetId: 9,
        payload: { clientMutationId: idC, id: 9, expectedVersion: 1 },
      },
    ];
    const sent: string[] = [];
    const engine = createWorkoutSyncEngine({
      store: {
        list: () => queue.slice(),
        update: (next) => {
          const i = queue.findIndex((x) => x.id === next.id);
          if (i >= 0) queue[i] = next;
        },
        remove: (_scope, id) => {
          const i = queue.findIndex((x) => x.id === id);
          if (i >= 0) queue.splice(i, 1);
        },
      },
      isCurrentScope: () => true,
      send: async (_request, item) => {
        sent.push(item.id);
        if (item.id === idA) throw Object.assign(new Error(), { code: "CONFLICT" });
        return { id: 9, version: 2 };
      },
    });
    await engine.sync("user:org-a");
    expect(sent).toEqual([idA, idC]);
    expect(queue.find((x) => x.id === idA)?.state).toBe("blocked");
    expect(queue.find((x) => x.id === idB)).toBeDefined();
  });
});
