import { describe, expect, test } from "bun:test";

import { createSwitchServer, type SwitchServerSteps } from "./switch-server-steps";

type Failure = "signOut" | "cancelPendingMagicLink" | "clearLocalData" | "clearSession";

function recorder(fail: Failure[] = []) {
  const calls: string[] = [];
  const step = (name: Failure) => async () => {
    calls.push(name);
    if (fail.includes(name)) throw new Error(`${name} failed`);
  };
  const steps: SwitchServerSteps = {
    signOut: step("signOut"),
    cancelPendingMagicLink: step("cancelPendingMagicLink"),
    clearLocalData: () => {
      calls.push("clearLocalData");
      if (fail.includes("clearLocalData")) throw new Error("clearLocalData failed");
    },
    clearSession: step("clearSession"),
    clearQueries: () => calls.push("clearQueries"),
    setServer: async (url) => {
      calls.push(`setServer:${url}`);
    },
  };
  return { calls, switchServer: createSwitchServer(steps) };
}

const CLEANUP = [
  "signOut",
  "cancelPendingMagicLink",
  "clearLocalData",
  "clearSession",
  "clearQueries",
];

describe("switching server (#295)", () => {
  test("signs out and wipes the old server's data before saving the next one", async () => {
    const { calls, switchServer } = recorder();
    await switchServer("https://next.example.org");
    expect(calls).toEqual([...CLEANUP, "setServer:https://next.example.org"]);
  });

  test("with no next server, forgets the current one so the app asks again", async () => {
    const { calls, switchServer } = recorder();
    await switchServer(null);
    expect(calls).toEqual([...CLEANUP, "setServer:null"]);
  });

  test("an unreachable old server still has its data wiped", async () => {
    const { calls, switchServer } = recorder(["signOut", "cancelPendingMagicLink"]);
    await switchServer("https://next.example.org");
    expect(calls).toEqual([...CLEANUP, "setServer:https://next.example.org"]);
  });

  test("keeps the old server when its session cannot be cleared", async () => {
    const { calls, switchServer } = recorder(["clearSession"]);
    await expect(switchServer("https://next.example.org")).rejects.toThrow("clearSession failed");
    expect(calls).not.toContain("setServer:https://next.example.org");
  });

  test("keeps the old server when its local data cannot be wiped", async () => {
    const { calls, switchServer } = recorder(["clearLocalData"]);
    await expect(switchServer("https://next.example.org")).rejects.toThrow("clearLocalData failed");
    expect(calls).not.toContain("clearSession");
    expect(calls.some((call) => call.startsWith("setServer"))).toBe(false);
  });
});
