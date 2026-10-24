import { expect, test } from "bun:test";

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
