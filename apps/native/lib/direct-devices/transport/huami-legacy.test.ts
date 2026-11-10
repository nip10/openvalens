/**
 * End-to-end tests for the legacy Huami connection session.
 *
 * Derived from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";
import type { BleError, Characteristic } from "react-native-ble-plx";

import {
  HUAMI_ACTIVITY_CONTROL_UUID,
  HUAMI_ACTIVITY_DATA_UUID,
  HUAMI_AUTH_UUID,
  HUAMI_CURRENT_TIME_UUID,
  HUAMI_HEART_RATE_MEASUREMENT_UUID,
  HUAMI_HEART_RATE_SERVICE_UUID,
  HUAMI_SERVICE_MIBAND2_UUID,
  HUAMI_SERVICE_UUID,
} from "../models/huami-legacy";
import {
  createHuamiLegacySession,
  createMemoryHuamiLegacySyncStateStore,
  selectHuamiLegacyProfile,
  type HuamiLegacyProfile,
} from "./huami-legacy";
import type { HuamiAuthCrypto, HuamiLegacyRecord } from "../protocol/huami-legacy";

const KEY = Uint8Array.from([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
]);
const CHALLENGE = Uint8Array.from([
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
]);
const ENCRYPTED = Uint8Array.from(Buffer.from("69c4e0d86a7b0430d8cdb78070b4c55a", "hex"));

const NOW = new Date("2026-02-01T08:40:00.000Z");
/** Device-local 08:30 with a zero quarter-hour offset. */
const START_TS = Uint8Array.of(0xea, 0x07, 2, 1, 8, 30, 0, 0);

function nodeCrypto(): HuamiAuthCrypto {
  return {
    aesEcbEncrypt(key, data) {
      // Reuse the protocol's own primitive through Node for an independent check.
      const { createCipheriv } = require("node:crypto") as typeof import("node:crypto");
      const cipher = createCipheriv("aes-128-ecb", key, null);
      cipher.setAutoPadding(false);
      return Uint8Array.from(Buffer.concat([cipher.update(data), cipher.final()]));
    },
  };
}

type Write = Readonly<{ service: string; characteristic: string; bytes: Uint8Array }>;
type Response = readonly [service: string, characteristic: string, payload: Uint8Array];

function fakeDevice(respond: (write: Write) => readonly Response[] | void) {
  const monitors = new Map<
    string,
    (error: BleError | null, value: Characteristic | null) => void
  >();
  const writes: Write[] = [];
  const device = {
    monitorCharacteristicForService: (
      service: string,
      characteristic: string,
      callback: (error: BleError | null, value: Characteristic | null) => void,
    ) => {
      const key = `${service}|${characteristic}`;
      monitors.set(key, callback);
      return {
        remove() {
          monitors.delete(key);
        },
      };
    },
    writeCharacteristicWithResponseForService: async (
      service: string,
      characteristic: string,
      value: string,
    ) => {
      const bytes = Uint8Array.from(Buffer.from(value, "base64"));
      const write = { service, characteristic, bytes };
      writes.push(write);
      for (const [responseService, responseCharacteristic, payload] of respond(write) ?? []) {
        const key = `${responseService}|${responseCharacteristic}`;
        queueMicrotask(() =>
          monitors.get(key)?.(null, {
            value: Buffer.from(payload).toString("base64"),
          } as Characteristic),
        );
      }
      return {} as Characteristic;
    },
    readCharacteristicForService: async (): Promise<Characteristic> =>
      ({ value: null }) as unknown as Characteristic,
  };
  return { device, writes, monitors };
}

function characteristic(uuid: string): Characteristic {
  return { uuid, isNotifiable: true, isIndicatable: false } as Characteristic;
}

function profile(): HuamiLegacyProfile {
  return {
    modelId: "amazfit_bip",
    serviceUuid: HUAMI_SERVICE_UUID,
    authServiceUuid: HUAMI_SERVICE_UUID,
    authUuid: HUAMI_AUTH_UUID,
    activityControlUuid: HUAMI_ACTIVITY_CONTROL_UUID,
    activityDataUuid: HUAMI_ACTIVITY_DATA_UUID,
    chunkedUuid: null,
    currentTimeServiceUuid: null,
    currentTimeUuid: null,
    deviceInfoServiceUuid: null,
    firmwareRevisionUuid: null,
    heartRateServiceUuid: HUAMI_HEART_RATE_SERVICE_UUID,
    heartRateMeasurementUuid: HUAMI_HEART_RATE_MEASUREMENT_UUID,
    heartRateControlUuid: null,
  };
}

function authResponder(options: {
  crypt: boolean;
  fail?: boolean;
  challenge?: Uint8Array;
}): (write: Write) => readonly Response[] | void {
  return (write) => {
    if (write.characteristic !== HUAMI_AUTH_UUID) return;
    const command = write.bytes[0]!;
    const auth = HUAMI_SERVICE_UUID;
    if (!options.crypt && command === 0x01)
      return [[auth, HUAMI_AUTH_UUID, Uint8Array.of(0x10, 0x01, 0x01)]];
    if (command === 0x02 || command === 0x82) {
      if (options.crypt && command !== 0x82) throw new Error("EXPECTED_CRYPT_REQUEST");
      if (!options.crypt && command !== 0x02) throw new Error("EXPECTED_PLAIN_REQUEST");
      return [
        [
          auth,
          HUAMI_AUTH_UUID,
          Uint8Array.of(0x10, 0x02, 0x01, ...(options.challenge ?? CHALLENGE)),
        ],
      ];
    }
    if (command === 0x03 || command === 0x83) {
      if (options.crypt && command !== 0x83) throw new Error("EXPECTED_CRYPT_SEND");
      if (!options.crypt && command !== 0x03) throw new Error("EXPECTED_PLAIN_SEND");
      const encrypted = write.bytes.slice(2, 18);
      if (Buffer.compare(Buffer.from(encrypted), Buffer.from(ENCRYPTED)) !== 0)
        throw new Error("BAD_ENCRYPTED_CHALLENGE");
      return [[auth, HUAMI_AUTH_UUID, Uint8Array.of(0x10, 0x03, options.fail ? 0x04 : 0x01)]];
    }
  };
}

function fetchResponder(options: {
  rounds: readonly { expected: number; samples: Uint8Array; timestamp?: Uint8Array }[];
}): (write: Write) => readonly Response[] | void {
  let round = 0;
  return (write) => {
    if (write.characteristic !== HUAMI_ACTIVITY_CONTROL_UUID) return;
    const command = write.bytes[0]!;
    const control = HUAMI_ACTIVITY_CONTROL_UUID;
    const data = HUAMI_ACTIVITY_DATA_UUID;
    if (command === 0x01) {
      const current = options.rounds[round];
      if (!current) throw new Error("UNEXPECTED_ROUND");
      const length = current.expected;
      const response = Uint8Array.of(
        0x10,
        0x01,
        0x01,
        length & 0xff,
        (length >>> 8) & 0xff,
        (length >>> 16) & 0xff,
        (length >>> 24) & 0xff,
        ...(current.timestamp ?? START_TS),
      );
      return [[HUAMI_SERVICE_UUID, control, response]];
    }
    if (command === 0x02) {
      const current = options.rounds[round];
      if (!current) throw new Error("UNEXPECTED_FETCH");
      const responses: Response[] = [];
      const chunkSize = 20;
      let offset = 0;
      let counter = 0;
      while (offset < current.samples.length) {
        const chunk = current.samples.slice(offset, offset + chunkSize);
        responses.push([HUAMI_SERVICE_UUID, data, Uint8Array.of(counter & 0xff, ...chunk)]);
        offset += chunk.length;
        counter += 1;
      }
      responses.push([HUAMI_SERVICE_UUID, control, Uint8Array.of(0x10, 0x02, 0x01)]);
      round += 1;
      return responses;
    }
    if (command === 0x03) {
      return [[HUAMI_SERVICE_UUID, control, Uint8Array.of(0x10, 0x03, 0x01)]];
    }
  };
}

function scripted(
  auth: Parameters<typeof authResponder>[0],
  rounds: Parameters<typeof fetchResponder>[0]["rounds"],
): (write: Write) => readonly Response[] | void {
  const authFn = authResponder(auth);
  const fetchFn = fetchResponder({ rounds });
  return (write) => authFn(write) ?? fetchFn(write);
}

function sessionOptions(
  device: ReturnType<typeof fakeDevice>["device"],
  extra: Partial<Parameters<typeof createHuamiLegacySession>[0]> = {},
) {
  return {
    device,
    deviceId: "device-1",
    profile: profile(),
    authKey: KEY,
    crypto: nodeCrypto(),
    now: () => NOW,
    initDelayMs: 0,
    watchdogMs: 2_000,
    realtime: false,
    syncState: createMemoryHuamiLegacySyncStateStore(),
    onRecord: () => undefined,
    ...extra,
  } satisfies Parameters<typeof createHuamiLegacySession>[0];
}

// ---------------------------------------------------------------------------
// Profile selection
// ---------------------------------------------------------------------------

test("selectHuamiLegacyProfile requires FEE0 activity characteristics and finds auth in FEE1", async () => {
  const device = {
    characteristicsForService: async (service: string) =>
      service === HUAMI_SERVICE_UUID
        ? [
            characteristic(HUAMI_ACTIVITY_CONTROL_UUID),
            characteristic(HUAMI_ACTIVITY_DATA_UUID),
            characteristic(HUAMI_CURRENT_TIME_UUID),
          ]
        : service === HUAMI_SERVICE_MIBAND2_UUID
          ? [characteristic(HUAMI_AUTH_UUID)]
          : service === HUAMI_HEART_RATE_SERVICE_UUID
            ? [characteristic(HUAMI_HEART_RATE_MEASUREMENT_UUID)]
            : [],
  };
  const selected = await selectHuamiLegacyProfile(
    device,
    [HUAMI_SERVICE_UUID, HUAMI_SERVICE_MIBAND2_UUID, HUAMI_HEART_RATE_SERVICE_UUID],
    "amazfit_bip",
  );
  expect(selected).toMatchObject({
    modelId: "amazfit_bip",
    authServiceUuid: HUAMI_SERVICE_MIBAND2_UUID,
    authUuid: HUAMI_AUTH_UUID,
    heartRateMeasurementUuid: HUAMI_HEART_RATE_MEASUREMENT_UUID,
  });
  expect(selected?.chunkedUuid).toBeNull();
});

test("selectHuamiLegacyProfile rejects a device without FEE0 activity data", async () => {
  const device = {
    characteristicsForService: async (service: string) =>
      service === HUAMI_SERVICE_UUID ? [characteristic(HUAMI_ACTIVITY_CONTROL_UUID)] : [],
  };
  expect(await selectHuamiLegacyProfile(device, [HUAMI_SERVICE_UUID], "amazfit_bip")).toBeNull();
});

test("selectHuamiLegacyProfile rejects a device with no auth characteristic", async () => {
  const device = {
    characteristicsForService: async (service: string) =>
      service === HUAMI_SERVICE_UUID
        ? [characteristic(HUAMI_ACTIVITY_CONTROL_UUID), characteristic(HUAMI_ACTIVITY_DATA_UUID)]
        : [],
  };
  expect(await selectHuamiLegacyProfile(device, [HUAMI_SERVICE_UUID], "amazfit_bip")).toBeNull();
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

test("the three-step handshake authenticates and then fetches activity", async () => {
  const { device, writes } = fakeDevice(
    scripted({ crypt: false }, [
      { expected: 8, samples: Uint8Array.of(9, 10, 3, 60, 11, 5, 0, 0) },
    ]),
  );
  const records: HuamiLegacyRecord[] = [];
  const session = createHuamiLegacySession(
    sessionOptions(device, {
      onRecord: (record) => records.push(record),
      maxRounds: 1,
    }),
  );
  session.start();
  await session.whenDone();

  const authWrites = writes.filter((write) => write.characteristic === HUAMI_AUTH_UUID);
  expect(authWrites.map((write) => write.bytes[0])).toEqual([0x01, 0x02, 0x03]);
  expect(authWrites[0]!.bytes[1]).toBe(0x08);
  expect(records.filter((record) => record.type === "steps")).toHaveLength(2);
  expect(records.filter((record) => record.type === "heart_rate")).toEqual([
    { type: "heart_rate", time: "2026-02-01T08:30:00.000Z", bpm: 60 },
  ]);
});

test("the crypt handshake skips send-key and uses the 0x80 commands", async () => {
  const { device, writes } = fakeDevice(
    scripted({ crypt: true }, [{ expected: 0, samples: new Uint8Array(0) }]),
  );
  const session = createHuamiLegacySession(
    sessionOptions(device, {
      authFlags: 0x00,
      cryptFlags: 0x80,
      maxRounds: 1,
    }),
  );
  session.start();
  await session.whenDone();

  const authWrites = writes.filter((write) => write.characteristic === HUAMI_AUTH_UUID);
  expect(authWrites.map((write) => write.bytes[0])).toEqual([0x82, 0x83]);
  expect(authWrites[0]!.bytes[1]).toBe(0x00);
});

test("an AUTH_FAIL response rejects the session", async () => {
  const { device } = fakeDevice((write) => authResponder({ crypt: false, fail: true })(write));
  const session = createHuamiLegacySession(sessionOptions(device));
  session.start();
  await expect(session.whenDone()).rejects.toThrow("HUAMI_AUTH_FAILED");
});

test("a crypt AUTH_FAIL response rejects the session", async () => {
  const { device } = fakeDevice((write) => authResponder({ crypt: true, fail: true })(write));
  const session = createHuamiLegacySession(
    sessionOptions(device, { authFlags: 0x00, cryptFlags: 0x80 }),
  );
  session.start();
  await expect(session.whenDone()).rejects.toThrow("HUAMI_AUTH_FAILED");
});

test("a missing key rejects the session", async () => {
  const { device } = fakeDevice(() => undefined);
  const session = createHuamiLegacySession(sessionOptions(device, { authKey: undefined }));
  session.start();
  await expect(session.whenDone()).rejects.toThrow("HUAMI_AUTH_KEY_REQUIRED");
});

// ---------------------------------------------------------------------------
// Fetch loop
// ---------------------------------------------------------------------------

test("the fetch loop repeats until the device reports no data", async () => {
  const { device, writes } = fakeDevice(
    scripted({ crypt: false }, [
      { expected: 8, samples: Uint8Array.of(9, 10, 3, 60, 11, 5, 0, 0) },
      {
        expected: 4,
        samples: Uint8Array.of(1, 0, 7, 0),
        timestamp: Uint8Array.of(0xea, 0x07, 2, 1, 8, 32, 0, 0),
      },
      { expected: 0, samples: new Uint8Array(0) },
    ]),
  );
  const records: HuamiLegacyRecord[] = [];
  const session = createHuamiLegacySession(
    sessionOptions(device, {
      onRecord: (record) => records.push(record),
      lookbackMs: 10 * 60_000,
    }),
  );
  session.start();
  await session.whenDone();

  const steps = records.filter((record) => record.type === "steps");
  expect(steps).toHaveLength(3);
  expect(steps.map((record) => record.type === "steps" && record.startTime)).toEqual([
    "2026-02-01T08:30:00.000Z",
    "2026-02-01T08:31:00.000Z",
    "2026-02-01T08:32:00.000Z",
  ]);
  const startWrites = writes.filter(
    (write) => write.characteristic === HUAMI_ACTIVITY_CONTROL_UUID && write.bytes[0] === 0x01,
  );
  expect(startWrites).toHaveLength(3);
});

test("sleep sessions are derived once after the fetch", async () => {
  const samples = Uint8Array.from([
    ...Array.from({ length: 3 }, () => [9, 0, 0, 0]).flat(),
    ...Array.from({ length: 3 }, () => [11, 0, 0, 0]).flat(),
    ...Array.from({ length: 4 }, () => [9, 0, 0, 0]).flat(),
  ]);
  const { device } = fakeDevice(
    scripted({ crypt: false }, [{ expected: samples.length, samples }]),
  );
  const records: HuamiLegacyRecord[] = [];
  const session = createHuamiLegacySession(
    sessionOptions(device, {
      onRecord: (record) => records.push(record),
      maxRounds: 1,
    }),
  );
  session.start();
  await session.whenDone();

  const sleep = records.filter((record) => record.type === "sleep_session");
  expect(sleep).toHaveLength(1);
  expect(sleep[0]).toMatchObject({
    startTime: "2026-02-01T08:30:00.000Z",
    endTime: "2026-02-01T08:40:00.000Z",
  });
  expect(sleep[0]!.stages?.map((stage) => stage.stage)).toEqual(["light", "deep", "light"]);
});

test("a firmware-gated model reads the firmware and switches to 8-byte samples", async () => {
  const samples = Uint8Array.of(9, 0, 4, 60, 0, 0, 0, 0);
  const { device } = fakeDevice(scripted({ crypt: true }, [{ expected: samples.length, samples }]));
  device.readCharacteristicForService = async () =>
    ({ value: Buffer.from("1.3.5.79").toString("base64") }) as Characteristic;
  const records: HuamiLegacyRecord[] = [];
  const session = createHuamiLegacySession({
    ...sessionOptions(device, {
      authFlags: 0x00,
      cryptFlags: 0x80,
      onRecord: (record) => records.push(record),
      maxRounds: 1,
    }),
    sampleSizeRule: { kind: "firmware_gated", rule: "gtr", below: 4, atLeast: 8 },
    profile: {
      ...profile(),
      deviceInfoServiceUuid: "0000180a-0000-1000-8000-00805f9b34fb",
      firmwareRevisionUuid: "00002a26-0000-1000-8000-00805f9b34fb",
    },
  });
  session.start();
  await session.whenDone();

  const steps = records.filter((record) => record.type === "steps");
  expect(steps).toHaveLength(1);
  expect(steps[0]).toMatchObject({ count: 4 });
});

// ---------------------------------------------------------------------------
// Realtime heart rate
// ---------------------------------------------------------------------------

test("realtime heart rate starts continuous measurement and dispatches samples", async () => {
  const { device, monitors } = fakeDevice(
    scripted({ crypt: false }, [{ expected: 0, samples: new Uint8Array(0) }]),
  );
  const live: HuamiLegacyRecord[] = [];
  const session = createHuamiLegacySession(
    sessionOptions(device, {
      onLiveHeartRate: (record) => live.push(record),
      realtime: true,
      maxRounds: 1,
      profile: { ...profile(), heartRateControlUuid: "00002a39-0000-1000-8000-00805f9b34fb" },
    }),
  );
  session.start();
  await session.whenDone();

  const heartRateMonitor = monitors.get(
    `${HUAMI_HEART_RATE_SERVICE_UUID}|${HUAMI_HEART_RATE_MEASUREMENT_UUID}`,
  );
  expect(heartRateMonitor).toBeDefined();
  heartRateMonitor!(null, {
    value: Buffer.from(Uint8Array.of(0x00, 72)).toString("base64"),
  } as Characteristic);
  expect(live).toEqual([{ type: "heart_rate", time: NOW.toISOString(), bpm: 72 }]);

  await session.close();
});
