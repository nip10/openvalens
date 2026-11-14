import { expect, test } from "bun:test";

import { createBtClassicAdapter, type NativeBtClassicModule } from "../../../modules/bt-classic";

type Listener = (payload: Record<string, unknown>) => void;

function fakeNative(overrides: Partial<NativeBtClassicModule> = {}) {
  const listeners = new Map<string, Set<Listener>>();
  const calls: unknown[][] = [];
  const emit = (event: string, payload: Record<string, unknown>) => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };
  const native: NativeBtClassicModule = {
    isAvailable: () => true,
    listBonded: async () => [
      { address: "AA:BB:CC:DD:EE:01", name: "HUAWEI WATCH GT 3", type: "classic", bonded: true },
      { name: "no address" },
    ],
    startDiscovery: async (timeoutMs) => void calls.push(["startDiscovery", timeoutMs]),
    cancelDiscovery: async () => void calls.push(["cancelDiscovery"]),
    connect: async (address, uuid, secure, timeoutMs) => {
      calls.push(["connect", address, uuid, secure, timeoutMs]);
      return "rfcomm-1";
    },
    startReading: async (socketId, bufferSize) =>
      void calls.push(["startReading", socketId, bufferSize]),
    write: async (socketId, bytes) => void calls.push(["write", socketId, Array.from(bytes)]),
    close: async (socketId) => void calls.push(["close", socketId]),
    fetchUuids: async (address, timeoutMs) => {
      calls.push(["fetchUuids", address, timeoutMs]);
      return ["deab91e4-670f-11e1-9ace-30bc4824019b", 7];
    },
    listen: async (name, uuid, secure) => {
      calls.push(["listen", name, uuid, secure]);
      return "server-1";
    },
    accept: async (serverId, timeoutMs) => {
      calls.push(["accept", serverId, timeoutMs]);
      return { socketId: "rfcomm-2", address: "AA:BB:CC:DD:EE:03" };
    },
    stopListening: async (serverId) => void calls.push(["stopListening", serverId]),
    addListener: (event, listener) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
      return { remove: () => set.delete(listener) };
    },
    ...overrides,
  };
  return { native, calls, emit, listeners };
}

test("unsupported off Android or without the native module", async () => {
  const ios = createBtClassicAdapter(
    () => fakeNative().native,
    () => false,
  );
  expect(ios.isSupported()).toBe(false);
  await expect(ios.listBonded()).rejects.toThrow("BT_CLASSIC_UNSUPPORTED");
  const missing = createBtClassicAdapter(
    () => null,
    () => true,
  );
  expect(missing.isSupported()).toBe(false);
  await expect(
    missing.openRfcomm({ address: "AA:BB:CC:DD:EE:01", uuid: "x", timeoutMs: 1 }),
  ).rejects.toThrow("BT_CLASSIC_UNSUPPORTED");
});

test("bonded devices are normalised and malformed rows dropped", async () => {
  const adapter = createBtClassicAdapter(
    () => fakeNative().native,
    () => true,
  );
  expect(await adapter.listBonded()).toEqual([
    { address: "AA:BB:CC:DD:EE:01", name: "HUAWEI WATCH GT 3", type: "classic", bonded: true },
  ]);
});

test("an RFCOMM link reads only after subscribing, filters by socket and writes in order", async () => {
  const fake = fakeNative();
  const adapter = createBtClassicAdapter(
    () => fake.native,
    () => true,
  );
  const link = await adapter.openRfcomm({
    address: "AA:BB:CC:DD:EE:01",
    uuid: "82ff3820-8411-400c-b85a-55bdb32cf060",
    timeoutMs: 15_000,
  });
  expect(fake.calls).toEqual([
    ["connect", "AA:BB:CC:DD:EE:01", "82ff3820-8411-400c-b85a-55bdb32cf060", true, 15_000],
  ]);
  const received: number[][] = [];
  const closed: string[] = [];
  const unsubscribe = link.subscribe(
    (bytes) => received.push(Array.from(bytes)),
    (reason) => closed.push(reason),
  );
  expect(fake.calls.at(-1)).toEqual(["startReading", "rfcomm-1", 4096]);
  fake.emit("onData", { socketId: "rfcomm-2", bytes: Uint8Array.of(9) });
  fake.emit("onData", { socketId: "rfcomm-1", bytes: Uint8Array.of(0x5a, 1) });
  fake.emit("onData", { socketId: "rfcomm-1", bytes: [2, 3] });
  // The current module sends base64.
  fake.emit("onData", {
    socketId: "rfcomm-1",
    base64: Buffer.from([4, 5, 250]).toString("base64"),
  });
  expect(received).toEqual([
    [0x5a, 1],
    [2, 3],
    [4, 5, 250],
  ]);
  await Promise.all([link.write(Uint8Array.of(1)), link.write(Uint8Array.of(2))]);
  expect(fake.calls.filter((call) => call[0] === "write")).toEqual([
    ["write", "rfcomm-1", [1]],
    ["write", "rfcomm-1", [2]],
  ]);
  fake.emit("onClosed", { socketId: "rfcomm-1", reason: "remote" });
  expect(closed).toEqual(["remote"]);
  unsubscribe();
  expect(fake.listeners.get("onData")?.size).toBe(0);
});

test("native rejections surface their BT_CLASSIC code", async () => {
  const fake = fakeNative({
    connect: async () => {
      throw Object.assign(new Error("read failed, socket might closed"), {
        code: "BT_CLASSIC_CONNECT_FAILED",
      });
    },
  });
  const adapter = createBtClassicAdapter(
    () => fake.native,
    () => true,
  );
  await expect(
    adapter.openRfcomm({ address: "AA:BB:CC:DD:EE:01", uuid: "x", timeoutMs: 1 }),
  ).rejects.toThrow("BT_CLASSIC_CONNECT_FAILED");
});

test("discovery reports devices and stops on finish or abort", async () => {
  const fake = fakeNative();
  const adapter = createBtClassicAdapter(
    () => fake.native,
    () => true,
  );
  const found: string[] = [];
  const done = adapter.discover({
    timeoutMs: 12_000,
    onDevice: (device) => found.push(device.address),
  });
  await Promise.resolve();
  fake.emit("onDiscovered", {
    address: "AA:BB:CC:DD:EE:02",
    name: null,
    type: "classic",
    bonded: false,
  });
  fake.emit("onDiscoveryFinished", {});
  await done;
  expect(found).toEqual(["AA:BB:CC:DD:EE:02"]);
  expect(fake.listeners.get("onDiscovered")?.size).toBe(0);

  const abort = new AbortController();
  const aborted = adapter.discover({
    timeoutMs: 12_000,
    onDevice: () => undefined,
    signal: abort.signal,
  });
  abort.abort();
  await aborted;
  expect(fake.calls.at(-1)).toEqual(["cancelDiscovery"]);
});

test("base64 decoding matches the platform encoder for every length", async () => {
  const { decodeBase64 } = await import("../../../modules/bt-classic");
  for (let length = 0; length < 40; length += 1) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) & 0xff);
    expect(Array.from(decodeBase64(Buffer.from(bytes).toString("base64"))!)).toEqual(
      Array.from(bytes),
    );
  }
  expect(decodeBase64("not base64!")).toBeNull();
});

test("listen publishes the record, signals it, accepts one link and always stops the server", async () => {
  const fake = fakeNative();
  const adapter = createBtClassicAdapter(
    () => fake.native,
    () => true,
  );
  const order: string[] = [];
  const { link, address } = await adapter.listen({
    name: "Garmin SPP",
    uuid: "deab91e4-670f-11e1-9ace-30bc4824019b",
    timeoutMs: 60_000,
    onListening: () => order.push(`listening after ${fake.calls.length} call(s)`),
  });
  expect(order).toEqual(["listening after 1 call(s)"]);
  expect(fake.calls).toEqual([
    ["listen", "Garmin SPP", "deab91e4-670f-11e1-9ace-30bc4824019b", true],
    ["accept", "server-1", 60_000],
    ["stopListening", "server-1"],
  ]);
  expect(address).toBe("AA:BB:CC:DD:EE:03");
  // The accepted socket is an ordinary link: reader on subscribe, ordered writes.
  const received: number[][] = [];
  link.subscribe(
    (bytes) => received.push(Array.from(bytes)),
    () => undefined,
  );
  expect(fake.calls.at(-1)).toEqual(["startReading", "rfcomm-2", 4096]);
  fake.emit("onData", { socketId: "rfcomm-2", base64: Buffer.from([0, 1, 0]).toString("base64") });
  expect(received).toEqual([[0, 1, 0]]);
  await link.write(Uint8Array.of(9));
  expect(fake.calls.at(-1)).toEqual(["write", "rfcomm-2", [9]]);
});

test("an abort while accepting stops the server; native codes surface", async () => {
  let rejectAccept: (error: unknown) => void = () => undefined;
  const calls: unknown[][] = [];
  const fake = fakeNative({
    accept: () =>
      new Promise((_, reject) => {
        rejectAccept = reject;
      }),
    stopListening: async (serverId) => {
      calls.push(["stopListening", serverId]);
      rejectAccept(Object.assign(new Error("closed"), { code: "BT_CLASSIC_CANCELLED" }));
    },
  });
  const adapter = createBtClassicAdapter(
    () => fake.native,
    () => true,
  );
  const abort = new AbortController();
  const pending = adapter.listen({
    name: "Garmin SPP",
    uuid: "deab91e4-670f-11e1-9ace-30bc4824019b",
    timeoutMs: 60_000,
    signal: abort.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  abort.abort();
  await expect(pending).rejects.toThrow("BT_CLASSIC_CANCELLED");
  expect(calls[0]).toEqual(["stopListening", "server-1"]);

  const timedOut = fakeNative({
    accept: async () => {
      throw Object.assign(new Error("timeout"), { code: "BT_CLASSIC_ACCEPT_TIMEOUT" });
    },
  });
  await expect(
    createBtClassicAdapter(
      () => timedOut.native,
      () => true,
    ).listen({ name: "x", uuid: "y", timeoutMs: 1 }),
  ).rejects.toThrow("BT_CLASSIC_ACCEPT_TIMEOUT");
  expect(timedOut.calls.at(-1)).toEqual(["stopListening", "server-1"]);
});

test("fetchUuids passes the address through and drops non-string rows", async () => {
  const fake = fakeNative();
  const adapter = createBtClassicAdapter(
    () => fake.native,
    () => true,
  );
  expect(await adapter.fetchUuids("AA:BB:CC:DD:EE:03", 10_000)).toEqual([
    "deab91e4-670f-11e1-9ace-30bc4824019b",
  ]);
  expect(fake.calls).toEqual([["fetchUuids", "AA:BB:CC:DD:EE:03", 10_000]]);
});
