/**
 * Tests for the GloryFit connection session.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { expect, test } from "bun:test";
import type { Characteristic } from "react-native-ble-plx";

import {
  GLORYFIT_HISTORY_WATCHDOG_MS,
  createGloryFitSession,
  selectGloryFitProfile,
  type GloryFitProfile,
  type GloryFitTimers,
} from "./gloryfit";
import {
  GLORYFIT_CMD_NOTIFY_UUID,
  GLORYFIT_CMD_SERVICE_UUID,
  GLORYFIT_CMD_WRITE_UUID,
  GLORYFIT_DATA_NOTIFY_UUID,
  GLORYFIT_DATA_SERVICE_UUID,
  GLORYFIT_DATA_WRITE_UUID,
} from "../models/gloryfit";
import type { GloryFitRecord } from "../protocol/gloryfit";

function b64(bytes: readonly number[]): string {
  return Buffer.from(Uint8Array.from(bytes)).toString("base64");
}

function u16be(value: number): [number, number] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function fakeDevice() {
  const monitors = new Map<string, (error: unknown, value: Characteristic | null) => void>();
  const writes: { service: string; characteristic: string; value: Uint8Array }[] = [];
  let mtu: number | null = null;
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
    requestMTU: async (value: number) => {
      mtu = value;
      return 1;
    },
  };
  return { device, monitors, writes, mtu: () => mtu };
}

function fakeTimers() {
  const pending: (() => void)[] = [];
  const timers: GloryFitTimers = {
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

const profile: GloryFitProfile = {
  modelId: "gloryfit_d3",
  commandServiceUuid: GLORYFIT_CMD_SERVICE_UUID,
  commandWriteUuid: GLORYFIT_CMD_WRITE_UUID,
  commandNotifyUuid: GLORYFIT_CMD_NOTIFY_UUID,
  dataServiceUuid: GLORYFIT_DATA_SERVICE_UUID,
  dataWriteUuid: GLORYFIT_DATA_WRITE_UUID,
  dataNotifyUuid: GLORYFIT_DATA_NOTIFY_UUID,
};

function characteristic(uuid: string): Characteristic {
  return { uuid, isNotifiable: true, isIndicatable: false } as Characteristic;
}

test("selectGloryFitProfile requires both services and all four characteristics", async () => {
  const complete = {
    characteristicsForService: async (service: string) =>
      service === GLORYFIT_CMD_SERVICE_UUID
        ? [characteristic(GLORYFIT_CMD_WRITE_UUID), characteristic(GLORYFIT_CMD_NOTIFY_UUID)]
        : service === GLORYFIT_DATA_SERVICE_UUID
          ? [characteristic(GLORYFIT_DATA_WRITE_UUID), characteristic(GLORYFIT_DATA_NOTIFY_UUID)]
          : [],
  };
  expect(
    await selectGloryFitProfile(
      complete,
      [GLORYFIT_CMD_SERVICE_UUID, GLORYFIT_DATA_SERVICE_UUID],
      "gloryfit_d3",
    ),
  ).toEqual(profile);

  expect(
    await selectGloryFitProfile(complete, [GLORYFIT_CMD_SERVICE_UUID], "gloryfit_d3"),
  ).toBeNull();
  const missingNotify = {
    characteristicsForService: async (service: string) =>
      service === GLORYFIT_CMD_SERVICE_UUID ? [characteristic(GLORYFIT_CMD_WRITE_UUID)] : [],
  };
  expect(
    await selectGloryFitProfile(
      missingNotify,
      [GLORYFIT_CMD_SERVICE_UUID, GLORYFIT_DATA_SERVICE_UUID],
      "gloryfit_d3",
    ),
  ).toBeNull();
});

test("the init sequence requests MTU 247 and writes version then battery", async () => {
  const { device, writes, mtu } = fakeDevice();
  const { timers } = fakeTimers();
  const session = createGloryFitSession({
    device: device as never,
    profile,
    onRecord: () => undefined,
    timers,
    initDelayMs: 0,
  });
  session.start();
  await tick();

  expect(mtu()).toBe(247);
  expect(writes.map((write) => write.value[0])).toEqual([0xa1, 0xa2, 0xb2]);
  expect(Array.from(writes[0]!.value)).toEqual([0xa1]);
  expect(Array.from(writes[1]!.value)).toEqual([0xa2]);
  expect(Array.from(writes[2]!.value)).toEqual([0xb2, 0xfa]);
  expect(writes.every((write) => write.characteristic === GLORYFIT_CMD_WRITE_UUID)).toBe(true);
  await session.close();
});

test("the history chain runs steps, then heart rate, then sleep", async () => {
  const { device, monitors, writes } = fakeDevice();
  const { timers } = fakeTimers();
  const records: GloryFitRecord[] = [];
  const failures: string[] = [];
  const session = createGloryFitSession({
    device: device as never,
    profile,
    onRecord: (record) => records.push(record),
    onFailure: (failure) => failures.push(failure),
    timers,
    initDelayMs: 0,
  });
  session.start();
  await tick();
  expect(writes).toHaveLength(3); // version, battery, steps fetch

  const command = monitors.get(`${GLORYFIT_CMD_SERVICE_UUID}|${GLORYFIT_CMD_NOTIFY_UUID}`)!;
  const data = monitors.get(`${GLORYFIT_DATA_SERVICE_UUID}|${GLORYFIT_DATA_NOTIFY_UUID}`)!;

  // Hourly steps record then the three-byte end marker.
  command(null, {
    value: b64([
      0xb2,
      ...u16be(2026),
      11,
      10,
      10,
      ...u16be(250),
      1,
      2,
      0,
      ...u16be(3),
      4,
      5,
      0,
      ...u16be(6),
    ]),
  } as Characteristic);
  command(null, { value: b64([0xb2, 0xfd, 0x00]) } as Characteristic);
  await tick();
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ type: "steps_interval", count: 250 });
  expect(writes).toHaveLength(4);
  expect(Array.from(writes[3]!.value)).toEqual([0xf7, 0xfa]);

  // Heart-rate record then the end marker.
  command(null, {
    value: b64([0xf7, ...u16be(2026), 11, 10, 8, ...Array.from({ length: 12 }, () => 60)]),
  } as Characteristic);
  command(null, { value: b64([0xf7, 0xfd, 0x00]) } as Characteristic);
  await tick();
  expect(records.filter((record) => record.type === "heart_rate")).toHaveLength(12);
  expect(writes).toHaveLength(5);
  expect(Array.from(writes[4]!.value)).toEqual([0x31, 0x01]);

  // Sleep: date, two stage payloads, then the end marker.
  command(null, {
    value: b64([0x31, 0x01, ...u16be(2026), 11, 10, 2]),
  } as Characteristic);
  data(null, {
    value: b64([0x32, 23, 0, 2, 0, 0, 60]),
  } as Characteristic);
  data(null, {
    value: b64([0x32, 0, 0, 1, 0, 0, 30]),
  } as Characteristic);
  command(null, { value: b64([0x31, 0x02]) } as Characteristic);
  await tick();

  const sessions = records.filter((record) => record.type === "sleep_session");
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({
    type: "sleep_session",
    startTime: new Date(2026, 10, 9, 23, 0, 0).toISOString(),
    endTime: new Date(2026, 10, 10, 0, 30, 0).toISOString(),
  });
  expect(failures).toEqual([]);
  await session.close();
});

test("the watchdog aborts a silent request and the chain continues", async () => {
  const { device, writes } = fakeDevice();
  const { timers, pending } = fakeTimers();
  const failures: string[] = [];
  const session = createGloryFitSession({
    device: device as never,
    profile,
    onRecord: () => undefined,
    onFailure: (failure) => failures.push(failure),
    timers,
    initDelayMs: 0,
    watchdogMs: GLORYFIT_HISTORY_WATCHDOG_MS,
  });
  session.start();
  await tick();
  expect(writes).toHaveLength(3);

  for (const callback of pending.splice(0)) callback();
  await tick();
  expect(failures).toEqual(["steps_interval"]);
  expect(writes).toHaveLength(4);
  expect(Array.from(writes[3]!.value)).toEqual([0xf7, 0xfa]);

  for (const callback of pending.splice(0)) callback();
  await tick();
  expect(failures).toEqual(["steps_interval", "heart_rate"]);
  expect(writes).toHaveLength(5);
  expect(Array.from(writes[4]!.value)).toEqual([0x31, 0x01]);

  for (const callback of pending.splice(0)) callback();
  await tick();
  expect(failures).toEqual(["steps_interval", "heart_rate", "sleep_session"]);
  await session.close();
});

test("a sleep watchdog emits the stages already captured before reporting", async () => {
  const { device, monitors, writes } = fakeDevice();
  const { timers, pending } = fakeTimers();
  const records: GloryFitRecord[] = [];
  const failures: string[] = [];
  const session = createGloryFitSession({
    device: device as never,
    profile,
    onRecord: (record) => records.push(record),
    onFailure: (failure) => failures.push(failure),
    timers,
    initDelayMs: 0,
  });
  session.start();
  await tick();
  const command = monitors.get(`${GLORYFIT_CMD_SERVICE_UUID}|${GLORYFIT_CMD_NOTIFY_UUID}`)!;
  const data = monitors.get(`${GLORYFIT_DATA_SERVICE_UUID}|${GLORYFIT_DATA_NOTIFY_UUID}`)!;
  command(null, { value: b64([0xb2, 0xfd, 0x00]) } as Characteristic);
  await tick();
  command(null, { value: b64([0xf7, 0xfd, 0x00]) } as Characteristic);
  await tick();
  expect(writes).toHaveLength(5);

  command(null, { value: b64([0x31, 0x01, ...u16be(2026), 11, 10, 1]) } as Characteristic);
  data(null, { value: b64([0x32, 1, 0, 2, 0, 0, 30]) } as Characteristic);
  // Never send the 31 02 end marker.
  for (const callback of pending.splice(0)) callback();
  await tick();

  expect(failures).toEqual(["sleep_session"]);
  expect(records.filter((record) => record.type === "sleep_session")).toHaveLength(1);
  await session.close();
});
