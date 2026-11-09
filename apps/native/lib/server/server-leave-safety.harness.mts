import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

const sqlite = new Database(":memory:");
let onSafetyCountRead: (() => void) | null = null;
let failSafetyCountRead = false;
let sendMetric: () => Promise<unknown> = async () => undefined;
const session = {
  user: { id: "member-a" },
  session: { id: "session-a", activeOrganizationId: "org-a" },
};
const expoDb = {
  execSync: (query: string) => sqlite.exec(query),
  getAllSync: <T,>(query: string, ...params: unknown[]) =>
    sqlite.query(query).all(...(params as never[])) as T[],
  getFirstSync: <T,>(query: string, ...params: unknown[]) => {
    if (query.includes("AS records")) {
      if (failSafetyCountRead) throw new Error("injected SQLite read failure");
      const result = sqlite.query(query).get(...(params as never[])) as T | null;
      onSafetyCountRead?.();
      return result;
    }
    return (sqlite.query(query).get(...(params as never[])) ?? null) as T | null;
  },
  runSync: (query: string, ...params: unknown[]) => sqlite.query(query).run(...(params as never[])),
  withTransactionSync: (callback: () => void) =>
    sqlite.transaction(() => {
      callback();
    })(),
};

mock.module("expo-sqlite", () => ({ openDatabaseSync: () => expoDb }));
mock.module("@tanstack/react-query", () => ({ useQuery: () => ({}) }));
mock.module("expo-network", () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
  getNetworkStateAsync: async () => ({ isConnected: false }),
}));
mock.module("react", () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void) => effect(),
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));
mock.module("react-native", () => ({
  AppState: { currentState: "inactive", addEventListener: () => ({ remove: () => undefined }) },
}));
mock.module("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: session }) },
}));
mock.module("@/utils/orpc", () => ({
  client: { healthRecord: { ingestMetricSample: () => sendMetric() } },
}));

const {
  clearAllServerData,
  clearOfflineData,
  countQueuedWrites,
  countServerLeaveData,
  getDb,
  pushOutbox,
} = await import("../offline/cache");
const { drainOutbox, isMetricOutboxBusy, useOfflineScope } = await import("../offline/sync");
const { guardServerLeave, readServerLeaveSafety } = await import("./server-leave-safety");
const { ServerLeaveBlockedError, requireSafeServerLeave } = await import("./server-leave-policy");
const { createSwitchServer } = await import("./switch-server-steps");
const { createSignOut } = await import("../sign-out-steps");

const preserveOptions = {
  pendingDataPolicy: "preserve" as const,
  hasInFlightWrites: () => false,
};

function clearRows(): void {
  for (const table of [
    "outbox",
    "nutrition_outbox",
    "plain_water_outbox",
    "workout_outbox",
    "workout_drafts",
  ])
    sqlite.exec(`DELETE FROM "${table}"`);
}

function insertOutboxRow(table: string): void {
  if (table === "outbox") {
    sqlite.exec(
      "INSERT INTO outbox(dedupe_hash,payload,last_error,saved_at,scope) VALUES('malformed','{',NULL,1,NULL)",
    );
    return;
  }
  if (table === "workout_drafts") {
    sqlite.exec("INSERT INTO workout_drafts(scope,item) VALUES('other-account','not-json')");
    return;
  }
  sqlite
    .query(`INSERT INTO ${table}(scope,id,item) VALUES(?,?,?)`)
    .run("other-account", `malformed-${table}`, "not-json");
}

beforeAll(() => {
  getDb();
  useOfflineScope();
});

afterAll(() => sqlite.close());

describe("server-leave safety", () => {
  test("counts each outbox independently, including malformed and legacy unscoped rows", async () => {
    for (const table of ["outbox", "nutrition_outbox", "plain_water_outbox", "workout_outbox"]) {
      clearRows();
      insertOutboxRow(table);
      expect(await readServerLeaveSafety()).toEqual({ kind: "pending", records: 1, drafts: 0 });
    }
  });

  test("counts a workout draft even when all write queues are empty", async () => {
    clearRows();
    insertOutboxRow("workout_drafts");
    expect(await readServerLeaveSafety()).toEqual({ kind: "pending", records: 0, drafts: 1 });
  });

  test("unknown storage errors and missing tables never report empty", async () => {
    clearRows();
    failSafetyCountRead = true;
    expect(await readServerLeaveSafety()).toEqual({ kind: "unknown" });
    failSafetyCountRead = false;

    sqlite.exec("DROP TABLE workout_drafts");
    expect(await readServerLeaveSafety()).toEqual({ kind: "unknown" });
    sqlite.exec("CREATE TABLE workout_drafts (scope TEXT PRIMARY KEY, item TEXT NOT NULL)");
  });

  test("busy writes block even with zero durable rows", async () => {
    clearRows();
    expect(await readServerLeaveSafety({ hasInFlightWrites: () => true })).toEqual({
      kind: "busy",
    });
  });

  test("a write that starts during the safety read blocks the result", async () => {
    clearRows();
    let busy = false;
    onSafetyCountRead = () => {
      busy = true;
    };
    expect(await readServerLeaveSafety({ hasInFlightWrites: () => busy })).toEqual({
      kind: "busy",
    });
    onSafetyCountRead = null;
  });

  test("the metric drain remains busy after dequeue until send settles", async () => {
    clearRows();
    let finishSend!: (value: unknown) => void;
    sendMetric = () => new Promise((resolve) => (finishSend = resolve));
    pushOutbox({
      scope: "member-a:org-a",
      dedupeHash: "metric-1",
      payload: {} as never,
      savedAt: 1,
      lastError: null,
    });
    const draining = drainOutbox();
    expect(isMetricOutboxBusy()).toBe(true);
    expect(countServerLeaveData()).toEqual({ records: 0, drafts: 0 });
    expect(await readServerLeaveSafety()).toEqual({ kind: "busy" });
    finishSend(undefined);
    await draining;
    expect(isMetricOutboxBusy()).toBe(false);
    sendMetric = async () => undefined;
  });

  test("fresh final guard refuses rows added after an earlier safe precheck", async () => {
    clearRows();
    expect(await readServerLeaveSafety()).toEqual({ kind: "safe" });
    insertOutboxRow("plain_water_outbox");
    let leaveCalls = 0;
    expect(await guardServerLeave(async () => void leaveCalls++)).toEqual({
      kind: "pending",
      records: 1,
      drafts: 0,
    });
    expect(leaveCalls).toBe(0);
  });

  test("empty idle guard awaits leave exactly once", async () => {
    clearRows();
    let leaveCalls = 0;
    expect(await guardServerLeave(async () => void leaveCalls++)).toEqual({ kind: "safe" });
    expect(leaveCalls).toBe(1);
  });

  test("leave failure propagates without a second leave attempt", async () => {
    clearRows();
    let leaveCalls = 0;
    const failure = new Error("cleanup failed");
    await expect(
      guardServerLeave(async () => {
        leaveCalls++;
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(leaveCalls).toBe(1);
  });

  test("server-leave counts include every account and legacy metric without changing badge count", async () => {
    clearRows();
    insertOutboxRow("outbox");
    insertOutboxRow("nutrition_outbox");
    insertOutboxRow("plain_water_outbox");
    insertOutboxRow("workout_outbox");
    insertOutboxRow("workout_drafts");
    expect(countServerLeaveData()).toEqual({ records: 4, drafts: 1 });
    expect(countQueuedWrites()).toBe(3);
  });

  test("guard invokes leave synchronously before a queued microtask can add a row", async () => {
    clearRows();
    let microtaskRan = false;
    queueMicrotask(() => {
      microtaskRan = true;
      insertOutboxRow("plain_water_outbox");
    });
    let leaveCalls = 0;
    const result = guardServerLeave(async () => {
      expect(microtaskRan).toBe(false);
      leaveCalls++;
    });
    expect(leaveCalls).toBe(1);
    expect(await result).toEqual({ kind: "safe" });
    await Promise.resolve();
    expect(countServerLeaveData()).toEqual({ records: 1, drafts: 0 });
  });

  test("atomic sign-out cleanup refuses rows that arrive during awaited push preparation", async () => {
    clearRows();
    const calls: string[] = [];
    const signOut = createSignOut({
      invalidateDirectDevices: () => undefined,
      purgeDirectDevices: () => undefined,
      disablePush: async () => {
        calls.push("disablePush");
        await Promise.resolve();
        insertOutboxRow("nutrition_outbox");
      },
      resetHealthSync: async () => {
        calls.push("resetHealthSync");
      },
      prepareOffline: (options) => {
        calls.push("prepareOffline");
        if (options?.pendingDataPolicy === "preserve") clearOfflineData(options);
        else clearOfflineData();
        return Promise.resolve();
      },
      signOut: async () => {
        calls.push("authSignOut");
      },
      clearQueries: () => calls.push("clearQueries"),
    });
    const switchServer = createSwitchServer({
      invalidateDirectDevices: () => undefined,
      signOut,
      cancelPendingMagicLink: async () => calls.push("cancelMagicLink"),
      clearLocalData: (options) => {
        if (options?.pendingDataPolicy === "preserve") clearAllServerData(options);
        else clearAllServerData();
      },
      clearSession: async () => calls.push("clearSession"),
      clearQueries: () => calls.push("switchClearQueries"),
      setServer: async () => calls.push("setServer"),
      assertCanLeave: (options) => requireSafeServerLeave(readServerLeaveSafety(options)),
    });

    await expect(
      switchServer("https://next.example.invalid", preserveOptions),
    ).rejects.toBeInstanceOf(ServerLeaveBlockedError);
    expect(calls).toEqual(["disablePush", "resetHealthSync", "prepareOffline"]);
    expect(countServerLeaveData()).toEqual({ records: 1, drafts: 0 });
  });

  test("clear-all atomic boundary preserves a draft added before its later cleanup step", async () => {
    clearRows();
    const calls: string[] = [];
    const signOut = createSignOut({
      invalidateDirectDevices: () => undefined,
      purgeDirectDevices: () => undefined,
      disablePush: async () => calls.push("disablePush"),
      resetHealthSync: async () => calls.push("resetHealthSync"),
      prepareOffline: async (options) => {
        calls.push("prepareOffline");
        if (options?.pendingDataPolicy === "preserve") clearOfflineData(options);
        else clearOfflineData();
      },
      signOut: async () => calls.push("authSignOut"),
      clearQueries: () => calls.push("signOutClearQueries"),
    });
    const switchServer = createSwitchServer({
      invalidateDirectDevices: () => undefined,
      signOut,
      cancelPendingMagicLink: async () => {
        calls.push("cancelMagicLink");
        insertOutboxRow("workout_drafts");
      },
      clearLocalData: (options) => {
        calls.push("clearLocalData");
        if (options?.pendingDataPolicy === "preserve") clearAllServerData(options);
        else clearAllServerData();
      },
      clearSession: async () => calls.push("clearSession"),
      clearQueries: () => calls.push("switchClearQueries"),
      setServer: async () => calls.push("setServer"),
      assertCanLeave: (options) => requireSafeServerLeave(readServerLeaveSafety(options)),
    });

    await expect(
      switchServer("https://next.example.invalid", preserveOptions),
    ).rejects.toBeInstanceOf(ServerLeaveBlockedError);
    expect(calls).toEqual([
      "disablePush",
      "resetHealthSync",
      "prepareOffline",
      "authSignOut",
      "signOutClearQueries",
      "cancelMagicLink",
      "clearLocalData",
    ]);
    expect(countServerLeaveData()).toEqual({ records: 0, drafts: 1 });
  });

  test("final post-session safety read prevents origin change when a new row appears", async () => {
    clearRows();
    const calls: string[] = [];
    const switchServer = createSwitchServer({
      invalidateDirectDevices: () => undefined,
      signOut: async () => calls.push("signOut"),
      cancelPendingMagicLink: async () => calls.push("cancelMagicLink"),
      clearLocalData: (options) => {
        calls.push("clearLocalData");
        if (options?.pendingDataPolicy === "preserve") clearAllServerData(options);
        else clearAllServerData();
      },
      clearSession: async () => {
        calls.push("clearSession");
        await Promise.resolve();
        insertOutboxRow("outbox");
      },
      clearQueries: () => calls.push("clearQueries"),
      setServer: async () => calls.push("setServer"),
      assertCanLeave: (options) => requireSafeServerLeave(readServerLeaveSafety(options)),
    });

    await expect(
      switchServer("https://next.example.invalid", preserveOptions),
    ).rejects.toBeInstanceOf(ServerLeaveBlockedError);
    expect(calls).toEqual(["signOut", "cancelMagicLink", "clearLocalData", "clearSession"]);
    expect(countServerLeaveData()).toEqual({ records: 1, drafts: 0 });
  });

  test("atomic offline clear refuses pending rows without deleting cache or queue data", async () => {
    clearRows();
    sqlite.exec("INSERT INTO query_cache(key,data,saved_at) VALUES('kept-offline-clear','{}',1)");
    insertOutboxRow("outbox");
    expect(() => clearOfflineData(preserveOptions)).toThrow(ServerLeaveBlockedError);
    expect(countServerLeaveData()).toEqual({ records: 1, drafts: 0 });
    expect(sqlite.query("SELECT key FROM query_cache").all()).toEqual([
      { key: "kept-offline-clear" },
    ]);
  });

  test("busy state discovered after the transactional count aborts every delete", async () => {
    clearRows();
    sqlite.exec(
      "INSERT INTO query_cache(key,data,saved_at) VALUES('kept-busy-after-count','{}',1)",
    );
    const cacheBefore = sqlite
      .query("SELECT key, data, saved_at FROM query_cache ORDER BY key")
      .all();
    let busy = false;
    onSafetyCountRead = () => {
      busy = true;
    };
    const options = { pendingDataPolicy: "preserve" as const, hasInFlightWrites: () => busy };
    expect(() => clearAllServerData(options)).toThrow(ServerLeaveBlockedError);
    onSafetyCountRead = null;
    expect(countServerLeaveData()).toEqual({ records: 0, drafts: 0 });
    expect(sqlite.query("SELECT key, data, saved_at FROM query_cache ORDER BY key").all()).toEqual(
      cacheBefore,
    );
  });

  test("preserve refusal from sign-out is not swallowed by the best-effort switch catch", async () => {
    clearRows();
    const calls: string[] = [];
    const switchServer = createSwitchServer({
      invalidateDirectDevices: () => undefined,
      signOut: async () => {
        calls.push("signOut");
        throw new ServerLeaveBlockedError({ kind: "pending", records: 1, drafts: 0 });
      },
      cancelPendingMagicLink: async () => calls.push("cancelMagicLink"),
      clearLocalData: () => calls.push("clearLocalData"),
      clearSession: async () => calls.push("clearSession"),
      clearQueries: () => calls.push("clearQueries"),
      setServer: async () => calls.push("setServer"),
      assertCanLeave: () => calls.push("assertCanLeave"),
    });
    await expect(
      switchServer("https://next.example.invalid", preserveOptions),
    ).rejects.toBeInstanceOf(ServerLeaveBlockedError);
    expect(calls).toEqual(["signOut"]);
  });
});
