import { Database } from "bun:sqlite";
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { OFFLINE_SCHEMA_SQL } from "../offline/schema";

const sqlite = new Database(":memory:");
sqlite.exec(OFFLINE_SCHEMA_SQL);
const expoDb = {
  execSync: (sql: string) => sqlite.exec(sql),
  getAllSync: <T,>(sql: string, ...params: unknown[]) =>
    sqlite.query(sql).all(...(params as never[])) as T[],
  getFirstSync: <T,>(sql: string, ...params: unknown[]) =>
    (sqlite.query(sql).get(...(params as never[])) ?? null) as T | null,
  runSync: (sql: string, ...params: unknown[]) =>
    sqlite.query(sql).run(...(params as never[])),
};
let session: any = {
  user: { id: "member-a" },
  session: { id: "a1", activeOrganizationId: "org" },
};
mock.module("expo-sqlite", () => ({ openDatabaseSync: () => expoDb }));
mock.module("expo-network", () => ({
  getNetworkStateAsync: async () => ({ isConnected: false }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
mock.module("react-native", () => ({
  AppState: {
    currentState: "background",
    addEventListener: () => ({ remove() {} }),
  },
}));
mock.module("react", () => ({
  useEffect: (fn: () => void) => fn(),
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useSyncExternalStore: () => 0,
}));
mock.module("@tanstack/react-query", () => ({
  useQuery: () => ({}),
  useQueryClient: () => ({}),
}));
mock.module("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: session }) },
}));
mock.module("@/utils/orpc", () => ({
  client: {
    nutritionDiary: {
      logEntry: async () => undefined,
      updateEntry: async () => ({}),
      deleteEntry: async () => ({}),
      restoreEntry: async () => ({}),
      setDayStatus: async () => undefined,
      copyDay: async () => undefined,
    },
  },
  orpc: { nutritionDiary: { key: () => ["diary"] } },
  queryClient: {
    invalidateQueries: async () => undefined,
    removeQueries: () => undefined,
  },
}));
globalThis.setInterval = (() => 0) as typeof setInterval;

let useDiaryOutbox: typeof import("./sync").useDiaryOutbox;
let prepareOfflineSignOut: typeof import("../offline/sync").prepareOfflineSignOut;
let useOfflineScope: typeof import("../offline/sync").useOfflineScope;
let useOfflineWriteTicket: typeof import("../offline/sync").useOfflineWriteTicket;
let controller: typeof import("./save-intent").AddFoodSaveController;
let Controller: typeof import("./save-intent").AddFoodSaveController;
let clearDiaryOutbox: typeof import("./store").clearDiaryOutbox;
let readCache: typeof import("../offline/cache").readCache;
beforeAll(async () => {
  ({ useDiaryOutbox } = await import("./sync"));
  ({ prepareOfflineSignOut, useOfflineScope, useOfflineWriteTicket } =
    await import("../offline/sync"));
  ({ AddFoodSaveController: Controller } = await import("./save-intent"));
  ({ clearDiaryOutbox } = await import("./store"));
  ({ readCache } = await import("../offline/cache"));
  controller = new Controller();
});

const scope = "member-a:org";
const preview = {
  name: "Cached oats",
  source: "manual" as const,
  nutrients: null,
};
const input = (id: string) => ({
  op: {
    kind: "log" as const,
    input: {
      clientMutationId: id,
      localDate: "2026-10-21",
      timeZone: "UTC",
      slot: "breakfast" as const,
      food: { kind: "manual" as const, food: {} as never },
      amount: 100,
      unit: "g" as const,
      method: "quick_add" as const,
    },
  },
  preview,
});
function renderOutbox() {
  useOfflineScope();
  return useDiaryOutbox();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe("production Add Food intent/outbox integration", () => {
  test("valid ticket writes once; consumed, forged and obsolete authority write nothing", async () => {
    controller = new Controller();
    const outbox = renderOutbox();
    const ticket = outbox.beginWrite();
    expect(ticket).not.toBeNull();
    expect(outbox.enqueueForIntent(ticket, input("one"))).toBe(true);
    expect(outbox.enqueueForIntent(ticket, input("two"))).toBe(false);
    expect(outbox.enqueueForIntent({} as never, input("forged"))).toBe(false);
    expect(
      sqlite
        .query("select id from nutrition_outbox where scope = ?")
        .all(scope),
    ).toHaveLength(1);
    const fresh = outbox.beginWrite();
    expect(fresh).not.toBeNull();
    await prepareOfflineSignOut();
    expect(outbox.enqueueForIntent(fresh, input("obsolete"))).toBe(false);
    expect(sqlite.query("select id from nutrition_outbox").all()).toHaveLength(
      0,
    );
  });

  test("offline cached-session authority can enqueue and a new session receives fresh authority", () => {
    controller = new Controller();
    session = {
      user: { id: "member-a" },
      session: { id: "a2", activeOrganizationId: "org" },
    };
    const outbox = renderOutbox();
    const ticket = outbox.beginWrite();
    expect(outbox.online).toBe(false);
    expect(outbox.enqueueForIntent(ticket, input("offline"))).toBe(true);
    expect(
      sqlite
        .query("select id from nutrition_outbox where scope = ?")
        .all(scope),
    ).toHaveLength(1);
    clearDiaryOutbox(scope);
  });

  test("deferred create ACK after sign-out purge cannot queue preview or announce success", async () => {
    controller = new Controller();
    const outbox = renderOutbox();
    const ticket = outbox.beginWrite();
    const intent = controller.begin(ticket, "food", () => crypto.randomUUID())!;
    const ack = deferred<{ ref: unknown }>();
    let announcements = 0;
    const completion = ack.promise.then(() => {
      if (!controller.isCurrent(intent) || !ticket) return;
      if (outbox.enqueueForIntent(ticket, input(intent.diaryMutationId)))
        announcements++;
    });
    await prepareOfflineSignOut();
    ack.resolve({ ref: {} });
    await completion;
    expect(sqlite.query("select id from nutrition_outbox").all()).toHaveLength(
      0,
    );
    expect(announcements).toBe(0);
    expect(readCache(scope, "nutritionDiary.test")).toBeNull();
  });

  test("clearDeviceData revokes deferred ACK; cancellation invalidates pending intent", () => {
    controller = new Controller();
    session = {
      user: { id: "member-a" },
      session: { id: "a3", activeOrganizationId: "org" },
    };
    const outbox = renderOutbox();
    const ticket = outbox.beginWrite();
    const intent = controller.begin(ticket, "cancelled", () =>
      crypto.randomUUID(),
    )!;
    const ack = deferred<void>();
    let announcements = 0;
    const completion = ack.promise.then(() => {
      if (!controller.isCurrent(intent) || !ticket) return;
      if (outbox.enqueueForIntent(ticket, input(intent.diaryMutationId)))
        announcements++;
    });
    outbox.clearDeviceData();
    controller.invalidate(); // all form close paths call the same synchronous invalidation
    ack.resolve();
    expect(controller.isCurrent(intent)).toBe(false);
    return completion.then(() => {
      expect(announcements).toBe(0);
      expect(
        outbox.enqueueForIntent(ticket, input(intent.diaryMutationId)),
      ).toBe(false);
      expect(
        sqlite.query("select id from nutrition_outbox").all(),
      ).toHaveLength(0);
    });
  });

  test("one active submission wins; ambiguous retry IDs persist and changed/completed intents rotate IDs", () => {
    controller = new Controller();
    const ids = [
      "create-1",
      "diary-1",
      "create-2",
      "diary-2",
      "create-3",
      "diary-3",
    ];
    const next = () => ids.shift()!;
    const first = controller.begin(
      useDiaryOutbox().beginWrite(),
      "same",
      next,
    )!;
    expect(controller.begin(null, "same", next)).toBeNull();
    expect(controller.release(first)).toBe(true);
    const retry = controller.begin(
      useDiaryOutbox().beginWrite(),
      "same",
      next,
    )!;
    expect(retry.createMutationId).toBe(first.createMutationId);
    expect(retry.diaryMutationId).toBe(first.diaryMutationId);
    controller.release(retry);
    const changed = controller.begin(
      useDiaryOutbox().beginWrite(),
      "changed",
      next,
    )!;
    expect(changed.createMutationId).not.toBe(first.createMutationId);
    controller.finish(changed);
    const completed = controller.begin(
      useDiaryOutbox().beginWrite(),
      "same",
      next,
    )!;
    expect(completed.createMutationId).not.toBe(first.createMutationId);
    expect(controller.finish(first)).toBe(false); // stale finally cannot clear the new submission
  });

  test("owner A→B→A invalidates the originating ticket and delayed controller callback", async () => {
    controller = new Controller();
    session = {
      user: { id: "member-a" },
      session: { id: "a4", activeOrganizationId: "org" },
    };
    const outbox = renderOutbox();
    const ticket = outbox.beginWrite();
    const intent = controller.begin(ticket, "owner-change", () =>
      crypto.randomUUID(),
    )!;
    session = {
      user: { id: "member-b" },
      session: { id: "b1", activeOrganizationId: "org" },
    };
    renderOutbox();
    session = {
      user: { id: "member-a" },
      session: { id: "a5", activeOrganizationId: "org" },
    };
    renderOutbox();
    expect(controller.isCurrent(intent)).toBe(true); // intent generation remains but ticket rejects
    expect(outbox.enqueueForIntent(ticket, input(intent.diaryMutationId))).toBe(
      false,
    );
    controller.invalidate();
    expect(controller.isCurrent(intent)).toBe(false);
    expect(sqlite.query("select id from nutrition_outbox").all()).toHaveLength(
      0,
    );
  });
});
