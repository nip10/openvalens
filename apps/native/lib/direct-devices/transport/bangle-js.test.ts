/**
 * Tests for the Bangle.js connection session.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { expect, test } from "bun:test";
import type { Characteristic } from "react-native-ble-plx";

import {
  BANGLE_JS_HISTORY_WATCHDOG_MS,
  BANGLE_JS_SERVICE_UUIDS,
  createBangleJsSession,
  createMemoryBangleJsSyncStateStore,
  selectBangleJsProfile,
  type BangleJsProfile,
  type BangleJsTimers,
} from "./bangle-js";
import {
  BANGLE_JS_RX_UUID,
  BANGLE_JS_SERVICE_UUID,
  BANGLE_JS_TX_UUID,
  type BangleJsModelId,
} from "../models/bangle-js";
import {
  BANGLE_JS_DEFAULT_LOOKBACK_MS,
  BANGLE_JS_SYNC_MARGIN_MS,
  type BangleJsHeartRateSample,
  type BangleJsRecord,
} from "../protocol/bangle-js";

function b64(bytes: readonly number[]): string {
  return Buffer.from(Uint8Array.from(bytes)).toString("base64");
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Reassembles the write stream into logical frames. Every phone → watch frame
 * starts with DLE (0x10) and is chunked at the MTU, so counting writes would
 * count chunks. Returned strings exclude the leading DLE.
 */
function frames(writes: readonly { value: Uint8Array }[]): string[] {
  const out: string[] = [];
  let current: number[] | null = null;
  for (const write of writes) {
    for (const byte of write.value) {
      if (byte === 0x10) {
        if (current) out.push(text(Uint8Array.from(current)));
        current = [];
        continue;
      }
      current?.push(byte);
    }
  }
  if (current) out.push(text(Uint8Array.from(current)));
  return out;
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
  const timers: BangleJsTimers = {
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

const profile: BangleJsProfile = {
  modelId: "bangle_js_2",
  serviceUuid: BANGLE_JS_SERVICE_UUID,
  txUuid: BANGLE_JS_TX_UUID,
  rxUuid: BANGLE_JS_RX_UUID,
};

function characteristic(uuid: string): Characteristic {
  return { uuid, isNotifiable: true, isIndicatable: false } as Characteristic;
}

function notify(monitors: ReturnType<typeof fakeDevice>["monitors"], payload: string): void {
  const callback = monitors.get(`${BANGLE_JS_SERVICE_UUID}|${BANGLE_JS_RX_UUID}`)!;
  callback(null, { value: b64([...new TextEncoder().encode(payload)]) } as Characteristic);
}

const NOW = new Date("2026-02-01T12:00:00.000Z");

function createSession(
  overrides: Partial<Parameters<typeof createBangleJsSession>[0]> = {},
  modelId: BangleJsModelId = "bangle_js_2",
) {
  const fake = fakeDevice();
  const timers = fakeTimers();
  const records: BangleJsRecord[] = [];
  const live: BangleJsHeartRateSample[] = [];
  const failures: string[] = [];
  const syncState = createMemoryBangleJsSyncStateStore();
  const session = createBangleJsSession({
    device: fake.device as never,
    deviceId: "watch-1",
    profile: { ...profile, modelId },
    onRecord: (record) => records.push(record),
    onLiveHeartRate: (sample) => live.push(sample),
    onFailure: (failure) => failures.push(failure),
    now: () => NOW,
    timers: timers.timers,
    initDelayMs: 0,
    syncState,
    ...overrides,
  });
  return { ...fake, ...timers, session, records, live, failures, syncState };
}

test("selectBangleJsProfile requires the Nordic UART write and notify characteristics", async () => {
  const complete = {
    characteristicsForService: async (service: string) =>
      service === BANGLE_JS_SERVICE_UUID
        ? [characteristic(BANGLE_JS_TX_UUID), characteristic(BANGLE_JS_RX_UUID)]
        : [],
  };
  expect(await selectBangleJsProfile(complete, [BANGLE_JS_SERVICE_UUID], "bangle_js_2")).toEqual({
    modelId: "bangle_js_2",
    serviceUuid: BANGLE_JS_SERVICE_UUID,
    txUuid: BANGLE_JS_TX_UUID,
    rxUuid: BANGLE_JS_RX_UUID,
  });
  expect(BANGLE_JS_SERVICE_UUIDS.has(BANGLE_JS_SERVICE_UUID)).toBe(true);

  const missingNotify = {
    characteristicsForService: async () => [characteristic(BANGLE_JS_TX_UUID)],
  };
  expect(
    await selectBangleJsProfile(missingNotify, [BANGLE_JS_SERVICE_UUID], "bangle_js_2"),
  ).toBeNull();
  expect(await selectBangleJsProfile(complete, [], "bangle_js_2")).toBeNull();
});

test("init sets the clock, requests MTU 131 and fetches history since now − 1 day", async () => {
  const f = createSession();
  f.session.start();
  await tick();

  expect(f.mtuRequests).toEqual([131]);
  expect(f.writes.every((write) => write.characteristic === BANGLE_JS_TX_UUID)).toBe(true);
  expect(f.writes.every((write) => write.service === BANGLE_JS_SERVICE_UUID)).toBe(true);
  // Frames are chunked at the 20-byte pre-negotiation MTU.
  expect(f.writes.every((write) => write.value.length <= 20)).toBe(true);

  const since = NOW.getTime() - BANGLE_JS_DEFAULT_LOOKBACK_MS;
  expect(frames(f.writes)).toEqual([
    // Raw Espruino time-set script, not JSON.
    "setTime(1769947200);E.setTimeZone(0);\n",
    `GB({"t":"actfetch","ts":${since}})\n`,
  ]);

  await f.session.close();
});

test("a stored history run emits steps_interval and heart_rate and stores the cursor", async () => {
  const f = createSession();
  f.session.start();
  await tick();

  notify(f.monitors, '{"t":"actfetch","state":"start"}\r\n');
  // Bucket ending 10:10 with 12 steps and 61 bpm.
  notify(f.monitors, '{"t":"act","ts":1770027000000,"stp":12,"hrm":61,"mov":3,"rt":0}\r\n');
  // Bucket ending 10:20 with steps only.
  notify(f.monitors, '{"t":"act","ts":1770027600000,"stp":4,"hrm":0,"mov":1,"rt":0}\r\n');
  // A realtime sample interleaved in the same stream must not become history.
  notify(f.monitors, '{"t":"act","ts":1770027600000,"stp":0,"hrm":70,"mov":0,"rt":1}\r\n');
  // Noise that must be ignored.
  notify(f.monitors, "Bangle.js 2 ready\r\n");
  notify(f.monitors, '{"ts":1}\r\n');
  notify(f.monitors, '{"t":"actfetch","state":"end","count":2}\r\n');
  await tick();

  expect(f.records).toEqual([
    {
      type: "steps_interval",
      startTime: new Date(1770027000000 - 600_000).toISOString(),
      endTime: new Date(1770027000000).toISOString(),
      count: 12,
    },
    { type: "heart_rate", time: new Date(1770027000000).toISOString(), bpm: 61 },
    {
      type: "steps_interval",
      startTime: new Date(1770027600000 - 600_000).toISOString(),
      endTime: new Date(1770027600000).toISOString(),
      count: 4,
    },
  ]);
  expect(f.live).toEqual([
    { type: "heart_rate", time: new Date(1770027600000).toISOString(), bpm: 70 },
  ]);
  expect(f.syncState.getLastSync("watch-1")).toBe(NOW.getTime() - BANGLE_JS_SYNC_MARGIN_MS);

  // The history fetch settled, so the realtime stream is enabled next.
  expect(frames(f.writes)[2]).toBe('GB({"t":"act","hrm":true,"stp":false,"int":10})\n');
  await f.session.close();
});

test("the stored cursor is used on the next connection", async () => {
  const syncState = createMemoryBangleJsSyncStateStore();
  syncState.setLastSync("watch-1", 1_770_000_000_000);
  const f = createSession({ syncState });
  f.session.start();
  await tick();
  expect(frames(f.writes)[1]).toBe('GB({"t":"actfetch","ts":1770000000000})\n');
  await f.session.close();
});

test("a fragmented notification is reassembled across writes and XON/XOFF", async () => {
  const f = createSession();
  f.session.start();
  await tick();

  const line = '{"t":"act","ts":1770027000000,"stp":7,"hrm":0,"mov":2,"rt":0}\r\n';
  const bytes = [...new TextEncoder().encode(line)];
  const callback = f.monitors.get(`${BANGLE_JS_SERVICE_UUID}|${BANGLE_JS_RX_UUID}`)!;
  // XON inside the first fragment, then the rest in two more notifications.
  callback(null, { value: b64([0x11, ...bytes.slice(0, 9)]) } as Characteristic);
  callback(null, { value: b64(bytes.slice(9, 20)) } as Characteristic);
  callback(null, { value: b64([0x13, ...bytes.slice(20)]) } as Characteristic);

  expect(f.records).toEqual([
    {
      type: "steps_interval",
      startTime: new Date(1770027000000 - 600_000).toISOString(),
      endTime: new Date(1770027000000).toISOString(),
      count: 7,
    },
  ]);
  await f.session.close();
});

test("a silent watch times out and the session still enables realtime", async () => {
  const f = createSession({ watchdogMs: BANGLE_JS_HISTORY_WATCHDOG_MS });
  f.session.start();
  await tick();
  expect(frames(f.writes)).toHaveLength(2);

  for (const callback of f.pending.splice(0)) callback();
  await tick();

  expect(f.failures).toEqual(["steps_interval"]);
  expect(f.syncState.getLastSync("watch-1")).toBeNull();
  expect(frames(f.writes)[2]).toBe('GB({"t":"act","hrm":true,"stp":false,"int":10})\n');
  await f.session.close();
});

test("close disables the realtime stream and removes the subscription", async () => {
  const f = createSession();
  f.session.start();
  await tick();
  notify(f.monitors, '{"t":"actfetch","state":"end","count":0}\r\n');
  await tick();
  expect(frames(f.writes)).toHaveLength(3);

  await f.session.close();
  expect(frames(f.writes)[3]).toBe('GB({"t":"act","hrm":false,"stp":false,"int":0})\n');
  // Closing twice is a no-op.
  await f.session.close();
  expect(frames(f.writes)).toHaveLength(4);
});

test("realtime can be disabled for a session", async () => {
  const f = createSession({ realtime: false });
  f.session.start();
  await tick();
  notify(f.monitors, '{"t":"actfetch","state":"end","count":0}\r\n');
  await tick();
  expect(frames(f.writes)).toHaveLength(2);
  await f.session.close();
  expect(frames(f.writes)).toHaveLength(2);
});

test("time setting can be skipped", async () => {
  const f = createSession({ setTime: false });
  f.session.start();
  await tick();
  expect(frames(f.writes)).toHaveLength(1);
  expect(frames(f.writes)[0]).toContain('"actfetch"');
  await f.session.close();
});

test("a write failure is reported without throwing", async () => {
  const f = createSession();
  f.device.writeCharacteristicWithResponseForService = async () => {
    throw new Error("WRITE_FAILED");
  };
  f.session.start();
  await tick();
  // The clock write, the history request and the realtime enable all fail.
  expect(f.failures).toEqual(["init", "steps_interval", "heart_rate"]);
  await f.session.close();
});

test("a monitor error is reported as an init failure", async () => {
  const f = createSession();
  f.session.start();
  await tick();
  const callback = f.monitors.get(`${BANGLE_JS_SERVICE_UUID}|${BANGLE_JS_RX_UUID}`)!;
  callback(new Error("GATT"), null);
  expect(f.failures).toEqual(["init"]);
  await f.session.close();
});
