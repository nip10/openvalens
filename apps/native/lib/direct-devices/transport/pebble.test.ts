/**
 * Tests for the Pebble connection session.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { expect, test } from "bun:test";
import type { BleError, Characteristic, Subscription } from "react-native-ble-plx";

import {
  PEBBLE_SERVICE_UUIDS,
  clampPebbleMtuLimit,
  createDurablePebbleSession,
  createPebbleSession,
  selectPebbleProfile,
  type PebbleProfile,
} from "./pebble";
import { PEBBLE_SERVICE_UUID, type PebbleModel } from "../models/pebble";
import {
  PEBBLE_ENDPOINT_DATALOG,
  PEBBLE_PPOGATT_READ_UUID,
  PEBBLE_PPOGATT_SERVICE_UUID,
  PEBBLE_PPOGATT_WRITE_UUID,
  PEBBLE_UUID_ZERO,
  encodeDatalogClose,
  encodeDatalogFrame,
  encodeDatalogOpenSession,
  encodeDatalogSendData,
  decodePebbleFrame,
  decodeDatalogPayload,
  decodePpogattHeader,
  chunkPpogatt,
  encodePebbleFrame,
  encodePpogattData,
} from "../protocol/pebble";

const HEALTH_PROFILE = { heightCm: 175, weightKg: 75, age: 30, gender: 0, token: 0 };

const PROFILE: PebbleProfile = {
  modelId: "pebble_classic_2",
  serviceUuid: PEBBLE_SERVICE_UUID,
  ppogattServiceUuid: PEBBLE_PPOGATT_SERVICE_UUID,
  readUuid: PEBBLE_PPOGATT_READ_UUID,
  writeUuid: PEBBLE_PPOGATT_WRITE_UUID,
  mtuLimit: 512,
};

function fakeDevice(initialMtu = 339, initialConnectivity = 0x07) {
  const monitors = new Map<
    string,
    (error: BleError | null, value: Characteristic | null) => void
  >();
  const writes: { service: string; characteristic: string; value: Uint8Array }[] = [];
  const characteristics = new Map<string, string[]>();
  characteristics.set(PEBBLE_PPOGATT_SERVICE_UUID, [
    PEBBLE_PPOGATT_READ_UUID,
    PEBBLE_PPOGATT_WRITE_UUID,
  ]);
  let mtu = initialMtu;
  let connectivity = initialConnectivity;
  let disconnects = 0;
  let writeHook: ((characteristic: string) => Promise<void>) | null = null;
  const device = {
    get mtu() {
      return mtu;
    },
    requestMTU: async (requested: number) => {
      mtu = Math.min(requested, 339);
      return device;
    },
    characteristicsForService: async (service: string) =>
      (characteristics.get(service) ?? []).map((uuid) => ({ uuid }) as Characteristic),
    services: async () =>
      [PEBBLE_SERVICE_UUID, PEBBLE_PPOGATT_SERVICE_UUID].map((uuid) => ({ uuid })),
    readCharacteristicForService: async () =>
      ({ value: Buffer.from([connectivity]).toString("base64") }) as Characteristic,
    cancelConnection: async () => {
      disconnects += 1;
      return device;
    },
    monitorCharacteristicForService: (
      service: string,
      characteristic: string,
      callback: (error: BleError | null, value: Characteristic | null) => void,
    ): Subscription => {
      monitors.set(`${service}|${characteristic}`, callback);
      return { remove() {} } as Subscription;
    },
    writeCharacteristicWithResponseForService: async (
      service: string,
      characteristic: string,
      value: string,
    ) => {
      await writeHook?.(characteristic);
      writes.push({
        service,
        characteristic,
        value: Uint8Array.from(Buffer.from(value, "base64")),
      });
      return {} as Characteristic;
    },
  };
  return {
    device,
    monitors,
    writes,
    characteristics,
    setConnectivity: (flags: number) => {
      connectivity = flags;
    },
    setWriteHook: (hook: ((characteristic: string) => Promise<void>) | null) => {
      writeHook = hook;
    },
    disconnects: () => disconnects,
  };
}

/** Timers that only fire when the test says so. */
function manualTimers() {
  let nextId = 1;
  const pending = new Map<number, { callback: () => void; ms: number }>();
  return {
    timers: {
      setTimeout: (callback: () => void, ms: number) => {
        const id = nextId++;
        pending.set(id, { callback, ms });
        return id;
      },
      clearTimeout: (handle: unknown) => {
        pending.delete(handle as number);
      },
    },
    fire(ms: number) {
      // Snapshot first: a callback may schedule a new timer with the same delay.
      for (const [id, timer] of Array.from(pending))
        if (timer.ms === ms) {
          pending.delete(id);
          timer.callback();
        }
    },
    pendingMs: () => [...pending.values()].map((timer) => timer.ms),
  };
}

function notify(
  monitors: Map<string, (error: BleError | null, value: Characteristic | null) => void>,
  bytes: Uint8Array,
) {
  const callback = monitors.get(`${PEBBLE_PPOGATT_SERVICE_UUID}|${PEBBLE_PPOGATT_READ_UUID}`);
  if (!callback) throw new Error("TEST_MONITOR_MISSING");
  callback(null, { value: Buffer.from(bytes).toString("base64") } as Characteristic);
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function validStepsItem(): Uint8Array {
  const data = new Uint8Array(22);
  data[0] = 7;
  const timestamp = 1_700_000_040;
  data[2] = timestamp & 0xff;
  data[3] = (timestamp >>> 8) & 0xff;
  data[4] = (timestamp >>> 16) & 0xff;
  data[5] = (timestamp >>> 24) & 0xff;
  data[7] = 13;
  data[8] = 1;
  data[9] = 10;
  return data;
}

function feedFrame(
  monitors: Map<string, (error: BleError | null, value: Characteristic | null) => void>,
  frame: Uint8Array,
) {
  const callback = monitors.get(`${PEBBLE_PPOGATT_SERVICE_UUID}|${PEBBLE_PPOGATT_READ_UUID}`);
  if (!callback) throw new Error("TEST_MONITOR_MISSING");
  for (const packet of chunkPpogatt(frame, 339))
    callback(null, { value: Buffer.from(packet).toString("base64") } as Characteristic);
}

function hasDatalogAck(writes: readonly { value: Uint8Array }[], id: number): boolean {
  return writes.some((write) => {
    const frame = decodePebbleFrame(write.value.slice(1));
    if (!frame || frame.endpoint !== PEBBLE_ENDPOINT_DATALOG) return false;
    const payload = decodeDatalogPayload(frame.payload);
    return payload?.command === "ack" && payload.id === id;
  });
}

function datalogAckCount(writes: readonly { value: Uint8Array }[], id: number): number {
  return writes.filter((write) => {
    const frame = decodePebbleFrame(write.value.slice(1));
    if (!frame || frame.endpoint !== PEBBLE_ENDPOINT_DATALOG) return false;
    const payload = decodeDatalogPayload(frame.payload);
    return payload?.command === "ack" && payload.id === id;
  }).length;
}

async function preparedTransport(timers?: ReturnType<typeof manualTimers>["timers"]) {
  const fake = fakeDevice(339);
  const session = createDurablePebbleSession({
    device: fake.device as never,
    nativeId: "peer-1",
    ...(timers ? { timers } : {}),
  });
  const preparing = session.prepare(new AbortController().signal);
  await tick();
  notify(fake.monitors, Uint8Array.of(0x02, 0x01));
  await tick();
  const firmware = new Uint8Array(47);
  firmware[46] = 15;
  notify(fake.monitors, encodePpogattData(0, encodePebbleFrame(16, firmware)));
  await preparing;
  return { ...fake, session };
}

test("legacy Pebble callback sessions fail closed without starting capture", async () => {
  const { device, monitors, writes } = fakeDevice(339);
  const failures: string[] = [];
  const session = createPebbleSession({
    device,
    profile: PROFILE,
    onRecord: () => {
      throw new Error("legacy callback must not receive data");
    },
    onFailure: (failure) => failures.push(failure),
    healthProfile: HEALTH_PROFILE,
  });
  expect(() => session.start()).toThrow("PEBBLE_CAPTURE_UNAVAILABLE");
  await tick();
  expect(monitors.size).toBe(0);
  expect(writes).toHaveLength(0);
  expect(failures).toEqual([]);
  await session.close();
});

test("prepare waits for PPoGATT readiness and resolves model only from firmware identity", async () => {
  const { device, monitors, writes } = fakeDevice(339);
  const session = createDurablePebbleSession({
    device: device as never,
    nativeId: "peer-1",
    advertisedName: "Pebble A1B2",
  });
  const preparing = session.prepare(new AbortController().signal);
  await tick();
  expect(writes.some((write) => write.characteristic === PEBBLE_PPOGATT_WRITE_UUID)).toBe(false);
  notify(monitors, Uint8Array.of(0x02, 0x01));
  await tick();
  const firmware = new Uint8Array(47);
  firmware[46] = 15;
  notify(monitors, encodePpogattData(0, encodePebbleFrame(16, firmware)));
  await expect(preparing).resolves.toMatchObject({
    nativeId: "peer-1",
    hardwareId: 15,
    identity: { family: "pebble", modelId: "pebble_2_duo" },
  });
  const requestEndpoints = writes
    .filter((write) => write.characteristic === PEBBLE_PPOGATT_WRITE_UUID)
    .map((write) => decodePebbleFrame(write.value.slice(1))?.endpoint)
    .filter((endpoint): endpoint is number => endpoint !== undefined);
  expect(requestEndpoints).toContain(16);
  expect(requestEndpoints).not.toContain(911);
  expect(requestEndpoints).not.toContain(0xb1db);
  await session.close();
});

test("prepare rejects unsupported firmware hardware identities", async () => {
  const { device, monitors } = fakeDevice(339);
  const session = createDurablePebbleSession({ device: device as never, nativeId: "peer-1" });
  const preparing = session.prepare(new AbortController().signal);
  await tick();
  notify(monitors, Uint8Array.of(0x02, 0x01));
  await tick();
  const firmware = new Uint8Array(47);
  firmware[46] = 19;
  notify(monitors, encodePpogattData(0, encodePebbleFrame(16, firmware)));
  await expect(preparing).rejects.toThrow("PEBBLE_IDENTITY_UNSUPPORTED");
});

test("first pairing triggers client-only pairing and waits for encrypted flags", async () => {
  const fake = fakeDevice(339, 0x01);
  const order: string[] = [];
  const session = createDurablePebbleSession({
    device: fake.device as never,
    nativeId: "pairing-peer",
    bondAdapter: {
      getState: async () => {
        order.push("state");
        return "none";
      },
      ensureBonded: async ({ requestId }) => {
        order.push("bond");
        expect(requestId).toContain("pairing-peer:");
        fake.setConnectivity(0x07);
      },
      cancelWait: async () => {
        order.push("cancel-wait");
      },
    },
  });
  const preparing = session.prepare(new AbortController().signal);
  await tick();
  expect(fake.writes[0]?.value).toEqual(Uint8Array.of(0x11));
  expect(order).toEqual(["state", "bond", "cancel-wait"]);
  notify(fake.monitors, Uint8Array.of(0x02, 0x01));
  await tick();
  const firmware = new Uint8Array(47);
  firmware[46] = 15;
  notify(fake.monitors, encodePpogattData(0, encodePebbleFrame(16, firmware)));
  await expect(preparing).resolves.toMatchObject({ hardwareId: 15 });
  await session.close();
});

test("prepare refuses stale and inconsistent connectivity evidence", async () => {
  const stale = fakeDevice(339, 0x21);
  const staleSession = createDurablePebbleSession({
    device: stale.device as never,
    nativeId: "stale",
  });
  await expect(staleSession.prepare(new AbortController().signal)).rejects.toThrow(
    "PEBBLE_CONNECTIVITY_STALE",
  );
  const inconsistent = fakeDevice(339, 0x05);
  const inconsistentSession = createDurablePebbleSession({
    device: inconsistent.device as never,
    nativeId: "inconsistent",
  });
  await expect(inconsistentSession.prepare(new AbortController().signal)).rejects.toThrow(
    "PEBBLE_CONNECTIVITY_INCONSISTENT",
  );
});

test("DATALOG data is ACKed only after its durable sink receipt", async () => {
  const f = await preparedTransport();
  let commit!: (receipt: { durable: true; insertedItems: number; throughSeq: number }) => void;
  const capture = f.session.capture({
    signal: new AbortController().signal,
    sink: () =>
      new Promise((resolve) => {
        commit = resolve;
      }),
  });
  await tick();
  feedFrame(
    f.monitors,
    encodeDatalogFrame(
      encodeDatalogOpenSession({
        id: 2,
        uuid: PEBBLE_UUID_ZERO,
        timestamp: 1_700_000_040,
        logTag: 81,
        itemType: 0,
        itemSize: 22,
      }),
    ),
  );
  await tick();
  const acksBeforeData = datalogAckCount(f.writes, 2);
  feedFrame(
    f.monitors,
    encodeDatalogFrame(
      encodeDatalogSendData({ id: 2, itemsLeft: 0, crc: 0, data: validStepsItem() }),
    ),
  );
  await tick();
  expect(datalogAckCount(f.writes, 2)).toBe(acksBeforeData);
  commit({ durable: true, insertedItems: 1, throughSeq: 1 });
  await tick();
  await tick();
  expect(hasDatalogAck(f.writes, 2)).toBe(true);
  await f.session.close();
  await expect(capture).resolves.toMatchObject({ status: "cancelled" });
});

test("cancellation during a durable write leaves the packet unacknowledged", async () => {
  const f = await preparedTransport();
  const abort = new AbortController();
  let commit!: (receipt: { durable: true; insertedItems: number; throughSeq: number }) => void;
  const capture = f.session.capture({
    signal: abort.signal,
    sink: () =>
      new Promise((resolve) => {
        commit = resolve;
      }),
  });
  await tick();
  feedFrame(
    f.monitors,
    encodeDatalogFrame(
      encodeDatalogOpenSession({
        id: 3,
        uuid: PEBBLE_UUID_ZERO,
        timestamp: 1_700_000_040,
        logTag: 81,
        itemType: 0,
        itemSize: 22,
      }),
    ),
  );
  await tick();
  const acksBeforeData = datalogAckCount(f.writes, 3);
  feedFrame(
    f.monitors,
    encodeDatalogFrame(
      encodeDatalogSendData({ id: 3, itemsLeft: 0, crc: 0, data: validStepsItem() }),
    ),
  );
  await tick();
  abort.abort();
  commit({ durable: true, insertedItems: 1, throughSeq: 1 });
  await expect(capture).resolves.toEqual({ status: "cancelled" });
  await tick();
  expect(datalogAckCount(f.writes, 3)).toBe(acksBeforeData);
  await f.session.close();
});

test("selectPebbleProfile requires the pairing and PPoGATT services", async () => {
  const bleModel: Pick<PebbleModel, "id" | "bleOnly"> = {
    id: "pebble_time_2",
    bleOnly: true,
  };
  const classicModel: Pick<PebbleModel, "id" | "bleOnly"> = {
    id: "pebble_time",
    bleOnly: false,
  };
  const { device, characteristics } = fakeDevice();
  characteristics.set(PEBBLE_PPOGATT_SERVICE_UUID, [
    PEBBLE_PPOGATT_READ_UUID,
    PEBBLE_PPOGATT_WRITE_UUID,
  ]);
  const services = [PEBBLE_SERVICE_UUID, PEBBLE_PPOGATT_SERVICE_UUID];

  expect(await selectPebbleProfile(device, services, bleModel)).toMatchObject({
    modelId: "pebble_time_2",
    mtuLimit: 512,
  });
  expect(await selectPebbleProfile(device, services, classicModel)).toBeNull();
  expect(await selectPebbleProfile(device, [PEBBLE_SERVICE_UUID], bleModel)).toBeNull();
  expect(await selectPebbleProfile(device, services, bleModel, { mtuLimit: 900 })).toMatchObject({
    mtuLimit: 512,
  });
  expect(await selectPebbleProfile(device, services, bleModel, { mtuLimit: 10 })).toMatchObject({
    mtuLimit: 20,
  });

  characteristics.set(PEBBLE_PPOGATT_SERVICE_UUID, [PEBBLE_PPOGATT_READ_UUID]);
  expect(await selectPebbleProfile(device, services, bleModel)).toBeNull();
});

test("the MTU limit helper clamps to the upstream range", () => {
  expect(clampPebbleMtuLimit(undefined)).toBe(512);
  expect(clampPebbleMtuLimit(0)).toBe(20);
  expect(clampPebbleMtuLimit(1000)).toBe(512);
  expect(clampPebbleMtuLimit(200)).toBe(200);
  expect(PEBBLE_SERVICE_UUIDS.has(PEBBLE_PPOGATT_SERVICE_UUID)).toBe(true);
  expect(PEBBLE_ENDPOINT_DATALOG).toBe(6778);
});

type Monitors = ReturnType<typeof fakeDevice>["monitors"];
const RECEIPT = { durable: true as const, insertedItems: 1, throughSeq: 1 };

function openStepsSession(monitors: Monitors, id: number) {
  feedFrame(
    monitors,
    encodeDatalogFrame(
      encodeDatalogOpenSession({
        id,
        uuid: PEBBLE_UUID_ZERO,
        timestamp: 1_700_000_040,
        logTag: 81,
        itemType: 0,
        itemSize: 22,
      }),
    ),
  );
}

function sendSteps(monitors: Monitors, id: number) {
  feedFrame(
    monitors,
    encodeDatalogFrame(encodeDatalogSendData({ id, itemsLeft: 0, crc: 0, data: validStepsItem() })),
  );
}

function datalogReplies(writes: readonly { value: Uint8Array }[], command: "ack" | "nack") {
  return writes.flatMap((write) => {
    const frame = decodePebbleFrame(write.value.slice(1));
    if (!frame || frame.endpoint !== PEBBLE_ENDPOINT_DATALOG) return [];
    const payload = decodeDatalogPayload(frame.payload);
    return payload?.command === command ? [payload.id] : [];
  });
}

async function settle(rounds = 6) {
  for (let round = 0; round < rounds; round += 1) await tick();
}

test("cancelling during the bond wait cancels pairing, closes the link and rejects CANCELLED", async () => {
  const fake = fakeDevice(339, 0x01);
  const cancelledWaits: string[] = [];
  let rejectBond: ((error: Error) => void) | null = null;
  const session = createDurablePebbleSession({
    device: fake.device as never,
    nativeId: "pairing-peer",
    timers: manualTimers().timers,
    bondAdapter: {
      getState: async () => "none",
      ensureBonded: () =>
        new Promise<void>((_, reject) => {
          rejectBond = reject;
        }),
      cancelWait: async (requestId) => {
        cancelledWaits.push(requestId);
        rejectBond?.(new Error("BOND_WAIT_ABORTED"));
      },
    },
  });
  const abort = new AbortController();
  const preparing = session.prepare(abort.signal);
  await settle();
  expect(rejectBond).not.toBeNull();
  abort.abort();
  await expect(preparing).rejects.toThrow(/^CANCELLED$/);
  expect(cancelledWaits.length).toBeGreaterThan(0);
  expect(fake.disconnects()).toBeGreaterThan(0);
  expect(fake.writes.some((write) => write.characteristic === PEBBLE_PPOGATT_WRITE_UUID)).toBe(
    false,
  );
});

test("a monitor failure during the readiness handshake fails prepare without waiting for the timeout", async () => {
  const fake = fakeDevice(339);
  const clock = manualTimers();
  const session = createDurablePebbleSession({
    device: fake.device as never,
    nativeId: "peer-1",
    timers: clock.timers,
  });
  const preparing = session.prepare(new AbortController().signal);
  await settle();
  const callback = fake.monitors.get(`${PEBBLE_PPOGATT_SERVICE_UUID}|${PEBBLE_PPOGATT_READ_UUID}`);
  callback?.({ message: "link lost" } as BleError, null);
  // No timer fires: the rejection comes from the terminal transition itself.
  await expect(preparing).rejects.toThrow("PEBBLE_MONITOR_FAILED");
});

test("all PPoGATT writes are serialized session-wide, including link ACKs and DATALOG replies", async () => {
  const f = await preparedTransport(manualTimers().timers);
  let inflight = 0;
  let maxInflight = 0;
  f.setWriteHook(async () => {
    inflight += 1;
    maxInflight = Math.max(maxInflight, inflight);
    await tick();
    inflight -= 1;
  });
  const capture = f.session.capture({
    signal: new AbortController().signal,
    sink: async () => RECEIPT,
  });
  await settle();
  openStepsSession(f.monitors, 4);
  openStepsSession(f.monitors, 5);
  sendSteps(f.monitors, 4);
  sendSteps(f.monitors, 5);
  await settle(30);
  expect(maxInflight).toBe(1);
  expect(datalogReplies(f.writes, "ack")).toEqual([4, 5, 4, 5]);
  await f.session.close();
  await expect(capture).resolves.toEqual({ status: "cancelled" });
});

test("outbound PPoGATT data serials are consecutive and wrap at 32", async () => {
  const f = await preparedTransport(manualTimers().timers);
  const capture = f.session.capture({
    signal: new AbortController().signal,
    sink: async () => RECEIPT,
  });
  await settle();
  for (let id = 0; id < 40; id += 1) {
    openStepsSession(f.monitors, id);
    await settle(2);
  }
  await settle();
  const serials = f.writes
    .filter((write) => write.characteristic === PEBBLE_PPOGATT_WRITE_UUID)
    .map((write) => decodePpogattHeader(write.value[0]!))
    .filter((header) => header.command === 0)
    .map((header) => header.serial);
  expect(serials.length).toBeGreaterThan(33);
  for (let index = 1; index < serials.length; index += 1)
    expect(serials[index]).toBe((serials[index - 1]! + 1) & 0x1f);
  expect(serials).toContain(31);
  await f.session.close();
  await capture;
});

test("a failed write terminates capture and nothing further is written", async () => {
  const f = await preparedTransport(manualTimers().timers);
  f.setWriteHook(async () => {
    throw new Error("GATT write failed");
  });
  const outcome = await f.session.capture({
    signal: new AbortController().signal,
    sink: async () => RECEIPT,
  });
  expect(outcome).toEqual({ status: "failed", code: "PEBBLE_WRITE_FAILED" });
  f.setWriteHook(null);
  const writesAfter = f.writes.length;
  openStepsSession(f.monitors, 6);
  await settle();
  expect(f.writes.length).toBe(writesAfter);
  expect(datalogReplies(f.writes, "ack")).not.toContain(6);
  expect(f.disconnects()).toBeGreaterThan(0);
});

test("a storage failure gets no DATALOG reply at all, fails capture and disconnects", async () => {
  const f = await preparedTransport(manualTimers().timers);
  const capture = f.session.capture({
    signal: new AbortController().signal,
    sink: async () => {
      throw new Error("SQLITE_FULL");
    },
  });
  await settle();
  openStepsSession(f.monitors, 7);
  await settle();
  sendSteps(f.monitors, 7);
  await expect(capture).resolves.toEqual({ status: "failed", code: "PEBBLE_PERSISTENCE_FAILED" });
  expect(datalogReplies(f.writes, "ack")).toEqual([7]); // the open, never the data
  expect(datalogReplies(f.writes, "nack")).toEqual([]);
  expect(f.disconnects()).toBeGreaterThan(0);
});

test("idle is reported only after every session closes and the quiet window elapses; late packets are ignored", async () => {
  const clock = manualTimers();
  const f = await preparedTransport(clock.timers);
  let sinkCalls = 0;
  const capture = f.session.capture({
    signal: new AbortController().signal,
    sink: async () => {
      sinkCalls += 1;
      return RECEIPT;
    },
  });
  await settle();
  openStepsSession(f.monitors, 8);
  await settle();
  sendSteps(f.monitors, 8);
  await settle();
  // Data alone never completes capture; only CLOSE starts the quiet window.
  expect(clock.pendingMs()).not.toContain(2_000);
  feedFrame(f.monitors, encodeDatalogFrame(encodeDatalogClose(8)));
  await settle();
  expect(clock.pendingMs()).toContain(2_000);
  clock.fire(2_000);
  await expect(capture).resolves.toEqual({
    status: "idle",
    receivedPackets: 1,
    durableItems: 1,
    rejectedPackets: 0,
  });
  // Upstream answers CLOSE with a NACK.
  expect(datalogReplies(f.writes, "nack")).toEqual([8]);
  const writesAfter = f.writes.length;
  openStepsSession(f.monitors, 9);
  sendSteps(f.monitors, 9);
  await settle();
  expect(sinkCalls).toBe(1);
  expect(f.writes.length).toBe(writesAfter);
  await expect(
    f.session.capture({ signal: new AbortController().signal, sink: async () => RECEIPT }),
  ).resolves.toEqual({ status: "failed", code: "PEBBLE_SESSION_TERMINAL" });
});

test("capture fails with a timeout when the watch never opens a DATALOG session", async () => {
  const clock = manualTimers();
  const f = await preparedTransport(clock.timers);
  const capture = f.session.capture({
    signal: new AbortController().signal,
    sink: async () => RECEIPT,
  });
  await settle();
  clock.fire(30_000);
  await expect(capture).resolves.toEqual({ status: "failed", code: "PEBBLE_CAPTURE_TIMEOUT" });
});

test("a second session opened inside the quiet window keeps capture running until it closes", async () => {
  const clock = manualTimers();
  const f = await preparedTransport(clock.timers);
  const capture = f.session.capture({
    signal: new AbortController().signal,
    sink: async () => RECEIPT,
  });
  await settle();
  openStepsSession(f.monitors, 10);
  sendSteps(f.monitors, 10);
  feedFrame(f.monitors, encodeDatalogFrame(encodeDatalogClose(10)));
  await settle();
  expect(clock.pendingMs()).toContain(2_000);
  openStepsSession(f.monitors, 11);
  await settle();
  expect(clock.pendingMs()).not.toContain(2_000);
  clock.fire(2_000);
  sendSteps(f.monitors, 11);
  await settle();
  expect(datalogReplies(f.writes, "ack")).toEqual([10, 10, 11, 11]);
  feedFrame(f.monitors, encodeDatalogFrame(encodeDatalogClose(11)));
  await settle();
  clock.fire(2_000);
  await expect(capture).resolves.toMatchObject({ status: "idle", receivedPackets: 2 });
});

test("an open session that goes silent fails capture as stalled instead of hanging", async () => {
  const clock = manualTimers();
  const f = await preparedTransport(clock.timers);
  const capture = f.session.capture({
    signal: new AbortController().signal,
    sink: async () => RECEIPT,
  });
  await settle();
  openStepsSession(f.monitors, 12);
  await settle();
  clock.fire(30_000);
  await expect(capture).resolves.toEqual({
    status: "failed",
    code: "PEBBLE_CAPTURE_STALLED",
    receivedPackets: 0,
    durableItems: 0,
    rejectedPackets: 0,
  });
});

test("a stall after delivered and rejected packets reports both counts", async () => {
  const clock = manualTimers();
  const f = await preparedTransport(clock.timers);
  const capture = f.session.capture({
    signal: new AbortController().signal,
    sink: async () => RECEIPT,
  });
  await settle();
  openStepsSession(f.monitors, 30);
  sendSteps(f.monitors, 30);
  sendSteps(f.monitors, 31); // never opened: health data left on the watch
  await settle();
  clock.fire(30_000);
  await expect(capture).resolves.toEqual({
    status: "failed",
    code: "PEBBLE_CAPTURE_STALLED",
    receivedPackets: 1,
    durableItems: 1,
    rejectedPackets: 1,
  });
});

test("foreign opens cannot crowd a health open out of the pre-capture buffer", async () => {
  const f = await preparedTransport(manualTimers().timers);
  for (let id = 100; id < 120; id += 1)
    feedFrame(
      f.monitors,
      encodeDatalogFrame(
        encodeDatalogOpenSession({
          id,
          uuid: "12345678-1234-1234-1234-123456789abc",
          timestamp: 1_700_000_040,
          logTag: 81,
          itemSize: 22,
          itemType: 0,
        }),
      ),
    );
  openStepsSession(f.monitors, 5);
  await settle();
  const capture = f.session.capture({
    signal: new AbortController().signal,
    sink: async () => RECEIPT,
  });
  await settle();
  expect(datalogReplies(f.writes, "ack")).toEqual([5]);
  await f.session.close();
  await capture;
});

test("foreign and unknown sessions are NACKed without failing capture", async () => {
  const clock = manualTimers();
  const f = await preparedTransport(clock.timers);
  let sinkCalls = 0;
  const capture = f.session.capture({
    signal: new AbortController().signal,
    sink: async () => {
      sinkCalls += 1;
      return RECEIPT;
    },
  });
  await settle();
  // Tag 85 (heart-rate stub upstream) and a third-party app's data log.
  feedFrame(
    f.monitors,
    encodeDatalogFrame(
      encodeDatalogOpenSession({
        id: 20,
        uuid: PEBBLE_UUID_ZERO,
        timestamp: 1_700_000_040,
        logTag: 85,
        itemSize: 22,
        itemType: 0,
      }),
    ),
  );
  feedFrame(
    f.monitors,
    encodeDatalogFrame(
      encodeDatalogOpenSession({
        id: 21,
        uuid: "12345678-1234-1234-1234-123456789abc",
        timestamp: 1_700_000_040,
        logTag: 81,
        itemSize: 22,
        itemType: 0,
      }),
    ),
  );
  await settle();
  sendSteps(f.monitors, 20);
  sendSteps(f.monitors, 21);
  sendSteps(f.monitors, 22); // never opened on this connection
  await settle();
  expect(datalogReplies(f.writes, "ack")).toEqual([20, 21]);
  expect(datalogReplies(f.writes, "nack")).toEqual([20, 21, 22]);
  expect(sinkCalls).toBe(0);
  // Health data still flows afterwards.
  openStepsSession(f.monitors, 23);
  sendSteps(f.monitors, 23);
  await settle();
  expect(sinkCalls).toBe(1);
  await f.session.close();
  await expect(capture).resolves.toEqual({ status: "cancelled" });
});

test("an unparseable packet is NACKed and counted, and capture continues", async () => {
  const clock = manualTimers();
  const f = await preparedTransport(clock.timers);
  const capture = f.session.capture({
    signal: new AbortController().signal,
    sink: async () => RECEIPT,
  });
  await settle();
  openStepsSession(f.monitors, 24);
  await settle();
  const bad = validStepsItem();
  bad[0] = 99; // unsupported record version
  feedFrame(
    f.monitors,
    encodeDatalogFrame(encodeDatalogSendData({ id: 24, itemsLeft: 0, crc: 0, data: bad })),
  );
  sendSteps(f.monitors, 24);
  feedFrame(f.monitors, encodeDatalogFrame(encodeDatalogClose(24)));
  await settle();
  clock.fire(2_000);
  await expect(capture).resolves.toEqual({
    status: "idle",
    receivedPackets: 1,
    durableItems: 1,
    rejectedPackets: 1,
  });
});

test("a session the watch opens before capture() starts is honoured once capture begins", async () => {
  const f = await preparedTransport(manualTimers().timers);
  openStepsSession(f.monitors, 3);
  await settle();
  expect(datalogReplies(f.writes, "ack")).toEqual([]);
  let sinkCalls = 0;
  const capture = f.session.capture({
    signal: new AbortController().signal,
    sink: async () => {
      sinkCalls += 1;
      return RECEIPT;
    },
  });
  await settle();
  expect(datalogReplies(f.writes, "ack")).toEqual([3]);
  sendSteps(f.monitors, 3);
  await settle();
  expect(sinkCalls).toBe(1);
  expect(datalogReplies(f.writes, "ack")).toEqual([3, 3]);
  await f.session.close();
  await capture;
});

test("a firmware reply that arrives before its request write settles is not lost", async () => {
  const fake = fakeDevice(339);
  const session = createDurablePebbleSession({
    device: fake.device as never,
    nativeId: "peer-1",
    timers: manualTimers().timers,
  });
  const firmware = new Uint8Array(47);
  firmware[46] = 15;
  let sawRequest = false;
  // The fake records a write only after the hook returns, so the request is
  // recognised by counting PPoGATT writes: magic reply first, then the request.
  let ppogattWrites = 0;
  fake.setWriteHook(async (characteristic) => {
    if (characteristic !== PEBBLE_PPOGATT_WRITE_UUID) return;
    ppogattWrites += 1;
    if (ppogattWrites !== 2) return;
    sawRequest = true;
    // Reply while the firmware request write is still pending.
    notify(fake.monitors, encodePpogattData(0, encodePebbleFrame(16, firmware)));
  });
  const preparing = session.prepare(new AbortController().signal);
  await settle();
  notify(fake.monitors, Uint8Array.of(0x02, 0x01));
  await settle();
  expect(sawRequest).toBe(true);
  await expect(preparing).resolves.toMatchObject({ hardwareId: 15 });
  expect(decodePebbleFrame(fake.writes.at(-2)!.value.slice(1))?.endpoint).toBe(16);
  await session.close();
});

test("an unsupported bond adapter refuses pairing without writing the pairing trigger", async () => {
  const fake = fakeDevice(339, 0x01);
  const session = createDurablePebbleSession({
    device: fake.device as never,
    nativeId: "ios-peer",
    bondAdapter: {
      getState: async () => "unsupported",
      ensureBonded: async () => {
        throw new Error("must not be called");
      },
      cancelWait: async () => undefined,
    },
  });
  await expect(session.prepare(new AbortController().signal)).rejects.toThrow(
    "PEBBLE_PAIRING_UNSUPPORTED",
  );
  expect(fake.writes).toHaveLength(0);
});

test("cancelling while the health-sync request is in flight leaves no capture timer armed", async () => {
  const clock = manualTimers();
  const f = await preparedTransport(clock.timers);
  let release!: () => void;
  f.setWriteHook(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const abort = new AbortController();
  const capture = f.session.capture({ signal: abort.signal, sink: async () => RECEIPT });
  await settle();
  abort.abort();
  release();
  await expect(capture).resolves.toEqual({ status: "cancelled" });
  await settle();
  expect(clock.pendingMs()).toEqual([]);
});

test("a full inbox is reported as PEBBLE_INBOX_FULL, not a generic storage failure", async () => {
  const f = await preparedTransport(manualTimers().timers);
  const capture = f.session.capture({
    signal: new AbortController().signal,
    sink: async () => {
      throw new Error("PEBBLE_INBOX_FULL");
    },
  });
  await settle();
  openStepsSession(f.monitors, 40);
  await settle();
  sendSteps(f.monitors, 40);
  await expect(capture).resolves.toEqual({ status: "failed", code: "PEBBLE_INBOX_FULL" });
  expect(datalogReplies(f.writes, "ack")).toEqual([40]);
});
