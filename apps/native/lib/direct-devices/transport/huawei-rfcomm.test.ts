import { expect, test } from "bun:test";

import type { BtClassicAdapter, BtClassicDevice, RfcommLink } from "../../../modules/bt-classic";
import { getHuaweiModel, HUAWEI_BR_SDP_UUID, type HuaweiModel } from "../models/huawei";
import type { HuaweiSession, HuaweiSessionOptions } from "./huawei";
import { resolveHuaweiBrAddress, runHuaweiBrSync } from "./huawei-rfcomm";

const GT3 = getHuaweiModel("huawei_watch_gt_3")!;
const BLE = "AA:BB:CC:DD:EE:10";

function fakeBtClassic(options: { bonded?: BtClassicDevice[]; failFirst?: string } = {}) {
  const calls: unknown[][] = [];
  let failures = options.failFirst ? 1 : 0;
  const socket: RfcommLink = {
    socketId: "rfcomm-1",
    subscribe: () => () => undefined,
    write: async () => undefined,
    close: async () => void calls.push(["close"]),
  };
  const adapter: BtClassicAdapter = {
    isSupported: () => true,
    listBonded: async () => options.bonded ?? [],
    discover: async () => undefined,
    openRfcomm: async (args) => {
      calls.push(["openRfcomm", args]);
      if (failures > 0) {
        failures -= 1;
        throw new Error(options.failFirst);
      }
      return socket;
    },
  };
  return { adapter, calls };
}

function fakeBond() {
  const calls: unknown[] = [];
  return {
    calls,
    bond: {
      getState: async () => "bonded" as const,
      ensureBonded: async (args: unknown) => void calls.push(args),
      cancelWait: async () => undefined,
    },
  };
}

function fakeSession(result: Promise<void> = Promise.resolve()) {
  const seen: HuaweiSessionOptions[] = [];
  const events: string[] = [];
  const create = (options: HuaweiSessionOptions) => {
    seen.push(options);
    return {
      start: () => void events.push("start"),
      whenDone: () => result,
      close: async () => void events.push("close"),
    } as unknown as HuaweiSession;
  };
  return { create, seen, events };
}

const device = (address: string, name: string | null): BtClassicDevice => ({
  address,
  name,
  type: "classic",
  bonded: true,
});

test("the Classic address prefers the BLE address when bonded, then one bonded watch of the model", async () => {
  expect(
    await resolveHuaweiBrAddress(
      fakeBtClassic({ bonded: [device(BLE.toLowerCase(), "x")] }).adapter,
      GT3,
      BLE,
    ),
  ).toBe(BLE.toLowerCase());
  expect(
    await resolveHuaweiBrAddress(
      fakeBtClassic({ bonded: [device("11:22:33:44:55:66", "HUAWEI WATCH GT 3-ABC")] }).adapter,
      GT3,
      BLE,
    ),
  ).toBe("11:22:33:44:55:66");
  // Two candidates: ambiguous, so fall back to the BLE address.
  expect(
    await resolveHuaweiBrAddress(
      fakeBtClassic({
        bonded: [
          device("11:22:33:44:55:66", "HUAWEI WATCH GT 3-ABC"),
          device("11:22:33:44:55:77", "HUAWEI WATCH GT 3-DEF"),
        ],
      }).adapter,
      GT3,
      BLE,
    ),
  ).toBe(BLE);
});

test("a sync bonds, connects securely to the model's UUID and runs a BR session, then closes", async () => {
  const bt = fakeBtClassic();
  const bond = fakeBond();
  const session = fakeSession();
  await runHuaweiBrSync({
    model: GT3,
    bleAddress: BLE,
    deviceId: "device-1",
    btClassic: bt.adapter,
    bond: bond.bond,
    onRecord: () => undefined,
    signal: new AbortController().signal,
    createSession: session.create,
  });
  expect(bond.calls).toEqual([
    { nativeId: BLE, requestId: "huawei-br:device-1", timeoutMs: 60_000 },
  ]);
  expect(bt.calls[0]).toEqual([
    "openRfcomm",
    { address: BLE, uuid: HUAWEI_BR_SDP_UUID, timeoutMs: 15_000, secure: true },
  ]);
  expect(session.seen[0]).toMatchObject({
    transport: "br",
    transactionsCrypted: true,
    deviceId: "device-1",
    macAddress: BLE,
  });
  expect(session.events).toEqual(["start", "close"]);
  expect(bt.calls.at(-1)).toEqual(["close"]);
});

test("crypt-off models run in the clear; Honor PAKE models are refused before connecting", async () => {
  const session = fakeSession();
  await runHuaweiBrSync({
    model: getHuaweiModel("honor_watch_4")!,
    bleAddress: BLE,
    deviceId: "d",
    btClassic: fakeBtClassic().adapter,
    bond: fakeBond().bond,
    onRecord: () => undefined,
    signal: new AbortController().signal,
    createSession: session.create,
  });
  expect(session.seen[0]?.transactionsCrypted).toBe(false);

  const bt = fakeBtClassic();
  await expect(
    runHuaweiBrSync({
      model: getHuaweiModel("honor_watch_5")!,
      bleAddress: BLE,
      deviceId: "d",
      btClassic: bt.adapter,
      bond: fakeBond().bond,
      onRecord: () => undefined,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("HUAWEI_AUTH_UNSUPPORTED:honor_pake");
  expect(bt.calls).toEqual([]);
});

test("the first failed connect after bonding is retried once; the socket closes even on failure", async () => {
  const bt = fakeBtClassic({ failFirst: "BT_CLASSIC_CONNECT_FAILED" });
  const session = fakeSession(Promise.reject(new Error("HUAWEI_AUTH_FAILED")));
  await expect(
    runHuaweiBrSync({
      model: GT3,
      bleAddress: BLE,
      deviceId: "d",
      btClassic: bt.adapter,
      bond: fakeBond().bond,
      onRecord: () => undefined,
      signal: new AbortController().signal,
      createSession: session.create,
    }),
  ).rejects.toThrow("HUAWEI_AUTH_FAILED");
  expect(bt.calls.filter((call) => call[0] === "openRfcomm")).toHaveLength(2);
  expect(bt.calls.at(-1)).toEqual(["close"]);
});

test("BLE models and unsupported platforms are refused", async () => {
  const base = {
    bleAddress: BLE,
    deviceId: "d",
    bond: fakeBond().bond,
    onRecord: () => undefined,
    signal: new AbortController().signal,
  };
  await expect(
    runHuaweiBrSync({
      ...base,
      model: getHuaweiModel("huawei_band_8") as HuaweiModel,
      btClassic: fakeBtClassic().adapter,
    }),
  ).rejects.toThrow("HUAWEI_HISTORY_UNSUPPORTED");
  await expect(
    runHuaweiBrSync({
      ...base,
      model: GT3,
      btClassic: { ...fakeBtClassic().adapter, isSupported: () => false },
    }),
  ).rejects.toThrow("HUAWEI_BR_UNSUPPORTED");
});

test("a cancel during pairing releases the bond wait; during connect it closes the socket unused", async () => {
  // Abort while waiting for the bond.
  const abortBond = new AbortController();
  const cancelled: string[] = [];
  let releaseBond!: (error: Error) => void;
  const bond = {
    getState: async () => "none" as const,
    ensureBonded: () =>
      new Promise<void>((_, reject) => {
        releaseBond = reject;
      }),
    cancelWait: async (requestId: string) => {
      cancelled.push(requestId);
      releaseBond(new Error("PEBBLE_PAIRING_CANCELLED"));
    },
  };
  const pairing = runHuaweiBrSync({
    model: GT3,
    bleAddress: BLE,
    deviceId: "d",
    btClassic: fakeBtClassic().adapter,
    bond,
    onRecord: () => undefined,
    signal: abortBond.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  abortBond.abort();
  await expect(pairing).rejects.toThrow("CANCELLED");
  expect(cancelled).toEqual(["huawei-br:d"]);

  // Abort while the socket is opening: it is closed and no session starts.
  const abortConnect = new AbortController();
  const bt = fakeBtClassic();
  const session = fakeSession();
  const opening = bt.adapter.openRfcomm.bind(bt.adapter);
  bt.adapter = {
    ...bt.adapter,
    openRfcomm: async (args) => {
      abortConnect.abort();
      return opening(args);
    },
  };
  await expect(
    runHuaweiBrSync({
      model: GT3,
      bleAddress: BLE,
      deviceId: "d",
      btClassic: bt.adapter,
      bond: fakeBond().bond,
      onRecord: () => undefined,
      signal: abortConnect.signal,
      createSession: session.create,
    }),
  ).rejects.toThrow("CANCELLED");
  expect(session.seen).toEqual([]);
  expect(bt.calls.at(-1)).toEqual(["close"]);
});
