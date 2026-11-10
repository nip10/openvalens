/**
 * Tests for the Moyoung / Da Fit connection session.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { expect, test } from "bun:test";
import type { Characteristic } from "react-native-ble-plx";

import {
  MOYOUNG_HISTORY_WATCHDOG_MS,
  MOYOUNG_MTU_OVERHEAD,
  MOYOUNG_SERVICE_UUIDS,
  createMoyoungSession,
  selectMoyoungProfile,
  type MoyoungProfile,
  type MoyoungTimers,
} from "./moyoung";
import {
  MOYOUNG_DATA_IN_UUID,
  MOYOUNG_DATA_OUT_UUID,
  MOYOUNG_SERVICE_UUID,
  type MoyoungModel,
} from "../models/moyoung";
import {
  MOYOUNG_CMD_QUERY_PAST_HEART_RATE_1MIN,
  MOYOUNG_CMD_QUERY_PAST_HEART_RATE_5MIN,
  MOYOUNG_CMD_SYNC_PAST_SLEEP_AND_STEP,
  MOYOUNG_CMD_SYNC_SLEEP,
  MOYOUNG_CMD_SYNC_TIME,
  buildPacket,
  type MoyoungRecord,
} from "../protocol/moyoung";

function b64(bytes: readonly number[]): string {
  return Buffer.from(Uint8Array.from(bytes)).toString("base64");
}

function fakeDevice() {
  const monitors = new Map<string, (error: unknown, value: Characteristic | null) => void>();
  const writes: { service: string; characteristic: string; value: Uint8Array }[] = [];
  const mtuRequests: number[] = [];
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
    requestMTU: async (mtu: number) => {
      mtuRequests.push(mtu);
      return {} as never;
    },
  };
  return { device, monitors, writes, mtuRequests };
}

function fakeTimers() {
  const pending: (() => void)[] = [];
  const timers: MoyoungTimers = {
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

async function tick(times = 6): Promise<void> {
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

const NOW = new Date(2026, 10, 10, 12, 0, 0);

const l70: Pick<MoyoungModel, "id" | "mtu" | "supportsHeartRateHistory"> = {
  id: "moyoung_l70",
  mtu: 508,
  supportsHeartRateHistory: true,
};

const p22b1: Pick<MoyoungModel, "id" | "mtu" | "supportsHeartRateHistory"> = {
  id: "moyoung_p22b1",
  mtu: 20,
  supportsHeartRateHistory: false,
};

const profile: MoyoungProfile = {
  modelId: "moyoung_l70",
  serviceUuid: MOYOUNG_SERVICE_UUID,
  writeUuid: MOYOUNG_DATA_OUT_UUID,
  notifyUuid: MOYOUNG_DATA_IN_UUID,
  mtu: 508,
  supportsHeartRateHistory: true,
};

function characteristic(uuid: string): Characteristic {
  return { uuid, isNotifiable: true, isIndicatable: false } as Characteristic;
}

function createSession(overrides: Partial<Parameters<typeof createMoyoungSession>[0]> = {}) {
  const fake = fakeDevice();
  const timers = fakeTimers();
  const records: MoyoungRecord[] = [];
  const failures: string[] = [];
  const session = createMoyoungSession({
    device: fake.device as never,
    profile,
    onRecord: (record) => records.push(record),
    onFailure: (failure) => failures.push(failure),
    now: () => NOW,
    timers: timers.timers,
    ...overrides,
  });
  return { session, records, failures, ...fake, ...timers };
}

function notify(
  monitors: ReturnType<typeof fakeDevice>["monitors"],
  command: number,
  payload: readonly number[] = [],
  mtu = 508,
): void {
  const callback = monitors.get(`${MOYOUNG_SERVICE_UUID}|${MOYOUNG_DATA_IN_UUID}`)!;
  const packet = buildPacket(mtu, command, payload);
  callback(null, { value: b64(Array.from(packet)) } as Characteristic);
}

function commands(writes: readonly { value: Uint8Array }[]): number[] {
  return writes.map((write) => write.value[4]!);
}

/**
 * Answers the three sleep requests with empty payloads so the chain reaches the
 * heart-rate requests without tripping a watchdog.
 */
async function completeSleep(fake: ReturnType<typeof createSession>): Promise<void> {
  notify(fake.monitors, MOYOUNG_CMD_SYNC_SLEEP, []);
  await tick();
  notify(fake.monitors, MOYOUNG_CMD_SYNC_PAST_SLEEP_AND_STEP, [3]);
  await tick();
  notify(fake.monitors, MOYOUNG_CMD_SYNC_PAST_SLEEP_AND_STEP, [4]);
  await tick();
}

test("selectMoyoungProfile requires the feea service with fee2 and fee3", async () => {
  const complete = {
    characteristicsForService: async (service: string) =>
      service === MOYOUNG_SERVICE_UUID
        ? [characteristic(MOYOUNG_DATA_OUT_UUID), characteristic(MOYOUNG_DATA_IN_UUID)]
        : [],
  };
  expect(await selectMoyoungProfile(complete, [MOYOUNG_SERVICE_UUID], l70)).toEqual(profile);
  expect(await selectMoyoungProfile(complete, [], l70)).toBeNull();

  const missingNotify = {
    characteristicsForService: async () => [characteristic(MOYOUNG_DATA_OUT_UUID)],
  };
  expect(await selectMoyoungProfile(missingNotify, [MOYOUNG_SERVICE_UUID], l70)).toBeNull();
  const missingWrite = {
    characteristicsForService: async () => [characteristic(MOYOUNG_DATA_IN_UUID)],
  };
  expect(await selectMoyoungProfile(missingWrite, [MOYOUNG_SERVICE_UUID], l70)).toBeNull();
});

test("the profile keeps the model's framing MTU and history capability", async () => {
  const device = {
    characteristicsForService: async () => [
      characteristic(MOYOUNG_DATA_OUT_UUID),
      characteristic(MOYOUNG_DATA_IN_UUID),
    ],
  };
  expect(await selectMoyoungProfile(device, [MOYOUNG_SERVICE_UUID], p22b1)).toMatchObject({
    modelId: "moyoung_p22b1",
    mtu: 20,
    supportsHeartRateHistory: false,
  });
  expect([...MOYOUNG_SERVICE_UUIDS]).toEqual([MOYOUNG_SERVICE_UUID]);
});

test("init requests MTU+3 and walks the fetch chain in upstream order", async () => {
  const fake = createSession({ profile: { ...profile, supportsHeartRateHistory: false } });
  fake.session.start();
  await tick();
  expect(fake.mtuRequests).toEqual([508 + MOYOUNG_MTU_OVERHEAD]);

  await driveWatchdogs(fake.pending, fake.writes, 5);
  expect(commands(fake.writes)).toEqual([
    MOYOUNG_CMD_SYNC_TIME,
    MOYOUNG_CMD_SYNC_SLEEP,
    MOYOUNG_CMD_SYNC_PAST_SLEEP_AND_STEP,
    MOYOUNG_CMD_SYNC_PAST_SLEEP_AND_STEP,
    MOYOUNG_CMD_QUERY_PAST_HEART_RATE_5MIN,
  ]);
  // CMD 51 args 3 then 4 (yesterday, day before).
  expect(Array.from(fake.writes[2]!.value.slice(5))).toEqual([3]);
  expect(Array.from(fake.writes[3]!.value.slice(5))).toEqual([4]);
  // CMD 53 starts at packet 0.
  expect(Array.from(fake.writes[4]!.value.slice(5))).toEqual([0]);
  // The clock packet carries the literal GMT+8 marker.
  expect(fake.writes[0]!.value[9]).toBe(0x08);
  await fake.session.close();
});

test("every silent request times out and the chain still advances", async () => {
  const fake = createSession({ profile: { ...profile, supportsHeartRateHistory: false } });
  fake.session.start();
  await tick();
  await driveWatchdogs(fake.pending, fake.writes, 5);
  // Drain the remaining watchdog for CMD 53.
  for (let round = 0; round < 10 && fake.pending.length; round += 1) {
    const queued = fake.pending.splice(0, fake.pending.length);
    for (const callback of queued) callback();
    await tick(2);
  }
  expect(fake.failures).toEqual(["sleep_session", "sleep_session", "sleep_session", "heart_rate"]);
  expect(MOYOUNG_HISTORY_WATCHDOG_MS).toBe(30_000);
  await fake.session.close();
});

test("sleep responses become assembled sessions and advance the chain", async () => {
  const fake = createSession({ profile: { ...profile, supportsHeartRateHistory: false } });
  fake.session.start();
  await tick();
  expect(commands(fake.writes)).toEqual([MOYOUNG_CMD_SYNC_TIME, MOYOUNG_CMD_SYNC_SLEEP]);

  // Today: light 23:00 → deep 02:00 → wake 06:00.
  notify(fake.monitors, MOYOUNG_CMD_SYNC_SLEEP, [1, 23, 0, 2, 2, 0, 0, 6, 0]);
  await tick();
  expect(fake.records).toHaveLength(1);
  expect(fake.records[0]).toMatchObject({
    type: "sleep_session",
    startTime: new Date(2026, 10, 9, 23, 0).toISOString(),
    endTime: new Date(2026, 10, 10, 6, 0).toISOString(),
  });
  expect(commands(fake.writes).at(-1)).toBe(MOYOUNG_CMD_SYNC_PAST_SLEEP_AND_STEP);

  // Yesterday's block (CMD 51 arg 3) is anchored one day earlier.
  notify(fake.monitors, MOYOUNG_CMD_SYNC_PAST_SLEEP_AND_STEP, [3, 1, 23, 0, 0, 6, 0]);
  await tick();
  expect(fake.records).toHaveLength(2);
  expect(fake.records[1]).toMatchObject({
    startTime: new Date(2026, 10, 8, 23, 0).toISOString(),
    endTime: new Date(2026, 10, 9, 6, 0).toISOString(),
  });

  // Steps answers (args 1/2) are ignored.
  notify(fake.monitors, MOYOUNG_CMD_SYNC_PAST_SLEEP_AND_STEP, [1, 0, 0, 0, 0, 0, 0, 0, 0]);
  await tick();
  expect(fake.records).toHaveLength(2);
  await fake.session.close();
});

test("CMD 53 chains packets 0..7 and dispatches heart-rate samples", async () => {
  const fake = createSession({
    profile: { ...profile, supportsHeartRateHistory: false },
    now: () => new Date(2026, 10, 10, 23, 59),
  });
  fake.session.start();
  await tick();
  await completeSleep(fake);
  const before = fake.writes.length;
  expect(commands(fake.writes).at(-1)).toBe(MOYOUNG_CMD_QUERY_PAST_HEART_RATE_5MIN);

  for (let index = 0; index < 8; index += 1) {
    const payload = Array.from({ length: 73 }, () => 0);
    payload[0] = index;
    payload[1] = 60 + index;
    notify(fake.monitors, MOYOUNG_CMD_QUERY_PAST_HEART_RATE_5MIN, payload);
    await tick();
  }

  // Packets 1..7 were requested after each response.
  expect(commands(fake.writes).slice(before)).toEqual(
    Array.from({ length: 7 }, () => MOYOUNG_CMD_QUERY_PAST_HEART_RATE_5MIN),
  );
  expect(fake.writes.slice(before).map((write) => write.value[5])).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(fake.records).toHaveLength(8);
  expect(fake.records.every((record) => record.type === "heart_rate")).toBe(true);
  expect(fake.failures).toEqual([]);
  await fake.session.close();
});

test("CMD 54 is only requested for models with heart-rate history", async () => {
  const withoutHistory = createSession({
    profile: { ...profile, supportsHeartRateHistory: false },
  });
  withoutHistory.session.start();
  await tick();
  await completeSleep(withoutHistory);
  for (let index = 0; index < 8; index += 1) {
    const payload = Array.from({ length: 73 }, () => 0);
    payload[0] = index;
    notify(withoutHistory.monitors, MOYOUNG_CMD_QUERY_PAST_HEART_RATE_5MIN, payload);
    await tick();
  }
  expect(commands(withoutHistory.writes)).not.toContain(MOYOUNG_CMD_QUERY_PAST_HEART_RATE_1MIN);
  await withoutHistory.session.close();

  const withHistory = createSession();
  withHistory.session.start();
  await tick();
  await completeSleep(withHistory);
  for (let index = 0; index < 8; index += 1) {
    const payload = Array.from({ length: 73 }, () => 0);
    payload[0] = index;
    notify(withHistory.monitors, MOYOUNG_CMD_QUERY_PAST_HEART_RATE_5MIN, payload);
    await tick();
  }
  const oneMinute = withHistory.writes.filter(
    (write) => write.value[4] === MOYOUNG_CMD_QUERY_PAST_HEART_RATE_1MIN,
  );
  expect(oneMinute).toHaveLength(20);
  expect(oneMinute.map((write) => write.value[5])).toEqual(
    Array.from({ length: 20 }, (_, index) => index),
  );
  await withHistory.session.close();
});

test("CMD 54 completes once all twenty packets have arrived", async () => {
  const fake = createSession({ now: () => new Date(2026, 10, 10, 23, 59) });
  fake.session.start();
  await tick();
  await completeSleep(fake);
  for (let index = 0; index < 8; index += 1) {
    const payload = Array.from({ length: 73 }, () => 0);
    payload[0] = index;
    notify(fake.monitors, MOYOUNG_CMD_QUERY_PAST_HEART_RATE_5MIN, payload);
    await tick();
  }
  const before = fake.records.length;
  for (let index = 0; index < 20; index += 1) {
    const payload = Array.from({ length: 73 }, () => 0);
    payload[0] = index;
    payload[1] = 70;
    notify(fake.monitors, MOYOUNG_CMD_QUERY_PAST_HEART_RATE_1MIN, payload);
    await tick();
  }
  expect(fake.records.length - before).toBe(20);
  expect(fake.pending).toHaveLength(0);
  expect(fake.failures).toEqual([]);
  await fake.session.close();
});

test("legacy MTU models fragment writes at 20 bytes", async () => {
  const fake = createSession({
    profile: { ...profile, modelId: "moyoung_p22b1", mtu: 20, supportsHeartRateHistory: false },
  });
  fake.session.start();
  await tick();
  expect(fake.mtuRequests).toEqual([20 + MOYOUNG_MTU_OVERHEAD]);
  expect(fake.writes[0]!.value[2]).toBe(0x10);
  await fake.session.close();
});

test("close settles the in-flight request and ignores later notifications", async () => {
  const fake = createSession();
  fake.session.start();
  await tick();
  await fake.session.close();
  const writesBefore = fake.writes.length;
  notify(fake.monitors, MOYOUNG_CMD_SYNC_SLEEP, [1, 23, 0, 0, 6, 0]);
  await tick();
  expect(fake.records).toEqual([]);
  expect(fake.writes).toHaveLength(writesBefore);
  expect(fake.pending).toHaveLength(0);
});
