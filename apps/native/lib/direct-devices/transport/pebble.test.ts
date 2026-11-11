/**
 * Tests for the Pebble connection session.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { expect, test } from "bun:test";
import type { BleError, Characteristic, Subscription } from "react-native-ble-plx";

import {
  PEBBLE_SERVICE_UUIDS,
  PEBBLE_SYNC_QUIET_MS,
  PEBBLE_SYNC_WATCHDOG_MS,
  clampPebbleMtuLimit,
  createPebbleSession,
  selectPebbleProfile,
  type PebbleProfile,
  type PebbleTimers,
} from "./pebble";
import { PEBBLE_SERVICE_UUID, type PebbleModel } from "../models/pebble";
import {
  PEBBLE_ENDPOINT_DATALOG,
  PEBBLE_ENDPOINT_FIRMWARE_VERSION,
  PEBBLE_ENDPOINT_HEALTH_SYNC,
  PEBBLE_PPOGATT_READ_UUID,
  PEBBLE_PPOGATT_SERVICE_UUID,
  PEBBLE_PPOGATT_WRITE_UUID,
  PEBBLE_SLEEP_TYPE_DEEP_SLEEP,
  PEBBLE_SLEEP_TYPE_LIGHT_SLEEP,
  PEBBLE_UUID_ZERO,
  chunkPpogatt,
  decodeDatalogPayload,
  decodePebbleFrame,
  decodePpogattHeader,
  encodeDatalogClose,
  encodeDatalogFrame,
  encodeDatalogOpenSession,
  encodeDatalogSendData,
  encodeDatalogTimeout,
  type PebbleRecord,
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

function fakeDevice(initialMtu = 339) {
  const monitors = new Map<
    string,
    (error: BleError | null, value: Characteristic | null) => void
  >();
  const writes: { service: string; characteristic: string; value: Uint8Array }[] = [];
  const characteristics = new Map<string, string[]>();
  let mtu = initialMtu;
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
      writes.push({
        service,
        characteristic,
        value: Uint8Array.from(Buffer.from(value, "base64")),
      });
      return {} as Characteristic;
    },
  };
  return { device, monitors, writes, characteristics };
}

function fakeTimers() {
  let next = 1;
  let now = 0;
  const pending = new Map<number, { callback: () => void; at: number }>();
  const timers: PebbleTimers = {
    setTimeout(callback, ms) {
      const id = next++;
      pending.set(id, { callback, at: now + ms });
      return id;
    },
    clearTimeout(handle) {
      pending.delete(handle as number);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    let ran = true;
    while (ran) {
      ran = false;
      for (const [id, timer] of pending) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.callback();
          ran = true;
        }
      }
    }
  };
  return { timers, advance, pendingCount: () => pending.size };
}

function feed(
  monitors: Map<string, (error: BleError | null, value: Characteristic | null) => void>,
  frame: Uint8Array,
  mtu = 339,
) {
  const callback = monitors.get(`${PEBBLE_PPOGATT_SERVICE_UUID}|${PEBBLE_PPOGATT_READ_UUID}`);
  if (!callback) throw new Error("TEST_MONITOR_MISSING");
  for (const packet of chunkPpogatt(frame, mtu))
    callback(null, { value: Buffer.from(packet).toString("base64") } as Characteristic);
}

function stepsPacket(version: number, timestamp: number, steps: readonly number[]): Uint8Array {
  const recordLength = version >= 7 ? 13 : 12;
  const out = new Uint8Array(9 + recordLength * steps.length);
  out[0] = version;
  out[1] = 0;
  out[2] = timestamp & 0xff;
  out[3] = (timestamp >>> 8) & 0xff;
  out[4] = (timestamp >>> 16) & 0xff;
  out[5] = (timestamp >>> 24) & 0xff;
  out[7] = recordLength;
  out[8] = steps.length;
  steps.forEach((count, index) => {
    const offset = 9 + index * recordLength;
    out[offset] = count;
    out[offset + 1] = 0;
    out[offset + 2] = 0;
    out[offset + 3] = 0;
    out[offset + 4] = 0;
    if (version >= 5) out[offset + 5] = 0;
    if (version >= 7) out[offset + 12] = 70 + index;
  });
  return out;
}

function sleepRecord(start: number, end: number): Uint8Array {
  return Uint8Array.from([1, 0, 0, 0, 0, 0, ...i32(start), ...i32(end), ...i32(3600)]);
}

function overlayRecord(type: number, start: number, duration: number): Uint8Array {
  return Uint8Array.from([1, 0, 0, 0, ...u16(type), 0, 0, 0, 0, ...i32(start), ...i32(duration)]);
}

function i32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the session negotiates the MTU and sends the health-enable chain", async () => {
  const { device, monitors, writes } = fakeDevice(339);
  const failures: string[] = [];
  const session = createPebbleSession({
    device,
    profile: PROFILE,
    onRecord: () => undefined,
    onFailure: (failure) => failures.push(failure),
    healthProfile: HEALTH_PROFILE,
  });
  session.start();
  await tick();

  expect(monitors.size).toBe(1);
  // firmware version, activate health, activate HRM, health sync.
  expect(writes.length).toBe(4);
  const endpoints = writes.map((write) => {
    const packet = write.value;
    const header = decodePpogattHeader(packet[0]!);
    expect(header.command).toBe(0);
    return decodePebbleFrame(packet.slice(1))!.endpoint;
  });
  expect(endpoints).toEqual([
    PEBBLE_ENDPOINT_FIRMWARE_VERSION,
    0xb1db,
    0xb1db,
    PEBBLE_ENDPOINT_HEALTH_SYNC,
  ]);
  expect(failures).toEqual([]);
  await session.close();
});

test("an end-to-end sync emits steps, heart rate and staged sleep", async () => {
  const { device, monitors, writes } = fakeDevice(339);
  const { timers, advance } = fakeTimers();
  const records: PebbleRecord[] = [];
  const failures: string[] = [];
  const session = createPebbleSession({
    device,
    profile: PROFILE,
    onRecord: (record) => records.push(record),
    onFailure: (failure) => failures.push(failure),
    timers,
  });
  session.start();
  await tick();
  const writesBefore = writes.length;

  const start = 1_700_000_000;
  const steps = stepsPacket(7, start, [10, 20]);

  // Steps session: open, send, close.
  feed(
    monitors,
    encodeDatalogFrame(
      encodeDatalogOpenSession({
        id: 1,
        uuid: PEBBLE_UUID_ZERO,
        timestamp: start,
        logTag: 81,
        itemType: 0,
        itemSize: steps.length,
      }),
    ),
  );
  feed(
    monitors,
    encodeDatalogFrame(encodeDatalogSendData({ id: 1, itemsLeft: 0, crc: 0, data: steps })),
  );
  feed(monitors, encodeDatalogFrame(encodeDatalogClose(1)));
  await tick();

  // Sleep bounds (tag 83) and overlays (tag 84) arrive as separate sessions.
  const bounds = sleepRecord(start, start + 8 * 3600);
  feed(
    monitors,
    encodeDatalogFrame(
      encodeDatalogOpenSession({
        id: 2,
        uuid: PEBBLE_UUID_ZERO,
        timestamp: start,
        logTag: 83,
        itemType: 0,
        itemSize: bounds.length,
      }),
    ),
  );
  feed(
    monitors,
    encodeDatalogFrame(encodeDatalogSendData({ id: 2, itemsLeft: 0, crc: 0, data: bounds })),
  );
  feed(monitors, encodeDatalogFrame(encodeDatalogClose(2)));

  const overlays = Uint8Array.from([
    ...overlayRecord(PEBBLE_SLEEP_TYPE_LIGHT_SLEEP, start, 3600),
    ...overlayRecord(PEBBLE_SLEEP_TYPE_DEEP_SLEEP, start + 3600, 1800),
  ]);
  feed(
    monitors,
    encodeDatalogFrame(
      encodeDatalogOpenSession({
        id: 3,
        uuid: PEBBLE_UUID_ZERO,
        timestamp: start,
        logTag: 84,
        itemType: 0,
        itemSize: 18,
      }),
    ),
  );
  feed(
    monitors,
    encodeDatalogFrame(encodeDatalogSendData({ id: 3, itemsLeft: 0, crc: 0, data: overlays })),
  );
  feed(monitors, encodeDatalogFrame(encodeDatalogClose(3)));
  await tick();

  // The quiet window finishes the sync and flushes the combined sleep record.
  advance(PEBBLE_SYNC_QUIET_MS);
  await session.whenDone();
  await tick();

  const stepsRecords = records.filter((record) => record.type === "steps");
  expect(stepsRecords).toHaveLength(2);
  expect(stepsRecords[0]).toEqual({
    type: "steps",
    startTime: new Date(start * 1000).toISOString(),
    endTime: new Date((start + 60) * 1000).toISOString(),
    count: 10,
  });
  expect(stepsRecords[1]).toMatchObject({ count: 20 });

  const heartRate = records.filter((record) => record.type === "heart_rate");
  expect(heartRate.map((record) => (record as { bpm: number }).bpm)).toEqual([70, 71]);

  const sleep = records.filter((record) => record.type === "sleep_session");
  expect(sleep).toHaveLength(1);
  expect(sleep[0]).toMatchObject({
    type: "sleep_session",
    startTime: new Date(start * 1000).toISOString(),
    endTime: new Date((start + 8 * 3600) * 1000).toISOString(),
  });
  expect((sleep[0] as { stages?: unknown[] }).stages).toHaveLength(2);

  // Every inbound data packet was ACKed, starting at serial 0.
  const acks = writes
    .slice(writesBefore)
    .map((write) => write.value)
    .filter((packet) => decodePpogattHeader(packet[0]!).command === 1);
  expect(acks.length).toBeGreaterThanOrEqual(9);
  expect(acks[0]![0]).toBe(0x01);

  expect(failures).toEqual([]);
  await session.close();
});

test("the watchdog reports a silent watch and settles the session", async () => {
  const { device } = fakeDevice(339);
  const { timers, advance } = fakeTimers();
  const failures: string[] = [];
  const session = createPebbleSession({
    device,
    profile: PROFILE,
    onRecord: () => undefined,
    onFailure: (failure) => failures.push(failure),
    timers,
  });
  session.start();
  await tick();
  advance(PEBBLE_SYNC_WATCHDOG_MS);
  await session.whenDone();
  // The chain reaches the sync phase before the watchdog fires.
  expect(failures).toEqual(["sync"]);
  await session.close();
});

test("the MTU limit clamps the outbound chunk size", async () => {
  const { device, writes } = fakeDevice(339);
  const session = createPebbleSession({
    device,
    profile: { ...PROFILE, mtuLimit: 20 },
    onRecord: () => undefined,
    healthProfile: HEALTH_PROFILE,
  });
  session.start();
  await tick();
  // 17-byte chunks: firmware 5 -> 1, health enable 39 -> 3, HRM 22 -> 2,
  // health sync 9 -> 1.
  expect(writes).toHaveLength(7);
  expect(writes[0]!.value.length).toBe(6);
  await session.close();
});

test("command 2 is answered with the magic response", async () => {
  const { device, monitors, writes } = fakeDevice(339);
  const session = createPebbleSession({ device, profile: PROFILE, onRecord: () => undefined });
  session.start();
  await tick();
  const before = writes.length;
  const callback = monitors.get(`${PEBBLE_PPOGATT_SERVICE_UUID}|${PEBBLE_PPOGATT_READ_UUID}`)!;
  callback(null, { value: Buffer.from([0x0a, 0x00]).toString("base64") } as Characteristic);
  await tick();
  expect(writes.length).toBe(before + 1);
  expect([...writes.at(-1)!.value]).toEqual([0x03, 0x19, 0x19]);
  await session.close();
});

test("DATALOG TIMEOUT is answered with a NACK", async () => {
  const { device, monitors, writes } = fakeDevice(339);
  const session = createPebbleSession({ device, profile: PROFILE, onRecord: () => undefined });
  session.start();
  await tick();
  const before = writes.length;
  feed(
    monitors,
    encodeDatalogFrame(
      encodeDatalogOpenSession({
        id: 9,
        uuid: PEBBLE_UUID_ZERO,
        timestamp: 0,
        logTag: 81,
        itemType: 0,
        itemSize: 22,
      }),
    ),
  );
  feed(monitors, encodeDatalogFrame(encodeDatalogTimeout(9)));
  await tick();
  const replies = writes
    .slice(before)
    .map((write) => write.value)
    .filter((packet) => decodePpogattHeader(packet[0]!).command === 0)
    .map((packet) => decodeDatalogPayload(decodePebbleFrame(packet.slice(1))!.payload));
  expect(replies.at(-1)).toEqual({ command: "nack", id: 9 });
  await session.close();
});

test("an unknown session SENDDATA is NACKed", async () => {
  const { device, monitors, writes } = fakeDevice(339);
  const session = createPebbleSession({ device, profile: PROFILE, onRecord: () => undefined });
  session.start();
  await tick();
  const before = writes.length;
  feed(
    monitors,
    encodeDatalogFrame(
      encodeDatalogSendData({ id: 11, itemsLeft: 0, crc: 0, data: Uint8Array.from([1]) }),
    ),
  );
  await tick();
  const reply = decodeDatalogPayload(decodePebbleFrame(writes.at(-1)!.value.slice(1))!.payload);
  expect(reply).toEqual({ command: "nack", id: 11 });
  // One PPoGATT ACK plus the DATALOG NACK.
  expect(writes.length).toBe(before + 2);
  await session.close();
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
