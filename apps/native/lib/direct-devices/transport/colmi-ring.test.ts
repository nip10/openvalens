/**
 * Tests for the Colmi / Yawell ring connection session.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { expect, test } from "bun:test";
import type { Characteristic } from "react-native-ble-plx";

import {
  COLMI_HISTORY_WATCHDOG_MS,
  COLMI_REALTIME_KEEPALIVE_PACKETS,
  createColmiRingSession,
  selectColmiRingProfile,
  type ColmiRingProfile,
  type ColmiRingTimers,
} from "./colmi-ring";
import {
  COLMI_V1_NOTIFY_UUID,
  COLMI_V1_SERVICE_UUID,
  COLMI_V1_WRITE_UUID,
  COLMI_V2_COMMAND_UUID,
  COLMI_V2_NOTIFY_UUID,
  COLMI_V2_SERVICE_UUID,
} from "../models/colmi-ring";
import {
  SLEEP_HISTORY_REQUEST,
  buildBigDataV2Packet,
  buildDateTimePacket,
  buildHeartRateHistoryRequestPacket,
  buildRealtimeHeartRatePacket,
  type ColmiRingRecord,
} from "../protocol/colmi-ring";

function b64(bytes: readonly number[]): string {
  return Buffer.from(Uint8Array.from(bytes)).toString("base64");
}

function fakeDevice() {
  const monitors = new Map<string, (error: unknown, value: Characteristic | null) => void>();
  const writes: { service: string; characteristic: string; value: Uint8Array }[] = [];
  const device = {
    monitorCharacteristicForService: (
      service: string,
      characteristic: string,
      callback: (error: unknown, value: Characteristic | null) => void,
    ) => {
      monitors.set(`${service}|${characteristic}`, callback);
      return { remove() {} };
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
  return { device, monitors, writes };
}

function fakeTimers() {
  const pending: (() => void)[] = [];
  const timers: ColmiRingTimers = {
    setTimeout(callback) {
      pending.push(callback);
      return callback;
    },
    clearTimeout(handle) {
      const index = pending.indexOf(handle as () => void);
      if (index >= 0) pending.splice(index, 1);
    },
  };
  return { timers, pending };
}

async function tick(times = 4): Promise<void> {
  for (let index = 0; index < times; index += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Fires queued watchdogs until the chain stops producing writes. */
async function driveWatchdogs(pending: (() => void)[], writes: unknown[], expected: number) {
  for (let round = 0; round < 200 && writes.length < expected; round += 1) {
    const queued = pending.splice(0, pending.length);
    for (const callback of queued) callback();
    await tick(2);
  }
}

const v1Profile: ColmiRingProfile = {
  modelId: "colmi_r02",
  v1ServiceUuid: COLMI_V1_SERVICE_UUID,
  v1WriteUuid: COLMI_V1_WRITE_UUID,
  v1NotifyUuid: COLMI_V1_NOTIFY_UUID,
  v2ServiceUuid: null,
  v2CommandUuid: null,
  v2NotifyUuid: null,
};

const v2Profile: ColmiRingProfile = {
  ...v1Profile,
  v2ServiceUuid: COLMI_V2_SERVICE_UUID,
  v2CommandUuid: COLMI_V2_COMMAND_UUID,
  v2NotifyUuid: COLMI_V2_NOTIFY_UUID,
};

function characteristic(uuid: string): Characteristic {
  return { uuid, isNotifiable: true, isIndicatable: false } as Characteristic;
}

test("selectColmiRingProfile requires the V1 write and notify characteristics", async () => {
  const complete = {
    characteristicsForService: async (service: string) =>
      service === COLMI_V1_SERVICE_UUID
        ? [characteristic(COLMI_V1_WRITE_UUID), characteristic(COLMI_V1_NOTIFY_UUID)]
        : [],
  };
  expect(await selectColmiRingProfile(complete, [COLMI_V1_SERVICE_UUID], "colmi_r02")).toEqual({
    modelId: "colmi_r02",
    v1ServiceUuid: COLMI_V1_SERVICE_UUID,
    v1WriteUuid: COLMI_V1_WRITE_UUID,
    v1NotifyUuid: COLMI_V1_NOTIFY_UUID,
    v2ServiceUuid: null,
    v2CommandUuid: null,
    v2NotifyUuid: null,
  });

  const missingNotify = {
    characteristicsForService: async () => [characteristic(COLMI_V1_WRITE_UUID)],
  };
  expect(
    await selectColmiRingProfile(missingNotify, [COLMI_V1_SERVICE_UUID], "colmi_r02"),
  ).toBeNull();
  expect(await selectColmiRingProfile(complete, [], "colmi_r02")).toBeNull();
});

test("selectColmiRingProfile picks the V2 big-data characteristics when present", async () => {
  const device = {
    characteristicsForService: async (service: string) =>
      service === COLMI_V1_SERVICE_UUID
        ? [characteristic(COLMI_V1_WRITE_UUID), characteristic(COLMI_V1_NOTIFY_UUID)]
        : service === COLMI_V2_SERVICE_UUID
          ? [characteristic(COLMI_V2_COMMAND_UUID), characteristic(COLMI_V2_NOTIFY_UUID)]
          : [],
  };
  expect(
    await selectColmiRingProfile(
      device,
      [COLMI_V1_SERVICE_UUID, COLMI_V2_SERVICE_UUID],
      "colmi_r02",
    ),
  ).toMatchObject({
    v2ServiceUuid: COLMI_V2_SERVICE_UUID,
    v2CommandUuid: COLMI_V2_COMMAND_UUID,
    v2NotifyUuid: COLMI_V2_NOTIFY_UUID,
  });
});

test("the init sequence writes phone name, date/time, preferences and battery in order", async () => {
  const { device, writes } = fakeDevice();
  const { timers } = fakeTimers();
  const now = new Date(2026, 10, 10, 23, 4, 5);
  const session = createColmiRingSession({
    device: device as never,
    profile: v1Profile,
    onRecord: () => undefined,
    now: () => now,
    timers,
    initDelayMs: 0,
    activityDays: 0,
    heartRateDays: 0,
    realtimeHeartRate: false,
  });
  session.start();
  await tick(8);

  expect(writes.map((write) => write.value[0])).toEqual([0x04, 0x01, 0x0a, 0x03]);
  expect(writes.every((write) => write.characteristic === COLMI_V1_WRITE_UUID)).toBe(true);
  expect(Array.from(writes[0]!.value.slice(0, 5))).toEqual([0x04, 0x02, 0x0a, 0x47, 0x42]);
  expect(Array.from(writes[1]!.value.slice(0, 7))).toEqual([
    0x01, 0x26, 0x11, 0x10, 0x23, 0x04, 0x05,
  ]);
  expect([...writes[1]!.value]).toEqual([...buildDateTimePacket(now)]);
  await session.close();
});

test("the history chain runs activity days, then heart-rate days, then sleep", async () => {
  const { device, writes } = fakeDevice();
  const { timers, pending } = fakeTimers();
  const failures: string[] = [];
  const now = new Date(2026, 10, 10, 12, 0, 0);
  const session = createColmiRingSession({
    device: device as never,
    profile: v2Profile,
    onRecord: () => undefined,
    onFailure: (failure) => failures.push(failure),
    now: () => now,
    timers,
    initDelayMs: 0,
  });
  session.start();
  // 4 init + 8 activity + 8 heart rate + 1 sleep + 1 realtime enable.
  await driveWatchdogs(pending, writes, 22);

  expect(writes).toHaveLength(22);
  const activity = writes.slice(4, 12);
  expect(activity.map((write) => write.value[1])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(activity.every((write) => write.value[0] === 0x43)).toBe(true);
  const heartRate = writes.slice(12, 20);
  expect(heartRate.every((write) => write.value[0] === 0x15)).toBe(true);
  expect(Array.from(heartRate[0]!.value.slice(0, 6))).toEqual(
    [...buildHeartRateHistoryRequestPacket(new Date(2026, 10, 10))].slice(0, 6),
  );
  expect(writes[20]!.service).toBe(COLMI_V2_SERVICE_UUID);
  expect(writes[20]!.characteristic).toBe(COLMI_V2_COMMAND_UUID);
  expect([...writes[20]!.value]).toEqual([...SLEEP_HISTORY_REQUEST]);
  expect(Array.from(writes[21]!.value.slice(0, 2))).toEqual([0x1e, 0x01]);
  // Every request timed out: 8 activity + 8 heart rate + 1 sleep.
  expect(failures.filter((failure) => failure === "steps_interval")).toHaveLength(8);
  expect(failures.filter((failure) => failure === "heart_rate")).toHaveLength(8);
  expect(failures.filter((failure) => failure === "sleep_session")).toHaveLength(1);
  await session.close();
});

test("the watchdog aborts a silent request and the chain continues", async () => {
  const { device, writes } = fakeDevice();
  const { timers, pending } = fakeTimers();
  const failures: string[] = [];
  const session = createColmiRingSession({
    device: device as never,
    profile: v1Profile,
    onRecord: () => undefined,
    onFailure: (failure) => failures.push(failure),
    timers,
    initDelayMs: 0,
    activityDays: 1,
    heartRateDays: 1,
    realtimeHeartRate: false,
    watchdogMs: COLMI_HISTORY_WATCHDOG_MS,
  });
  session.start();
  await driveWatchdogs(pending, writes, 6);
  for (const callback of pending.splice(0)) callback();
  await tick(4);
  expect(writes.map((write) => write.value[0])).toEqual([0x04, 0x01, 0x0a, 0x03, 0x43, 0x15]);
  expect(failures).toEqual(["steps_interval", "heart_rate"]);
  await session.close();
});

test("realtime heart rate emits records and sends the 30-packet keepalive", async () => {
  const { device, monitors, writes } = fakeDevice();
  const { timers } = fakeTimers();
  const records: ColmiRingRecord[] = [];
  const now = new Date(2026, 10, 10, 12, 0, 0);
  const session = createColmiRingSession({
    device: device as never,
    profile: v1Profile,
    onRecord: (record) => records.push(record),
    now: () => now,
    timers,
    initDelayMs: 0,
    activityDays: 0,
    heartRateDays: 0,
  });
  session.start();
  await tick(8);
  // Init (4) + realtime enable (1).
  expect(writes).toHaveLength(5);
  expect(Array.from(writes[4]!.value.slice(0, 2))).toEqual(
    Array.from(buildRealtimeHeartRatePacket(true).slice(0, 2)),
  );

  const notify = monitors.get(`${COLMI_V1_SERVICE_UUID}|${COLMI_V1_NOTIFY_UUID}`)!;
  for (let index = 0; index < COLMI_REALTIME_KEEPALIVE_PACKETS; index += 1)
    notify(null, { value: b64([0x1e, 60 + index]) } as Characteristic);
  expect(records).toHaveLength(COLMI_REALTIME_KEEPALIVE_PACKETS);
  expect(records[0]).toEqual({ type: "heart_rate", time: now.toISOString(), bpm: 60 });
  expect(writes).toHaveLength(6);
  expect(Array.from(writes[5]!.value.slice(0, 2))).toEqual([0x1e, 0x03]);
  await session.close();
});

test("a fragmented sleep frame is reassembled and parsed", async () => {
  const { device, monitors, writes } = fakeDevice();
  const { timers } = fakeTimers();
  const records: ColmiRingRecord[] = [];
  const now = new Date(2026, 10, 10, 12, 0, 0);
  const session = createColmiRingSession({
    device: device as never,
    profile: v2Profile,
    onRecord: (record) => records.push(record),
    now: () => now,
    timers,
    initDelayMs: 0,
    activityDays: 0,
    heartRateDays: 0,
  });
  session.start();
  await tick(8);
  expect(writes).toHaveLength(5); // init + sleep request

  // One day, 01:00-02:00, one 30-minute light stage.
  const payload = Uint8Array.from([1, 0, 8, 0x3c, 0x00, 0x78, 0x00, 0x02, 0x1e]);
  const frame = buildBigDataV2Packet(0x27, payload);
  const notify = monitors.get(`${COLMI_V2_SERVICE_UUID}|${COLMI_V2_NOTIFY_UUID}`)!;
  notify(null, { value: b64(Array.from(frame.slice(0, 5))) } as Characteristic);
  expect(records).toHaveLength(0);
  notify(null, { value: b64(Array.from(frame.slice(5))) } as Characteristic);

  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    type: "sleep_session",
    startTime: new Date(2026, 10, 10, 1, 0, 0).toISOString(),
    endTime: new Date(2026, 10, 10, 2, 0, 0).toISOString(),
  });
  // The chain continues to realtime heart rate after the sleep response.
  await tick(8);
  expect(writes).toHaveLength(6);
  expect(Array.from(writes[5]!.value.slice(0, 2))).toEqual([0x1e, 0x01]);
  await session.close();
});

test("an empty activity response completes the day without the watchdog", async () => {
  const { device, monitors, writes } = fakeDevice();
  const { timers, pending } = fakeTimers();
  const failures: string[] = [];
  const session = createColmiRingSession({
    device: device as never,
    profile: v1Profile,
    onRecord: () => undefined,
    onFailure: (failure) => failures.push(failure),
    timers,
    initDelayMs: 0,
    activityDays: 1,
    heartRateDays: 0,
    realtimeHeartRate: false,
  });
  session.start();
  await tick(8);
  expect(writes).toHaveLength(5);
  expect(pending).toHaveLength(1);

  const notify = monitors.get(`${COLMI_V1_SERVICE_UUID}|${COLMI_V1_NOTIFY_UUID}`)!;
  notify(null, { value: b64([0x43, 0xff, ...Array(14).fill(0)]) } as Characteristic);
  await tick(4);

  expect(failures).toEqual([]);
  expect(pending).toHaveLength(0);
  await session.close();
});
