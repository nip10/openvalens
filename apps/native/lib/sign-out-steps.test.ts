import { expect, test } from "bun:test";

import { ServerLeaveBlockedError } from "./server/server-leave-policy";
import { createSignOut } from "./sign-out-steps";

function recorder(failPush = false) {
  const calls: string[] = [];
  const step = (name: string) => async () => {
    calls.push(name);
  };
  const signOut = createSignOut({
    disablePush: async () => {
      calls.push("disablePush");
      if (failPush) throw new Error("offline");
    },
    resetHealthSync: step("resetHealthSync"),
    prepareOffline: step("prepareOffline"),
    signOut: step("signOut"),
    clearQueries: () => calls.push("clearQueries"),
  });
  return { calls, signOut };
}

const ORDER = ["disablePush", "resetHealthSync", "prepareOffline", "signOut", "clearQueries"];

test("signs out after switching off push, health sync and offline data", async () => {
  const { calls, signOut } = recorder();
  await signOut();
  expect(calls).toEqual(ORDER);
});

test("still signs out when push cannot be switched off", async () => {
  const { calls, signOut } = recorder(true);
  await signOut();
  expect(calls).toEqual(ORDER);
});

test("preserve policy reaches offline preparation after push and health preparation", async () => {
  const calls: string[] = [];
  const options = { pendingDataPolicy: "preserve" as const, hasInFlightWrites: () => false };
  const signOut = createSignOut({
    disablePush: async () => calls.push("disablePush"),
    resetHealthSync: async () => calls.push("resetHealthSync"),
    prepareOffline: async (received) => {
      calls.push("prepareOffline");
      expect(received).toBe(options);
    },
    signOut: async () => calls.push("signOut"),
    clearQueries: () => calls.push("clearQueries"),
  });
  await signOut(options);
  expect(calls).toEqual(ORDER);
});

test("typed data-preservation refusal stops before clearing auth and queries", async () => {
  const calls: string[] = [];
  const blocked = new ServerLeaveBlockedError({ kind: "pending", records: 1, drafts: 0 });
  const signOut = createSignOut({
    disablePush: async () => calls.push("disablePush"),
    resetHealthSync: async () => calls.push("resetHealthSync"),
    prepareOffline: async () => {
      calls.push("prepareOffline");
      throw blocked;
    },
    signOut: async () => calls.push("signOut"),
    clearQueries: () => calls.push("clearQueries"),
  });
  await expect(
    signOut({ pendingDataPolicy: "preserve", hasInFlightWrites: () => false }),
  ).rejects.toBe(blocked);
  expect(calls).toEqual(["disablePush", "resetHealthSync", "prepareOffline"]);
});
