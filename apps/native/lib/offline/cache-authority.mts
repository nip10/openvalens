import { Database } from "bun:sqlite";
import { beforeAll, describe, expect, mock, test } from "bun:test";

import { OFFLINE_SCHEMA_SQL } from "./schema";

const sqlite = new Database(":memory:");
sqlite.exec(OFFLINE_SCHEMA_SQL);
const expoDb = {
  execSync: (sql: string) => sqlite.exec(sql),
  getAllSync: <T,>(sql: string, ...params: unknown[]) =>
    sqlite.query(sql).all(...(params as never[])) as T[],
  getFirstSync: <T,>(sql: string, ...params: unknown[]) =>
    (sqlite.query(sql).get(...(params as never[])) ?? null) as T | null,
  runSync: (sql: string, ...params: unknown[]) => sqlite.query(sql).run(...(params as never[])),
};
let session: unknown;
let cacheFirstOptions: { queryFn: (context: never) => Promise<unknown> } | undefined;

mock.module("expo-sqlite", () => ({ openDatabaseSync: () => expoDb }));
mock.module("react", () => ({
  useEffect: (effect: () => void) => effect(),
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: (...args: never[]) => unknown) => callback,
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));
mock.module("@tanstack/react-query", () => ({
  useQuery: (options: typeof cacheFirstOptions) => {
    cacheFirstOptions = options;
    return {};
  },
}));
mock.module("expo-network", () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
}));
mock.module("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove() {} }),
  },
}));
mock.module("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: session }) },
}));
mock.module("@/utils/orpc", () => ({
  client: { healthRecord: { ingestMetricSample: async () => undefined } },
}));

let useCacheFirst: typeof import("./sync").useCacheFirst;
let prepareOfflineSignOut: typeof import("./sync").prepareOfflineSignOut;
let useOfflineScope: typeof import("./sync").useOfflineScope;
let useOfflineWriteTicket: typeof import("./sync").useOfflineWriteTicket;
let isOfflineWriteTicketCurrent: typeof import("./sync").isOfflineWriteTicketCurrent;
let readCache: typeof import("./cache").readCache;

beforeAll(async () => {
  ({
    useCacheFirst,
    prepareOfflineSignOut,
    useOfflineScope,
    useOfflineWriteTicket,
    isOfflineWriteTicketCurrent,
  } = await import("./sync"));
  ({ readCache } = await import("./cache"));
});

const makeSession = (userId: string, id: string) => ({
  user: { id: userId },
  session: { id, activeOrganizationId: "org-a" },
});

function query(scopeQueryKey: string, queryFn: () => Promise<unknown>) {
  useCacheFirst(scopeQueryKey, {
    queryKey: [scopeQueryKey],
    queryFn: queryFn as never,
  });
  if (!cacheFirstOptions) throw new Error("useQuery was not called");
  return cacheFirstOptions.queryFn(undefined as never);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe("cache write authority across sign-out", () => {
  test("write tickets are bound to the session and revoked across logout and A→B→A", async () => {
    session = makeSession("ticket-a", "ticket-session-a1");
    useOfflineScope();
    const oldTicket = useOfflineWriteTicket()();
    expect(oldTicket).not.toBeNull();
    expect(isOfflineWriteTicketCurrent(oldTicket!, "ticket-a:org-a")).toBe(true);
    await prepareOfflineSignOut();
    expect(isOfflineWriteTicketCurrent(oldTicket!, "ticket-a:org-a")).toBe(false);
    session = makeSession("ticket-a", "ticket-session-a2");
    useOfflineScope();
    const freshTicket = useOfflineWriteTicket()();
    expect(freshTicket).not.toBeNull();
    expect(isOfflineWriteTicketCurrent(freshTicket!, "ticket-a:org-a")).toBe(true);
    session = makeSession("ticket-b", "ticket-session-b1");
    useOfflineScope();
    session = makeSession("ticket-a", "ticket-session-a3");
    useOfflineScope();
    expect(isOfflineWriteTicketCurrent(oldTicket!, "ticket-a:org-a")).toBe(false);
    expect(isOfflineWriteTicketCurrent(freshTicket!, "ticket-a:org-a")).toBe(false);
    expect(isOfflineWriteTicketCurrent({} as never, "ticket-a:org-a")).toBe(false);
  });

  test("late reads cannot resurrect purged cache or cross A→B→A session changes", async () => {
    const scopeA = "member-a:org-a";
    session = makeSession("member-a", "session-a1");
    const response = deferred<{ value: string }>();
    const obsoleteA = query("water-day", () => response.promise);

    // The auth hook still reports A while signOut is pending; purge is real SQLite.
    await prepareOfflineSignOut();
    expect(readCache(scopeA, "water-day")).toBeNull();
    const duringLogout = query("water-day", async () => ({
      value: "pending-session",
    }));
    response.resolve({ value: "obsolete-a1" });
    await Promise.all([obsoleteA, duringLogout]);
    expect(readCache(scopeA, "water-day")).toBeNull();

    // A new authenticated session may legitimately cache, even for the same user.
    session = makeSession("member-a", "session-a2");
    await query("water-day", async () => ({ value: "fresh-a2" }));
    expect(readCache<{ value: string }>(scopeA, "water-day")?.data).toEqual({
      value: "fresh-a2",
    });

    // Old session work stays fenced through ownership changes, including A→B→A.
    const oldAResponse = deferred<{ value: string }>();
    session = makeSession("member-a", "session-a2");
    const oldA = query("water-day-old", () => oldAResponse.promise);
    session = makeSession("member-b", "session-b1");
    await query("water-day-b", async () => ({ value: "fresh-b" }));
    session = makeSession("member-a", "session-a3");
    await query("water-day-new", async () => ({ value: "fresh-a3" }));
    oldAResponse.resolve({ value: "obsolete-a2" });
    await oldA;

    // A stale hook still reporting an old session cannot adopt the newer
    // session's authority, even though both sessions share the same scope.
    session = makeSession("member-a", "session-a2");
    await query("stale-hook-a2", async () => ({ value: "obsolete-hook" }));

    expect(readCache(scopeA, "water-day-old")).toBeNull();
    expect(readCache(scopeA, "stale-hook-a2")).toBeNull();
    expect(readCache("member-b:org-a", "water-day-b")?.data).toEqual({
      value: "fresh-b",
    });
    expect(readCache(scopeA, "water-day-new")?.data).toEqual({
      value: "fresh-a3",
    });
  });
});
