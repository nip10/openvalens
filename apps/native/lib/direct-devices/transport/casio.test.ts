/**
 * Tests for the Casio watch connection session.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { expect, test } from "bun:test";
import type { Characteristic } from "react-native-ble-plx";

import {
  CASIO_LIFE_LOG_FALLBACK_LENGTH,
  CASIO_WATCHDOG_MS,
  createCasioSession,
  selectCasioProfile,
  type CasioProfile,
  type CasioTimers,
} from "./casio";
import {
  CASIO_ALL_FEATURES_UUID,
  CASIO_CONVOY_UUID,
  CASIO_DATA_REQUEST_UUID,
  CASIO_WATCH_FEATURES_SERVICE_UUID,
  getCasioModel,
} from "../models/casio";
import {
  CASIO_CONVOY_DATATYPE_STEPS,
  CASIO_NO_DATA16,
  buildConvoyAck,
  buildConvoyRequest,
  xorPayload,
  type CasioRecord,
} from "../protocol/casio";

function b64(bytes: readonly number[]): string {
  return Buffer.from(Uint8Array.from(bytes)).toString("base64");
}

function unb64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function fakeDevice(options: { descriptors?: boolean } = {}) {
  const monitors = new Map<string, (error: unknown, value: Characteristic | null) => void>();
  const removed: string[] = [];
  const writes: { characteristic: string; value: Uint8Array }[] = [];
  const descriptorWrites: { characteristic: string; descriptor: string; value: string }[] = [];
  const device = {
    monitorCharacteristicForService: (
      _service: string,
      characteristic: string,
      callback: (error: unknown, value: Characteristic | null) => void,
    ) => {
      monitors.set(characteristic, callback);
      return {
        remove() {
          monitors.delete(characteristic);
          removed.push(characteristic);
        },
      };
    },
    writeCharacteristicWithResponseForService: async (
      _service: string,
      characteristic: string,
      value: string,
    ) => {
      writes.push({ characteristic, value: unb64(value) });
      return {} as Characteristic;
    },
    ...(options.descriptors
      ? {
          writeDescriptorForService: async (
            _service: string,
            characteristic: string,
            descriptor: string,
            value: string,
          ) => {
            descriptorWrites.push({ characteristic, descriptor, value });
            return {};
          },
        }
      : {}),
  };
  return { device, monitors, removed, writes, descriptorWrites };
}

function fakeTimers() {
  const pending: (() => void)[] = [];
  const timers: CasioTimers = {
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

const NOW = new Date(2026, 10, 10, 12, 0, 0);

const gbx100 = getCasioModel("casio_gbx-100")!;
const gbd200 = getCasioModel("casio_gbd-200")!;
const ggb100 = getCasioModel("casio_gg-b100")!;
const gb6900 = getCasioModel("casio_gb-6900b")!;

const profile: CasioProfile = {
  modelId: "casio_gbx-100",
  role: "client",
  serviceUuid: CASIO_WATCH_FEATURES_SERVICE_UUID,
  requestUuid: CASIO_DATA_REQUEST_UUID,
  convoyUuid: CASIO_CONVOY_UUID,
  featuresUuid: CASIO_ALL_FEATURES_UUID,
  stepsFeature: 0x11,
  xor: true,
  source: "hourly-tlv",
  mainMenuResync: false,
};

function characteristic(uuid: string): Characteristic {
  return { uuid, isNotifiable: true, isIndicatable: false } as Characteristic;
}

function createSession(
  overrides: Partial<Parameters<typeof createCasioSession>[0]> = {},
  options: { descriptors?: boolean } = {},
) {
  const fake = fakeDevice(options);
  const timers = fakeTimers();
  const records: CasioRecord[] = [];
  const failures: string[] = [];
  const session = createCasioSession({
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

/** A plain hourly-TLV payload with one step bin. */
function stepsPayload(options: {
  steps?: readonly number[];
  calories?: readonly number[];
  totalSteps?: number;
  totalCalories?: number;
  finished?: boolean;
  hour?: number;
}): Uint8Array {
  const steps = options.steps ?? [100];
  const calories = options.calories ?? [5];
  const u16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
  const u32 = (value: number) => [
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
  const body = [
    0x00,
    0x00,
    26,
    11,
    10,
    options.hour ?? 12,
    30,
    ...u32(options.totalSteps ?? steps.reduce((sum, value) => sum + value, 0)),
    ...u16(options.totalCalories ?? calories.reduce((sum, value) => sum + value, 0)),
    0x00,
    0x00,
    0x00,
    0x00,
    options.finished ? 0x01 : 0x00,
    CASIO_CONVOY_DATATYPE_STEPS,
    ...u16(steps.length * 2),
    ...steps.flatMap(u16),
  ];
  const length = body.length - 2;
  body[0] = length & 0xff;
  body[1] = (length >> 8) & 0xff;
  return Uint8Array.from(body);
}

/** A 160-byte GG-B100 life log with one step bin. */
function lifeLog(steps: number): Uint8Array {
  const out = new Uint8Array(160);
  const view = new DataView(out.buffer);
  for (let index = 0; index < 24; index += 1) {
    view.setUint16(index * 2, CASIO_NO_DATA16, true);
    view.setUint16(48 + index * 2, CASIO_NO_DATA16, true);
  }
  view.setUint16(0, steps, true);
  view.setUint16(48, 7, true);
  view.setUint32(96, steps, true);
  view.setUint32(100, 7, true);
  return out;
}

function notify(
  monitors: ReturnType<typeof fakeDevice>["monitors"],
  characteristicUuid: string,
  bytes: readonly number[],
): void {
  const callback = monitors.get(characteristicUuid);
  if (!callback) throw new Error(`NO_MONITOR_${characteristicUuid}`);
  callback(null, { value: b64(bytes) } as Characteristic);
}

function echo(feature: number, length: number): number[] {
  return [0x00, feature, length & 0xff, (length >> 8) & 0xff, 0x00, 0x00, 0x00];
}

// ---------------------------------------------------------------------------
// Profile selection
// ---------------------------------------------------------------------------

test("selectCasioProfile requires the Watch Features service", async () => {
  const device = {
    characteristicsForService: async () => [
      characteristic(CASIO_DATA_REQUEST_UUID),
      characteristic(CASIO_CONVOY_UUID),
    ],
  };
  expect(await selectCasioProfile(device, [CASIO_WATCH_FEATURES_SERVICE_UUID], gbx100)).toEqual(
    profile,
  );
  expect(await selectCasioProfile(device, [], gbx100)).toBeNull();
  expect(
    await selectCasioProfile(device, ["0000180d-0000-1000-8000-00805f9b34fb"], gbx100),
  ).toBeNull();
});

test("a client model with a steps path needs both block characteristics", async () => {
  const complete = {
    characteristicsForService: async () => [
      characteristic(CASIO_DATA_REQUEST_UUID),
      characteristic(CASIO_CONVOY_UUID),
    ],
  };
  expect(
    await selectCasioProfile(complete, [CASIO_WATCH_FEATURES_SERVICE_UUID], gbx100),
  ).not.toBeNull();

  const missingConvoy = {
    characteristicsForService: async () => [characteristic(CASIO_DATA_REQUEST_UUID)],
  };
  expect(
    await selectCasioProfile(missingConvoy, [CASIO_WATCH_FEATURES_SERVICE_UUID], gbx100),
  ).toBeNull();

  const missingRequest = {
    characteristicsForService: async () => [characteristic(CASIO_CONVOY_UUID)],
  };
  expect(
    await selectCasioProfile(missingRequest, [CASIO_WATCH_FEATURES_SERVICE_UUID], gbx100),
  ).toBeNull();
});

test("server-role and fetch-less client models select without block characteristics", async () => {
  const bare = { characteristicsForService: async () => [] };
  const server = await selectCasioProfile(bare, [CASIO_WATCH_FEATURES_SERVICE_UUID], gb6900);
  expect(server).toMatchObject({ modelId: "casio_gb-6900b", role: "server", source: null });

  const ecb = await selectCasioProfile(
    bare,
    [CASIO_WATCH_FEATURES_SERVICE_UUID],
    getCasioModel("casio_ecb-s100")!,
  );
  expect(ecb).toMatchObject({ modelId: "casio_ecb-s100", role: "client", source: null });
});

test("the profile carries the model's encoding and steps source", async () => {
  const device = {
    characteristicsForService: async () => [
      characteristic(CASIO_DATA_REQUEST_UUID),
      characteristic(CASIO_CONVOY_UUID),
    ],
  };
  expect(
    await selectCasioProfile(device, [CASIO_WATCH_FEATURES_SERVICE_UUID], ggb100),
  ).toMatchObject({ modelId: "casio_gg-b100", xor: false, source: "life-log" });
  expect(
    await selectCasioProfile(device, [CASIO_WATCH_FEATURES_SERVICE_UUID], gbd200),
  ).toMatchObject({
    modelId: "casio_gbd-200",
    xor: true,
    source: "hourly-tlv",
    mainMenuResync: true,
  });
});

// ---------------------------------------------------------------------------
// Fetch chain
// ---------------------------------------------------------------------------

test("a fetch toggles CCCDs, requests the block, ACKs it and turns CCCDs off", async () => {
  const fake = createSession({}, { descriptors: true });
  fake.session.start();
  await tick();

  // CCCD on for both block characteristics, then the request frame.
  expect(fake.writes.map((write) => Array.from(write.value))).toEqual([
    Array.from(buildConvoyRequest(0x11)),
  ]);
  expect(fake.writes[0]!.characteristic).toBe(CASIO_DATA_REQUEST_UUID);

  const plain = stepsPayload({ steps: [100, 200], calories: [5, 10] });
  const encoded = xorPayload(plain);
  notify(fake.monitors, CASIO_DATA_REQUEST_UUID, echo(0x11, encoded.length));
  await tick();
  notify(fake.monitors, CASIO_CONVOY_UUID, Array.from(encoded));
  await tick();

  expect(fake.records).toHaveLength(2);
  expect(fake.records[0]).toEqual({
    type: "steps_interval",
    startTime: new Date(2026, 10, 10, 11, 0).toISOString(),
    endTime: new Date(2026, 10, 10, 12, 0).toISOString(),
    count: 100,
  });
  expect(fake.records[1]!.count).toBe(200);

  // ACK after parsing.
  expect(fake.writes.map((write) => Array.from(write.value))).toContainEqual(
    Array.from(buildConvoyAck(0x11)),
  );
  // CCCD off is the last descriptor transition.
  expect(fake.descriptorWrites.map((write) => write.value)).toEqual([
    "AQA=",
    "AQA=",
    "AAA=",
    "AAA=",
  ]);
  expect(
    fake.descriptorWrites.every(
      (write) => write.descriptor === "00002902-0000-1000-8000-00805f9b34fb",
    ),
  ).toBe(true);
  await fake.session.whenDone();
  await fake.session.close();
});

test("without descriptor writes the subscription lifecycle is the CCCD toggle", async () => {
  const fake = createSession();
  fake.session.start();
  await tick();
  expect([...fake.monitors.keys()].sort()).toEqual(
    [CASIO_DATA_REQUEST_UUID, CASIO_CONVOY_UUID].sort(),
  );

  const encoded = xorPayload(stepsPayload({}));
  notify(fake.monitors, CASIO_DATA_REQUEST_UUID, echo(0x11, encoded.length));
  await tick();
  notify(fake.monitors, CASIO_CONVOY_UUID, Array.from(encoded));
  await tick();

  // The block subscriptions are removed once the fetch is done.
  expect(fake.removed.sort()).toEqual([CASIO_DATA_REQUEST_UUID, CASIO_CONVOY_UUID].sort());
  expect(fake.monitors.size).toBe(0);
  expect(fake.records).toHaveLength(1);
  await fake.session.close();
});

test("a life log fetches without an echo, using the 160-byte fallback", async () => {
  const fake = createSession({
    profile: { ...profile, modelId: "casio_gg-b100", xor: false, source: "life-log" },
  });
  fake.session.start();
  await tick();
  expect(CASIO_LIFE_LOG_FALLBACK_LENGTH).toBe(160);

  // A partial payload is not the whole block yet.
  notify(fake.monitors, CASIO_CONVOY_UUID, Array.from(lifeLog(120)).slice(0, 100));
  await tick();
  expect(fake.records).toHaveLength(0);

  notify(fake.monitors, CASIO_CONVOY_UUID, Array.from(lifeLog(120)).slice(100));
  await tick();
  expect(fake.records).toEqual([
    {
      type: "steps_interval",
      startTime: new Date(2026, 10, 10, 11, 0).toISOString(),
      endTime: new Date(2026, 10, 10, 12, 0).toISOString(),
      count: 120,
    },
  ]);
  await fake.session.close();
});

test("an hourly payload without an echo is the whole first notification", async () => {
  const fake = createSession();
  fake.session.start();
  await tick();
  notify(fake.monitors, CASIO_CONVOY_UUID, Array.from(xorPayload(stepsPayload({ steps: [42] }))));
  await tick();
  expect(fake.records).toHaveLength(1);
  expect(fake.records[0]!.count).toBe(42);
  await fake.session.close();
});

test("a multi-notification payload is reassembled to the echoed length", async () => {
  const fake = createSession();
  fake.session.start();
  await tick();
  const encoded = Array.from(xorPayload(stepsPayload({ steps: [100, 200, 300] })));
  notify(fake.monitors, CASIO_DATA_REQUEST_UUID, echo(0x11, encoded.length));
  await tick();
  const half = Math.floor(encoded.length / 2);
  notify(fake.monitors, CASIO_CONVOY_UUID, encoded.slice(0, half));
  await tick();
  expect(fake.records).toHaveLength(0);
  notify(fake.monitors, CASIO_CONVOY_UUID, encoded.slice(half));
  await tick();
  expect(fake.records.map((record) => record.count)).toEqual([100, 200, 300]);
  await fake.session.close();
});

test("a silent watch trips the 30 s watchdog and still settles", async () => {
  const fake = createSession();
  fake.session.start();
  await tick();
  expect(CASIO_WATCHDOG_MS).toBe(30_000);
  expect(fake.pending).toHaveLength(1);
  fake.pending.splice(0, fake.pending.length).forEach((callback) => callback());
  await tick();
  expect(fake.failures).toEqual(["steps_interval"]);
  await fake.session.whenDone();
  await fake.session.close();
});

test("every response re-arms the watchdog", async () => {
  const fake = createSession();
  fake.session.start();
  await tick();
  const first = fake.pending.length;
  notify(fake.monitors, CASIO_DATA_REQUEST_UUID, echo(0x11, 64));
  await tick();
  // The original timer was cleared and a fresh one queued.
  expect(fake.pending.length).toBe(first);
  expect(fake.failures).toEqual([]);
  await fake.session.close();
});

test("server-role models never touch a characteristic", async () => {
  const fake = createSession({
    profile: { ...profile, modelId: "casio_gb-6900b", role: "server", source: null },
  });
  fake.session.start();
  await tick();
  expect(fake.monitors.size).toBe(0);
  expect(fake.writes).toEqual([]);
  expect(fake.descriptorWrites).toEqual([]);
  await fake.session.whenDone();
  await fake.session.close();
});

test("client models without a fetch also stay connection-only", async () => {
  const fake = createSession({
    profile: { ...profile, modelId: "casio_gw-b5600", source: null },
  });
  fake.session.start();
  await tick();
  expect(fake.monitors.size).toBe(0);
  expect(fake.writes).toEqual([]);
  await fake.session.whenDone();
  await fake.session.close();
});

test("an unparsable payload reports a failure instead of emitting records", async () => {
  const fake = createSession();
  fake.session.start();
  await tick();
  notify(fake.monitors, CASIO_DATA_REQUEST_UUID, echo(0x11, 4));
  await tick();
  notify(fake.monitors, CASIO_CONVOY_UUID, [0x00, 0x01, 0x02, 0x03]);
  await tick();
  expect(fake.records).toEqual([]);
  expect(fake.failures).toEqual(["steps_interval"]);
  await fake.session.close();
});

// ---------------------------------------------------------------------------
// GBD-200 main-menu resync
// ---------------------------------------------------------------------------

test("the GBD-200 resync warms CONVOY and re-runs the fetch", async () => {
  const resyncProfile: CasioProfile = {
    ...profile,
    modelId: "casio_gbd-200",
    mainMenuResync: true,
  };
  const fake = createSession({ profile: resyncProfile });
  fake.session.start();
  await tick();
  // The resync needs the all-features characteristic monitored.
  expect([...fake.monitors.keys()]).toContain(CASIO_ALL_FEATURES_UUID);

  // Finish the first fetch.
  const encoded = Array.from(xorPayload(stepsPayload({})));
  notify(fake.monitors, CASIO_DATA_REQUEST_UUID, echo(0x11, encoded.length));
  await tick();
  notify(fake.monitors, CASIO_CONVOY_UUID, encoded);
  await tick();
  const afterFirst = fake.writes.length;
  expect(fake.records).toHaveLength(1);

  // Entering the watch main menu resets CONVOY state.
  notify(fake.monitors, CASIO_ALL_FEATURES_UUID, [0x3d, 0x01]);
  await tick(10);

  const warmup = fake.writes.slice(afterFirst);
  expect(warmup.map((write) => Array.from(write.value))).toEqual([
    Array.from(buildConvoyRequest(0x11)),
  ]);
  // The warm-up echo is ACKed, then the fetch runs again.
  notify(fake.monitors, CASIO_DATA_REQUEST_UUID, echo(0x11, 0));
  await tick(10);
  expect(fake.writes.map((write) => Array.from(write.value))).toContainEqual(
    Array.from(buildConvoyAck(0x11)),
  );
  expect(fake.writes.slice(-1).map((write) => Array.from(write.value))).toEqual([
    Array.from(buildConvoyRequest(0x11)),
  ]);
  await fake.session.close();
});

test("other all-features notifications do not trigger a resync", async () => {
  const fake = createSession({ profile: { ...profile, mainMenuResync: true } });
  fake.session.start();
  await tick();
  const before = fake.writes.length;
  // Alert level (0x0a) and a non-0x01 BLE param payload.
  notify(fake.monitors, CASIO_ALL_FEATURES_UUID, [0x0a, 0x02]);
  notify(fake.monitors, CASIO_ALL_FEATURES_UUID, [0x3d, 0x00]);
  await tick(10);
  expect(fake.writes).toHaveLength(before);
  await fake.session.close();
});
