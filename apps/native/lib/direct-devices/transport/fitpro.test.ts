/**
 * Tests for the FitPro connection session.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { expect, test } from "bun:test";
import type { Characteristic } from "react-native-ble-plx";

import {
  FITPRO_HISTORY_WATCHDOG_MS,
  FITPRO_SERVICE_UUIDS,
  createFitProSession,
  selectFitProProfile,
  type FitProProfile,
  type FitProTimers,
} from "./fitpro";
import {
  FITPRO_NOTIFY_UUID,
  FITPRO_SERVICE_UUID,
  FITPRO_WRITE_UUID,
  type FitProModel,
} from "../models/fitpro";
import {
  FITPRO_CMD_FETCH_DATA,
  FITPRO_CMD_FETCH_END,
  FITPRO_CMD_FETCH_START,
  FITPRO_CMD_FETCH_TRIGGER,
  FITPRO_CMD_SLEEP_PER_DAY,
  FITPRO_CMD_STEPS_PER_DAY,
  buildFrame,
  parseAck,
  type FitProRecord,
} from "../protocol/fitpro";

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
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
  const timers: FitProTimers = {
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

async function tick(times = 8): Promise<void> {
  for (let index = 0; index < times; index += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

const NOW = new Date(2026, 10, 10, 12, 0, 0);

const model: Pick<FitProModel, "id" | "heartRateMeasurement"> = {
  id: "fitpro_m6",
  heartRateMeasurement: true,
};

const profile: FitProProfile = {
  modelId: "fitpro_m6",
  serviceUuid: FITPRO_SERVICE_UUID,
  writeUuid: FITPRO_WRITE_UUID,
  notifyUuid: FITPRO_NOTIFY_UUID,
  heartRateMeasurement: true,
};

function characteristic(uuid: string): Characteristic {
  return { uuid, isNotifiable: true, isIndicatable: false } as Characteristic;
}

function createSession(overrides: Partial<Parameters<typeof createFitProSession>[0]> = {}) {
  const fake = fakeDevice();
  const timers = fakeTimers();
  const records: FitProRecord[] = [];
  const failures: string[] = [];
  const session = createFitProSession({
    device: fake.device as never,
    profile,
    onRecord: (record) => records.push(record),
    onFailure: (failure) => failures.push(failure),
    now: () => NOW,
    timers: timers.timers,
    initialize: false,
    ...overrides,
  });
  return { session, records, failures, ...fake, ...timers };
}

function notifyFrame(monitors: ReturnType<typeof fakeDevice>["monitors"], frame: Uint8Array): void {
  const callback = monitors.get(`${FITPRO_SERVICE_UUID}|${FITPRO_NOTIFY_UUID}`)!;
  callback(null, { value: b64(frame) } as Characteristic);
}

/** Commands of the frames written to the band, in order. */
function commands(writes: readonly { value: Uint8Array }[]): number[] {
  return writes.map((write) => write.value[5]!);
}

/** The acknowledgement carried by the most recent write, if any. */
function lastAck(writes: readonly { value: Uint8Array }[]) {
  const last = writes.at(-1);
  return last ? parseAck(last.value) : null;
}

const DAY = [0x35, 0x6a]; // 2026-11-10
/** The two bytes upstream never reads between the date and the first record. */
const GAP = [0x00, 0x00];

function stepRecord(fields: {
  steps: number;
  durationUnits: number;
  distanceMeters: number;
  calories: number;
  activityKind: number;
  timeUnits: number;
}): number[] {
  const high =
    ((fields.steps & 0xfff) << 20) |
    ((fields.durationUnits & 0xf) << 16) |
    (fields.distanceMeters & 0xffff);
  const low =
    ((fields.timeUnits & 0x7ff) << 21) |
    ((fields.activityKind & 0x1) << 19) |
    (fields.calories & 0x7ffff);
  return [
    (high >>> 24) & 0xff,
    (high >>> 16) & 0xff,
    (high >>> 8) & 0xff,
    high & 0xff,
    (low >>> 24) & 0xff,
    (low >>> 16) & 0xff,
    (low >>> 8) & 0xff,
    low & 0xff,
  ];
}

function sleepRecord(kind: number, minutesOfDay: number): number[] {
  const data = ((minutesOfDay & 0xffff) << 16) | (kind & 0xff);
  return [(data >>> 24) & 0xff, (data >>> 16) & 0xff, (data >>> 8) & 0xff, data & 0xff];
}

function stepsFrame(): Uint8Array {
  return buildFrame(0x15, FITPRO_CMD_STEPS_PER_DAY, [
    ...DAY,
    ...GAP,
    ...stepRecord({
      steps: 120,
      durationUnits: 1,
      distanceMeters: 90,
      calories: 5,
      activityKind: 1,
      timeUnits: 40,
    }),
  ]);
}

function sleepFrame(): Uint8Array {
  return buildFrame(0x15, FITPRO_CMD_SLEEP_PER_DAY, [
    ...DAY,
    ...GAP,
    ...sleepRecord(2, 23 * 60),
    ...sleepRecord(1, 23 * 60 + 30),
    ...sleepRecord(2, 60),
    ...sleepRecord(1, 5 * 60),
  ]);
}

/** Walks the start/data/end markers the band sends before the per-day packets. */
async function completeTransferMarkers(fake: ReturnType<typeof createSession>): Promise<void> {
  for (const command of [FITPRO_CMD_FETCH_START, FITPRO_CMD_FETCH_DATA, FITPRO_CMD_FETCH_END]) {
    notifyFrame(fake.monitors, buildFrame(0x15, command, [0x01]));
    await tick(2);
  }
}

test("selectFitProProfile requires the cca9d service with both characteristics", async () => {
  const complete = {
    characteristicsForService: async (service: string) =>
      service === FITPRO_SERVICE_UUID
        ? [characteristic(FITPRO_WRITE_UUID), characteristic(FITPRO_NOTIFY_UUID)]
        : [],
  };
  expect(await selectFitProProfile(complete, [FITPRO_SERVICE_UUID], model)).toEqual(profile);
  expect(await selectFitProProfile(complete, [], model)).toBeNull();

  const missingNotify = {
    characteristicsForService: async () => [characteristic(FITPRO_WRITE_UUID)],
  };
  expect(await selectFitProProfile(missingNotify, [FITPRO_SERVICE_UUID], model)).toBeNull();
  const missingWrite = {
    characteristicsForService: async () => [characteristic(FITPRO_NOTIFY_UUID)],
  };
  expect(await selectFitProProfile(missingWrite, [FITPRO_SERVICE_UUID], model)).toBeNull();
  expect([...FITPRO_SERVICE_UUIDS]).toEqual([FITPRO_SERVICE_UUID]);
});

test("the profile keeps the model's heart-rate capability", async () => {
  const device = {
    characteristicsForService: async () => [
      characteristic(FITPRO_WRITE_UUID),
      characteristic(FITPRO_NOTIFY_UUID),
    ],
  };
  expect(
    await selectFitProProfile(device, [FITPRO_SERVICE_UUID], {
      id: "colacao_2021",
      heartRateMeasurement: false,
    }),
  ).toMatchObject({ modelId: "colacao_2021", heartRateMeasurement: false });
});

test("init primes the band, then the fetch trigger is written", async () => {
  const fake = createSession({ initialize: true });
  fake.session.start();
  await tick();

  const initCommands = commands(fake.writes);
  expect(initCommands.slice(0, 9)).toEqual([0x0a, 0x01, 0x0a, 0x0c, 0xff, 0x01, 0x0f, 0x10, 0x02]);
  expect(initCommands[9]).toBe(FITPRO_CMD_FETCH_TRIGGER);
  // The trigger is 0x15/0x06 with payload 01.
  const trigger = fake.writes[9]!.value;
  expect([...trigger]).toEqual([0xcd, 0x00, 0x06, 0x15, 0x01, 0x06, 0x00, 0x01, 0x01]);
  expect(fake.writes.every((write) => write.characteristic === FITPRO_WRITE_UUID)).toBe(true);
  await fake.session.close();
});

test("without init the trigger is the first write and only one phase is pending", async () => {
  const fake = createSession();
  fake.session.start();
  await tick();
  expect(commands(fake.writes)).toEqual([FITPRO_CMD_FETCH_TRIGGER]);
  expect(fake.pending).toHaveLength(1);
  await fake.session.close();
});

test("the fetch chain acks every packet and emits steps then sleep", async () => {
  const fake = createSession();
  fake.session.start();
  await tick();
  const triggerWrites = fake.writes.length;

  // Start / data / end markers are acked with their own total length.
  for (const command of [FITPRO_CMD_FETCH_START, FITPRO_CMD_FETCH_DATA, FITPRO_CMD_FETCH_END]) {
    const frame = buildFrame(0x15, command, [0x01]);
    notifyFrame(fake.monitors, frame);
    await tick(2);
    expect(lastAck(fake.writes)).toEqual({ group: 0x15, length: frame.length });
  }
  expect(fake.writes.length).toBe(triggerWrites + 3);
  expect(fake.records).toEqual([]);

  // Steps per day.
  const steps = stepsFrame();
  notifyFrame(fake.monitors, steps);
  await tick();
  expect(lastAck(fake.writes)).toEqual({ group: 0x15, length: steps.length });
  expect(fake.records).toHaveLength(1);
  expect(fake.records[0]).toEqual({
    type: "steps_interval",
    startTime: new Date(2026, 10, 10, 10, 0, 0).toISOString(),
    endTime: new Date(2026, 10, 10, 10, 15, 0).toISOString(),
    count: 120,
  });
  // The steps phase is settled, so the sleep phase is now waiting.
  expect(fake.pending).toHaveLength(1);

  // Sleep per day.
  const sleep = sleepFrame();
  const before = fake.writes.length;
  notifyFrame(fake.monitors, sleep);
  await tick();
  // The sleep packet is acked before the chain continues to the realtime write.
  expect(
    fake.writes
      .slice(before)
      .map((write) => parseAck(write.value))
      .filter((ack) => ack !== null)
      .map((ack) => ack!.length),
  ).toEqual([sleep.length]);
  const sessions = fake.records.filter((record) => record.type === "sleep_session");
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({
    startTime: new Date(2026, 10, 10, 23, 0, 0).toISOString(),
    // The last record only has its fixed 15-minute window.
    endTime: new Date(2026, 10, 11, 5, 15, 0).toISOString(),
  });

  // The chain is done: realtime heart rate was enabled and nothing is pending.
  // (The last write is 0x12/0x18; acks are 0xDC frames and are excluded here.)
  const lastWrite = fake.writes.at(-1)!.value;
  expect([lastWrite[0], lastWrite[3], lastWrite[5]]).toEqual([0xcd, 0x12, 0x18]);
  expect(fake.pending).toHaveLength(0);
  expect(fake.failures).toEqual([]);
  await fake.session.close();
});

test("a silent band trips the watchdog for each phase and the chain still finishes", async () => {
  const fake = createSession();
  fake.session.start();
  await tick();
  expect(fake.pending).toHaveLength(1);

  fake.pending.shift()!();
  await tick();
  expect(fake.failures).toEqual(["steps_interval"]);
  // The sleep phase is armed even though nothing arrived.
  expect(fake.pending).toHaveLength(1);

  fake.pending.shift()!();
  await tick();
  expect(fake.failures).toEqual(["steps_interval", "sleep_session"]);
  expect(FITPRO_HISTORY_WATCHDOG_MS).toBe(30_000);
  expect(commands(fake.writes)).toEqual([FITPRO_CMD_FETCH_TRIGGER, 0x18]);
  await fake.session.close();
});

test("every response re-arms the watchdog instead of letting it fire", async () => {
  const fake = createSession();
  fake.session.start();
  await tick();
  notifyFrame(fake.monitors, buildFrame(0x15, FITPRO_CMD_FETCH_START, [0x01]));
  await tick(2);
  // The original timer was cleared and replaced.
  expect(fake.pending).toHaveLength(1);
  expect(fake.failures).toEqual([]);
  await fake.session.close();
});

test("realtime heart-rate notifications become heart_rate records", async () => {
  const fake = createSession();
  fake.session.start();
  await tick();

  // Upstream sample: seconds 0x0000312c, hr value[19] = 0x47.
  const frame = Uint8Array.from([
    0xcd, 0x00, 0x11, 0x15, 0x01, 0x0e, 0x00, 0x0c, 0x2a, 0xf8, 0x00, 0x01, 0x00, 0x00, 0x31, 0x2c,
    0x62, 0x75, 0x54, 0x47,
  ]);
  notifyFrame(fake.monitors, frame);
  await tick();

  expect(lastAck(fake.writes)).toEqual({ group: 0x15, length: frame.length });
  expect(fake.records).toEqual([
    { type: "heart_rate", time: new Date(2026, 10, 10, 3, 29, 48).toISOString(), bpm: 0x47 },
  ]);
  // A heart-rate packet does not settle the fetch phase.
  expect(fake.pending).toHaveLength(1);
  expect(fake.failures).toEqual([]);
  await fake.session.close();
});

test("a zero heart rate is acked but not recorded", async () => {
  const fake = createSession();
  fake.session.start();
  await tick();
  const frame = Uint8Array.from([
    0xcd, 0x00, 0x11, 0x15, 0x01, 0x0e, 0x00, 0x0c, 0x2a, 0xf8, 0x00, 0x01, 0x00, 0x00, 0x31, 0x2c,
    0x62, 0x75, 0x54, 0x00,
  ]);
  notifyFrame(fake.monitors, frame);
  await tick();
  expect(fake.records).toEqual([]);
  expect(lastAck(fake.writes)?.group).toBe(0x15);
  await fake.session.close();
});

test("a step packet split across notifications is reassembled before parsing", async () => {
  const fake = createSession();
  fake.session.start();
  await tick();

  const frame = buildFrame(0x15, FITPRO_CMD_STEPS_PER_DAY, [
    ...DAY,
    ...GAP,
    ...stepRecord({
      steps: 60,
      durationUnits: 1,
      distanceMeters: 40,
      calories: 2,
      activityKind: 0,
      timeUnits: 8,
    }),
    ...stepRecord({
      steps: 120,
      durationUnits: 1,
      distanceMeters: 90,
      calories: 5,
      activityKind: 1,
      timeUnits: 40,
    }),
  ]);
  expect(frame.length).toBeGreaterThan(20);
  for (let offset = 0; offset < frame.length; offset += 20) {
    notifyFrame(fake.monitors, frame.subarray(offset, offset + 20));
    await tick(2);
  }
  expect(fake.records).toHaveLength(2);
  expect(fake.records.map((record) => record.type === "steps_interval" && record.count)).toEqual([
    60, 120,
  ]);
  await fake.session.close();
});

test("models without heart-rate measurement never enable the realtime stream", async () => {
  const fake = createSession({
    profile: { ...profile, modelId: "colacao_2021", heartRateMeasurement: false },
  });
  fake.session.start();
  await tick();
  await completeTransferMarkers(fake);
  notifyFrame(fake.monitors, stepsFrame());
  await tick();
  notifyFrame(fake.monitors, sleepFrame());
  await tick();
  expect(commands(fake.writes)).not.toContain(0x18);
  expect(fake.pending).toHaveLength(0);
  await fake.session.close();
});

test("close settles the in-flight phase and ignores later notifications", async () => {
  const fake = createSession();
  fake.session.start();
  await tick();
  await fake.session.close();
  const writesBefore = fake.writes.length;
  notifyFrame(fake.monitors, stepsFrame());
  await tick();
  expect(fake.records).toEqual([]);
  expect(fake.writes).toHaveLength(writesBefore);
  expect(fake.pending).toHaveLength(0);
});

test("a failed write reports an init failure instead of throwing", async () => {
  const fake = createSession();
  const failing = {
    monitorCharacteristicForService: fake.device.monitorCharacteristicForService,
    writeCharacteristicWithResponseForService: async () => {
      throw new Error("FITPRO_WRITE_FAILED");
    },
  };
  const failures: string[] = [];
  const session = createFitProSession({
    device: failing as never,
    profile,
    onRecord: () => undefined,
    onFailure: (failure) => failures.push(failure),
    now: () => NOW,
    timers: fake.timers,
    initialize: false,
  });
  session.start();
  await tick();
  expect(failures).toContain("steps_interval");
  await session.close();
});
