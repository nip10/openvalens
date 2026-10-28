import { Database } from "bun:sqlite";
import { describe, expect, mock, test } from "bun:test";

const sqlite = new Database(":memory:");
const expoDb = {
  execSync: (sql: string) => sqlite.exec(sql),
  getAllSync: <T,>(sql: string, ...params: unknown[]) =>
    sqlite.query(sql).all(...(params as never[])) as T[],
  getFirstSync: <T,>(sql: string, ...params: unknown[]) =>
    (sqlite.query(sql).get(...(params as never[])) ?? null) as T | null,
  runSync: (sql: string, ...params: unknown[]) => sqlite.query(sql).run(...(params as never[])),
};
mock.module("expo-sqlite", () => ({ openDatabaseSync: () => expoDb }));

const { clearOfflineData, getOfflineCleanupGeneration, getDb } = await import("./cache");
const { clearDiaryOutbox, sqliteOutboxStore } = await import("../nutrition/store");
const { drain, enqueue } = await import("../nutrition/outbox");

const receipt = (scope: string, mutation: string) =>
  sqliteOutboxStore.putEntryReceipt?.(scope, mutation, undefined, 123, 4);

describe("nutrition receipt cleanup", () => {
  test("per-account cleanup deletes only that scope and advances the epoch", () => {
    receipt("account-a:org", "a");
    receipt("account-b:org", "b");
    const before = getOfflineCleanupGeneration();
    clearDiaryOutbox("account-a:org");
    expect(getOfflineCleanupGeneration()).toBe(before + 1);
    expect(sqliteOutboxStore.getEntryReceipt?.("account-a:org", "a")).toBeNull();
    expect(sqliteOutboxStore.getEntryReceipt?.("account-b:org", "b")).toEqual({
      entryId: 123,
      revision: 4,
    });
  });

  test("global cleanup clears all receipts even when receipt table did not exist", () => {
    getDb().runSync("DROP TABLE nutrition_entry_receipt");
    receipt("account-a:org", "a");
    receipt("account-b:org", "b");
    const before = getOfflineCleanupGeneration();
    clearOfflineData();
    expect(getOfflineCleanupGeneration()).toBe(before + 1);
    expect(sqliteOutboxStore.getEntryReceipt?.("account-a:org", "a")).toBeNull();
    expect(sqliteOutboxStore.getEntryReceipt?.("account-b:org", "b")).toBeNull();
  });

  test("global cleanup is safe before receipt storage was initialized", () => {
    getDb().runSync("DROP TABLE nutrition_entry_receipt");
    expect(() => clearOfflineData()).not.toThrow();
    expect(sqliteOutboxStore.getEntryReceipt?.("account-a:org", "missing")).toBeNull();
  });

  test("late ACK after global wipe cannot recreate receipts for a reactivated scope", async () => {
    const scope = "same-account:org";
    enqueue(sqliteOutboxStore, scope, {
      op: {
        kind: "log",
        input: {
          clientMutationId: "pending-log",
          localDate: "2026-10-28",
          timeZone: "UTC",
          slot: "breakfast",
          food: { kind: "snapshot", snapshotId: 1 },
          amount: 50,
          unit: "g",
          method: "manual",
        },
      },
    });
    let resolveSend!: (value: unknown) => void;
    const send = new Promise<unknown>((resolve) => (resolveSend = resolve));
    const startedGeneration = getOfflineCleanupGeneration();
    const pending = drain(sqliteOutboxStore, { logEntry: () => send } as never, scope, {
      isCurrentScope: () =>
        scope === "same-account:org" && getOfflineCleanupGeneration() === startedGeneration,
    });
    await Promise.resolve();
    clearOfflineData();
    // The next session has the same scope; generation, not scope equality,
    // prevents the old session's acknowledgement from writing.
    resolveSend({ id: 42, revision: 1 });
    expect((await pending).stopped).toBe("scope_changed");
    expect(sqliteOutboxStore.getEntryReceipt?.(scope, "pending-log")).toBeNull();
    expect(sqliteOutboxStore.list(scope)).toEqual([]);
  });
});
