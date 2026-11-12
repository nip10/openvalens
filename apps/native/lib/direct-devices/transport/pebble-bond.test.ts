import { expect, test } from "bun:test";
import { createPebbleBondAdapter, type PebbleBondState } from "../../../modules/pebble-bond";

function fakeNative() {
  const calls: unknown[][] = [];
  let state: PebbleBondState = "none";
  let ensureResult: Promise<void> = Promise.resolve();
  const native = {
    getState: async (nativeId: string) => {
      calls.push(["getState", nativeId]);
      return state;
    },
    ensureBonded: async (nativeId: string, requestId: string, timeoutMs: number) => {
      calls.push(["ensureBonded", nativeId, requestId, timeoutMs]);
      return ensureResult;
    },
    cancelWait: async (requestId: string) => {
      calls.push(["cancelWait", requestId]);
    },
    setState(value: PebbleBondState) {
      state = value;
    },
    setEnsureResult(value: Promise<void>) {
      ensureResult = value;
    },
  };
  return { calls, native };
}

test("reports each Android bond state and passes native device id", async () => {
  const { calls, native } = fakeNative();
  const adapter = createPebbleBondAdapter(
    () => native,
    () => false,
  );
  for (const state of ["none", "bonding", "bonded"] as const) {
    native.setState(state);
    expect(await adapter.getState("AA:BB:CC:DD:EE:FF")).toBe(state);
  }
  expect(calls).toEqual([
    ["getState", "AA:BB:CC:DD:EE:FF"],
    ["getState", "AA:BB:CC:DD:EE:FF"],
    ["getState", "AA:BB:CC:DD:EE:FF"],
  ]);
});

test("missing native module and iOS are unsupported without attempting createBond", async () => {
  const missing = createPebbleBondAdapter(
    () => null,
    () => false,
  );
  expect(await missing.getState("watch-id")).toBe("unsupported");
  await expect(
    missing.ensureBonded({ nativeId: "watch-id", requestId: "r1", timeoutMs: 100 }),
  ).rejects.toThrow("PEBBLE_PAIRING_UNSUPPORTED");

  let loaded = false;
  const ios = createPebbleBondAdapter(
    () => {
      loaded = true;
      return fakeNative().native;
    },
    () => true,
  );
  expect(await ios.getState("watch-id")).toBe("unsupported");
  await expect(
    ios.ensureBonded({ nativeId: "watch-id", requestId: "r2", timeoutMs: 1 }),
  ).rejects.toThrow("PEBBLE_PAIRING_UNSUPPORTED");
  await ios.cancelWait("r2");
  expect(loaded).toBe(false);
});

test("maps options to native positional ABI and cancellation", async () => {
  const { calls, native } = fakeNative();
  const adapter = createPebbleBondAdapter(
    () => native,
    () => false,
  );
  const options = { nativeId: "watch-id", requestId: "request-7", timeoutMs: 12_345 } as const;
  await adapter.ensureBonded(options);
  await adapter.cancelWait(options.requestId);
  expect(calls).toEqual([
    ["ensureBonded", "watch-id", "request-7", 12_345],
    ["cancelWait", "request-7"],
  ]);
});

test("preserves native permission and pairing errors", async () => {
  const { native } = fakeNative();
  const adapter = createPebbleBondAdapter(
    () => native,
    () => false,
  );
  const permission = new Error("PEBBLE_PAIRING_PERMISSION");
  native.setEnsureResult(Promise.reject(permission));
  await expect(
    adapter.ensureBonded({ nativeId: "watch-id", requestId: "request-8", timeoutMs: 50 }),
  ).rejects.toBe(permission);
  await expect(adapter.getState("watch-id")).resolves.toBe("none");
});

test("rejects malformed native state instead of asserting the declared union", async () => {
  const { native } = fakeNative();
  const malformed = {
    ...native,
    getState: async () => "some-future-state",
  };
  const adapter = createPebbleBondAdapter(
    () => malformed,
    () => false,
  );
  await expect(adapter.getState("watch-id")).rejects.toThrow("PEBBLE_PAIRING_INVALID_STATE");
});
