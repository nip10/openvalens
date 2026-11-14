/**
 * Session tests for the Garmin ML transport and file sync.
 *
 * The fake link speaks the same GFDI/ML frames as `CommunicatorV2` and
 * `FileTransferHandler` at revision 8976702fc3d00e6008c91fe994668cb4027f7bc2.
 * AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  GARMIN_FIT_MESSAGE,
  GARMIN_ML_REQUEST,
  GARMIN_MESSAGE,
  GARMIN_SLEEP_LEVEL,
  GARMIN_TIME_EPOCH,
  encodeGarminCobs,
  encodeGarminGfdiFrame,
  garminCrc16,
  parseGarminMlMessage,
  type GarminGfdiFrame,
  type GarminRecord,
} from "../protocol/garmin";
import {
  createGarminSession,
  createMemoryGarminSyncStateStore,
  type GarminSessionLink,
} from "./garmin";

// ---------------------------------------------------------------------------
// FIT fixtures
// ---------------------------------------------------------------------------

const ENUM = 0x00;
const UINT8 = 0x02;
const UINT32 = 0x86;
const UINT16 = 0x84;
const SINT16 = 0x83;

type Field = readonly [number, number, number];

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function writeUint32(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}

function definition(
  localType: number,
  messageNumber: number,
  fields: readonly Field[],
): Uint8Array {
  const out = [
    0x40 | localType,
    0,
    0,
    messageNumber & 0xff,
    (messageNumber >> 8) & 0xff,
    fields.length,
  ];
  for (const [number, size, base] of fields) out.push(number, size, base);
  return Uint8Array.from(out);
}

function data(
  localType: number,
  fields: readonly Field[],
  values: readonly (number | null)[],
): Uint8Array {
  const out = [localType];
  fields.forEach(([, size, base], index) => {
    const value = values[index];
    const resolved =
      value === null || value === undefined ? (base === UINT8 ? 0xff : 0xffffffff) : value;
    for (let byte = 0; byte < size; byte += 1) out.push((resolved >>> (8 * byte)) & 0xff);
  });
  return Uint8Array.from(out);
}

function fitFile(records: readonly Uint8Array[]): Uint8Array {
  const body = concat(records);
  const header = new Uint8Array(14);
  header[0] = 14;
  header[1] = 0x10;
  writeUint32(header, 4, body.length);
  writeUint32(header, 8, 0x5449462e);
  const withoutCrc = concat([header, body]);
  const crc = new Uint8Array(2);
  const value = garminCrc16(withoutCrc);
  crc[0] = value & 0xff;
  crc[1] = (value >>> 8) & 0xff;
  return concat([withoutCrc, crc]);
}

const MONITORING_FIELDS: readonly Field[] = [
  [253, 4, UINT32],
  [3, 4, UINT32],
  [27, 1, UINT8],
];
const EVENT_FIELDS: readonly Field[] = [
  [0, 1, ENUM],
  [1, 1, ENUM],
  [253, 4, UINT32],
];
const SLEEP_LEVEL_FIELDS: readonly Field[] = [
  [0, 1, ENUM],
  [253, 4, UINT32],
];

const MONITORING_TS16_FIELDS: readonly Field[] = [
  [26, 2, UINT16],
  [3, 4, UINT32],
  [27, 1, UINT8],
];

const SPO2_FIELDS: readonly Field[] = [
  [253, 4, UINT32],
  [0, 1, UINT8],
];
const RESPIRATION_FIELDS: readonly Field[] = [
  [253, 4, UINT32],
  [0, 2, SINT16],
];
const RESTING_HR_FIELDS: readonly Field[] = [
  [253, 4, UINT32],
  [0, 1, UINT8],
  [1, 1, UINT8],
];

const MONITORING_FIT = fitFile([
  definition(0, GARMIN_FIT_MESSAGE.MONITORING, MONITORING_FIELDS),
  data(0, MONITORING_FIELDS, [0x50000, 120, 70]),
  definition(1, GARMIN_FIT_MESSAGE.MONITORING, MONITORING_TS16_FIELDS),
  data(1, MONITORING_TS16_FIELDS, [(0x50000 + 60) & 0xffff, 8, 71]),
  // monitoring_hr_data: 7-day 55, current day 52 (upstream prefers field 1).
  definition(2, GARMIN_FIT_MESSAGE.MONITORING_HR_DATA, RESTING_HR_FIELDS),
  data(2, RESTING_HR_FIELDS, [0x50000 + 120, 55, 52]),
  // spo2_data 95 %, respiration_rate 1450 / 100 = 14.5 breaths/min.
  definition(3, GARMIN_FIT_MESSAGE.SPO2_DATA, SPO2_FIELDS),
  data(3, SPO2_FIELDS, [0x50000 + 180, 95]),
  definition(4, GARMIN_FIT_MESSAGE.RESPIRATION_RATE, RESPIRATION_FIELDS),
  data(4, RESPIRATION_FIELDS, [0x50000 + 180, 1450]),
]);

const STRING = 0x07;
/** A fixed-size FIT string field: UTF-8, NUL-padded. */
function fitString(text: string, size: number): Uint8Array {
  const out = new Uint8Array(size);
  out.set(new TextEncoder().encode(text).subarray(0, size));
  return out;
}
// The string field is last, so its bytes follow `data()`'s numeric ones.
const SESSION_FIELDS: readonly Field[] = [
  [253, 4, UINT32],
  [2, 4, UINT32],
  [7, 4, UINT32],
  [5, 1, ENUM],
];
const SESSION_DEFINITION: readonly Field[] = [...SESSION_FIELDS, [110, 16, STRING]];
const NAME_FIELD: readonly Field[] = [[8, 16, STRING]];
const SPORT_NAME_FIELD: readonly Field[] = [[3, 16, STRING]];
const WORKOUT_START = 0x70000;
// Two sessions (a brick): only the first becomes the workout, as upstream.
// The activity name is empty, so the title falls back to the first session's
// sport profile name, ahead of the sport message's name.
const ACTIVITY_FIT = fitFile([
  definition(1, GARMIN_FIT_MESSAGE.ACTIVITY, NAME_FIELD),
  Uint8Array.of(1, ...fitString("", 16)),
  definition(0, GARMIN_FIT_MESSAGE.SESSION, SESSION_DEFINITION),
  concat([
    data(0, SESSION_FIELDS, [WORKOUT_START + 1800, WORKOUT_START, 1_800_500, 1]),
    fitString("Trail Run ñ", 16),
  ]),
  concat([
    data(0, SESSION_FIELDS, [WORKOUT_START + 3600, WORKOUT_START + 1800, 1_800_000, 2]),
    fitString("Ride", 16),
  ]),
  definition(2, GARMIN_FIT_MESSAGE.SPORT, SPORT_NAME_FIELD),
  Uint8Array.of(2, ...fitString("Running", 16)),
]);

const HRV_FIELDS: readonly Field[] = [
  [253, 4, UINT32],
  [0, 2, UINT16],
  [1, 2, UINT16],
];
const HRV_TIME = 0x80000;
const HRV_FIT = fitFile([
  definition(0, GARMIN_FIT_MESSAGE.HRV_STATUS_SUMMARY, HRV_FIELDS),
  // weekly 50 ms, last night 41.6 ms (raw / 128) -> 42.
  data(0, HRV_FIELDS, [HRV_TIME, 50 * 128, 5325]),
]);

const SLEEP_START = 0x60000;
const SLEEP_FIT = fitFile([
  definition(0, GARMIN_FIT_MESSAGE.EVENT, EVENT_FIELDS),
  data(0, EVENT_FIELDS, [74, 0, SLEEP_START]),
  definition(1, GARMIN_FIT_MESSAGE.SLEEP_LEVEL, SLEEP_LEVEL_FIELDS),
  data(1, SLEEP_LEVEL_FIELDS, [GARMIN_SLEEP_LEVEL.LIGHT, SLEEP_START + 30 * 60]),
  data(1, SLEEP_LEVEL_FIELDS, [GARMIN_SLEEP_LEVEL.DEEP, SLEEP_START + 60 * 60]),
  data(0, EVENT_FIELDS, [74, 1, SLEEP_START + 90 * 60]),
]);

// ---------------------------------------------------------------------------
// Fake ML server
// ---------------------------------------------------------------------------

const DIRECTORY_INDEX = 0;

function directoryEntry(input: {
  fileIndex: number;
  dataType: number;
  subType: number;
  fileNumber?: number;
  size: number;
  timestamp?: number;
}): Uint8Array {
  const out = new Uint8Array(16);
  out[0] = input.fileIndex & 0xff;
  out[1] = (input.fileIndex >>> 8) & 0xff;
  out[2] = input.dataType;
  out[3] = input.subType;
  out[4] = (input.fileNumber ?? 0) & 0xff;
  out[5] = ((input.fileNumber ?? 0) >>> 8) & 0xff;
  writeUint32(out, 8, input.size);
  writeUint32(out, 12, input.timestamp ?? 0);
  return out;
}

function directoryPayload(entries: readonly Uint8Array[]): Uint8Array {
  return concat([...entries, new Uint8Array(16)]);
}

function statusPayload(
  originalMessageType: number,
  status: number,
  detail: number,
  size: number,
): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = originalMessageType & 0xff;
  out[1] = (originalMessageType >>> 8) & 0xff;
  out[2] = status;
  out[3] = detail;
  writeUint32(out, 4, size);
  return out;
}

/** protocol 150, product 3291, unit 1234, software 2000, max packet 375, three names, no MAC. */
const DEVICE_INFORMATION = Uint8Array.of(
  150,
  0,
  0xdb,
  0x0c,
  0xd2,
  0x04,
  0,
  0,
  0xd0,
  0x07,
  0x77,
  0x01,
  1,
  0x46,
  1,
  0x46,
  1,
  0x46,
);

function typeOf(frame: GarminGfdiFrame): string {
  if (frame.messageType !== GARMIN_MESSAGE.RESPONSE) return String(frame.messageType);
  const original = frame.payload[0]! | (frame.payload[1]! << 8);
  return `status:${original}:${frame.payload[2]}${frame.payload.length > 3 && original === GARMIN_MESSAGE.DEVICE_INFORMATION ? ":reply" : ""}`;
}

class FakeGarminServer implements GarminSessionLink {
  protocol: "v0" | "v1" | "v2" = "v2";
  readonly maxWriteBytes = 244;
  readonly gfdi: GarminGfdiFrame[] = [];
  readonly raw: Uint8Array[] = [];
  readonly archived: number[] = [];
  readonly downloads: number[] = [];
  reliable = 0;
  chunkSize = 32;
  /** Send DEVICE_INFORMATION after registration, and CONFIGURATION once it is answered. */
  handshake = true;
  deviceInformation: Uint8Array = DEVICE_INFORMATION;
  chunkDelayMs = 0;
  /** Stop streaming a file after this many chunks (a stalled transfer). */
  stallAfterChunks: number | null = null;
  handle = 0;
  private listener: ((bytes: Uint8Array) => void) | null = null;
  private runningCrc = 0;
  private chunkTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly files: Map<number, Uint8Array>) {}

  subscribeRaw(onNotification: (bytes: Uint8Array) => void): () => void {
    this.listener = onNotification;
    return () => {
      this.listener = null;
    };
  }

  setHandle(handle: number): void {
    this.handle = handle;
  }

  async close(): Promise<void> {
    if (this.chunkTimer) clearTimeout(this.chunkTimer);
    this.listener = null;
  }

  emit(frame: GarminGfdiFrame): void {
    const encoded = encodeGarminCobs(encodeGarminGfdiFrame(frame));
    const out = new Uint8Array(encoded.length + 1);
    out[0] = this.handle;
    out.set(encoded, 1);
    this.listener?.(out);
  }

  async writeRaw(bytes: Uint8Array): Promise<void> {
    this.raw.push(bytes);
    const message = parseGarminMlMessage(bytes);
    if (!message) return;
    if (message.requestType === GARMIN_ML_REQUEST.CLOSE_ALL_REQ) {
      // Handle 0, then the management message (`CommunicatorV2`).
      const response = new Uint8Array(10);
      response[1] = GARMIN_ML_REQUEST.CLOSE_ALL_RESP;
      writeUint32(response, 2, 2);
      // ML management messages are raw: handle 0, then the message.
      this.listener?.(response);
      return;
    }
    if (message.requestType === GARMIN_ML_REQUEST.REGISTER_ML_REQ) {
      const response = new Uint8Array(14);
      response[1] = GARMIN_ML_REQUEST.REGISTER_ML_RESP;
      writeUint32(response, 2, 2);
      response[10] = 1; // GFDI
      response[12] = 0; // status OK
      response[13] = 5; // handle
      const withReliable = new Uint8Array(15);
      withReliable.set(response);
      withReliable[14] = this.reliable;
      this.listener?.(withReliable);
      if (this.reliable === 0 && this.handshake) {
        this.handle = 5;
        this.emit({
          messageType: GARMIN_MESSAGE.DEVICE_INFORMATION,
          payload: this.deviceInformation,
        });
      }
    }
  }

  async write(frame: GarminGfdiFrame): Promise<void> {
    this.gfdi.push(frame);
    if (
      this.handshake &&
      frame.messageType === GARMIN_MESSAGE.RESPONSE &&
      (frame.payload[0]! | (frame.payload[1]! << 8)) === GARMIN_MESSAGE.DEVICE_INFORMATION &&
      frame.payload.length > 3
    ) {
      this.emit({
        messageType: GARMIN_MESSAGE.CONFIGURATION,
        payload: Uint8Array.of(2, 0x01, 0x80),
      });
      return;
    }
    if (frame.messageType === GARMIN_MESSAGE.DOWNLOAD_REQUEST) {
      const fileIndex = frame.payload[0]! | (frame.payload[1]! << 8);
      this.downloads.push(fileIndex);
      const file = this.files.get(fileIndex);
      if (!file) {
        this.emit({
          messageType: GARMIN_MESSAGE.RESPONSE,
          payload: statusPayload(GARMIN_MESSAGE.DOWNLOAD_REQUEST, 0, 1, 0),
        });
        return;
      }
      this.runningCrc = 0;
      this.emit({
        messageType: GARMIN_MESSAGE.RESPONSE,
        payload: statusPayload(GARMIN_MESSAGE.DOWNLOAD_REQUEST, 0, 0, file.length),
      });
      void this.stream(file);
      return;
    }
    if (frame.messageType === GARMIN_MESSAGE.SET_FILE_FLAG) {
      this.archived.push(frame.payload[0]! | (frame.payload[1]! << 8));
    }
  }

  private async stream(file: Uint8Array): Promise<void> {
    let sent = 0;
    for (let offset = 0; offset < file.length; offset += this.chunkSize) {
      if (this.stallAfterChunks !== null && sent >= this.stallAfterChunks) return;
      sent += 1;
      await new Promise<void>((resolve) => {
        this.chunkTimer = setTimeout(resolve, this.chunkDelayMs);
      });
      const chunk = file.subarray(offset, offset + this.chunkSize);
      this.runningCrc = garminCrc16(chunk, this.runningCrc);
      const payload = new Uint8Array(7 + chunk.length);
      payload[0] = 0;
      payload[1] = this.runningCrc & 0xff;
      payload[2] = (this.runningCrc >>> 8) & 0xff;
      writeUint32(payload, 3, offset);
      payload.set(chunk, 7);
      this.emit({ messageType: GARMIN_MESSAGE.FILE_TRANSFER_DATA, payload });
    }
  }

  systemEvents(): number[] {
    return this.gfdi
      .filter((frame) => frame.messageType === GARMIN_MESSAGE.SYSTEM_EVENT)
      .map((frame) => frame.payload[0]!);
  }
}

function fixture(
  options: {
    files?: Map<number, Uint8Array>;
    keepOnDevice?: boolean;
    reliable?: number;
    protocol?: "v0" | "v1" | "v2";
    watchdogMs?: number;
    syncState?: ReturnType<typeof createMemoryGarminSyncStateStore>;
    chunkSize?: number;
    handshake?: boolean;
    configurationWaitMs?: number;
    deviceInformation?: Uint8Array;
    onDirectoryWithoutFitFiles?: (classicAddress: string, signal: AbortSignal) => Promise<boolean>;
  } = {},
) {
  const files =
    options.files ??
    new Map<number, Uint8Array>([
      [
        DIRECTORY_INDEX,
        directoryPayload([
          directoryEntry({ fileIndex: 1, dataType: 128, subType: 32, size: MONITORING_FIT.length }),
          directoryEntry({ fileIndex: 2, dataType: 128, subType: 49, size: SLEEP_FIT.length }),
          directoryEntry({ fileIndex: 3, dataType: 128, subType: 4, size: ACTIVITY_FIT.length }),
          directoryEntry({ fileIndex: 4, dataType: 128, subType: 68, size: HRV_FIT.length }),
          // METRICS (128/44) is not a health file here.
          directoryEntry({ fileIndex: 5, dataType: 128, subType: 44, size: 64 }),
        ]),
      ],
      [1, MONITORING_FIT],
      [2, SLEEP_FIT],
      [3, ACTIVITY_FIT],
      [4, HRV_FIT],
    ]);
  const server = new FakeGarminServer(files);
  server.reliable = options.reliable ?? 0;
  server.protocol = options.protocol ?? "v2";
  server.chunkSize = options.chunkSize ?? 32;
  server.handshake = options.handshake ?? true;
  if (options.deviceInformation) server.deviceInformation = options.deviceInformation;
  const records: GarminRecord[] = [];
  const failures: string[] = [];
  const session = createGarminSession({
    device: {} as never,
    profile: {
      protocol: server.protocol,
      serviceUuid: "6a4e2800-667b-11e3-949a-0800200c9a66",
      readUuid: "6a4e2810-667b-11e3-949a-0800200c9a66",
      writeUuid: "6a4e2820-667b-11e3-949a-0800200c9a66",
      handlePrefixed: server.protocol === "v2",
    },
    deviceId: "watch-1",
    modelId: "garmin_fenix_7",
    onRecord: (record) => records.push(record),
    onFailure: (failure) => failures.push(failure),
    initDelayMs: 0,
    configurationWaitMs: options.configurationWaitMs ?? 2_000,
    watchdogMs: options.watchdogMs ?? 500,
    keepOnDevice: options.keepOnDevice,
    syncState: options.syncState,
    link: server,
    onDirectoryWithoutFitFiles: options.onDirectoryWithoutFitFiles,
  });
  return { session, server, records, failures };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("a full sync downloads health FIT files, emits records and archives them", async () => {
  const f = fixture({ chunkSize: 16 });
  f.session.start();
  await f.session.whenDone();

  expect(f.server.handle).toBe(5);
  expect(f.server.raw).toHaveLength(2);
  expect(parseGarminMlMessage(f.server.raw[0]!)?.requestType).toBe(GARMIN_ML_REQUEST.CLOSE_ALL_REQ);
  expect(parseGarminMlMessage(f.server.raw[1]!)?.requestType).toBe(
    GARMIN_ML_REQUEST.REGISTER_ML_REQ,
  );
  // Directory, then the health files (METRICS is skipped), workouts last.
  expect(f.server.downloads).toEqual([0, 1, 2, 4, 3]);
  expect(f.server.archived).toEqual([1, 2, 4, 3]);
  expect(f.server.systemEvents()).toEqual([8, 0]); // SYNC_READY, SYNC_COMPLETE

  const steps = f.records.filter((record) => record.type === "steps");
  expect(steps).toHaveLength(2);
  const heartRate = f.records.filter((record) => record.type === "heart_rate");
  expect(heartRate).toHaveLength(2);
  const sleep = f.records.filter((record) => record.type === "sleep_session");
  expect(sleep).toHaveLength(1);
  expect(sleep[0]!.startTime).toBe(
    new Date((SLEEP_START + GARMIN_TIME_EPOCH) * 1000).toISOString(),
  );
  const epoch = (seconds: number) => new Date((seconds + GARMIN_TIME_EPOCH) * 1000).toISOString();
  expect(f.records.filter((record) => record.type === "resting_heart_rate")).toEqual([
    { type: "resting_heart_rate", time: epoch(0x50000 + 120), bpm: 52 },
  ]);
  expect(f.records.filter((record) => record.type === "workout")).toEqual([
    {
      type: "workout",
      startTime: epoch(WORKOUT_START),
      // 1 800 500 ms elapsed, rounded up to the second.
      endTime: epoch(WORKOUT_START + 1801),
      activity: "running",
      title: "Trail Run ñ",
    },
  ]);
  expect(f.records.filter((record) => record.type === "oxygen_saturation")).toEqual([
    { type: "oxygen_saturation", time: epoch(0x50000 + 180), percent: 95 },
  ]);
  expect(f.records.filter((record) => record.type === "respiratory_rate")).toEqual([
    { type: "respiratory_rate", time: epoch(0x50000 + 180), breathsPerMinute: 14.5 },
  ]);
  expect(f.records.filter((record) => record.type === "hrv_rmssd")).toEqual([
    { type: "hrv_rmssd", time: epoch(HRV_TIME), rmssdMs: 42 },
  ]);
  expect(f.failures).toEqual([]);
});

test("already-downloaded files are archived and not fetched again", async () => {
  const syncState = createMemoryGarminSyncStateStore();
  // Key: fileIndex:fileNumber:fileSize:timestamp.
  syncState.markDownloaded("watch-1", `2:0:${SLEEP_FIT.length}:0`);
  const f = fixture({ syncState });
  f.session.start();
  await f.session.whenDone();

  expect(f.server.downloads).toEqual([0, 1, 4, 3]);
  expect(f.server.archived).toEqual([1, 2, 4, 3]);
  expect(f.records.filter((record) => record.type === "sleep_session")).toEqual([]);
  expect(f.records.filter((record) => record.type === "steps")).toHaveLength(2);
});

test("keepOnDevice leaves downloaded files on the watch", async () => {
  const f = fixture({ keepOnDevice: true });
  f.session.start();
  await f.session.whenDone();
  expect(f.server.archived).toEqual([]);
});

test("a v1-only GFDI device is refused instead of half-supported", async () => {
  const f = fixture({ protocol: "v1" });
  f.session.start();
  await expect(f.session.whenDone()).rejects.toThrow("GARMIN_ML_REQUIRED");
  expect(f.failures).toEqual(["init"]);
});

test("an MLR registration is refused honestly", async () => {
  const f = fixture({ reliable: 2 });
  f.session.start();
  await expect(f.session.whenDone()).rejects.toThrow("GARMIN_MLR_UNSUPPORTED");
});

test("a missing download status trips the watchdog", async () => {
  const files = new Map<number, Uint8Array>([[DIRECTORY_INDEX, directoryPayload([])]]);
  const server = new FakeGarminServer(files);
  // Swallow the download status so the session waits forever.
  server.write = async (frame: GarminGfdiFrame) => {
    server.gfdi.push(frame);
    if (frame.messageType === GARMIN_MESSAGE.DOWNLOAD_REQUEST) return;
  };
  const session = createGarminSession({
    device: {} as never,
    profile: {
      protocol: "v2",
      serviceUuid: "6a4e2800-667b-11e3-949a-0800200c9a66",
      readUuid: "6a4e2810-667b-11e3-949a-0800200c9a66",
      writeUuid: "6a4e2820-667b-11e3-949a-0800200c9a66",
      handlePrefixed: true,
    },
    deviceId: "watch-1",
    modelId: "garmin_fenix_7",
    onRecord: () => undefined,
    initDelayMs: 0,
    // This server never sends CONFIGURATION.
    configurationWaitMs: 20,
    watchdogMs: 50,
    link: server,
  });
  session.start();
  await expect(session.whenDone()).rejects.toThrow("GARMIN_STATUS_TIMEOUT");
});

test("close() settles a pending session", async () => {
  const f = fixture();
  f.session.start();
  await f.session.close();
  await expect(f.session.whenDone()).resolves.toBeUndefined();
});

test("the handshake answers DEVICE_INFORMATION and CONFIGURATION before asking for files", async () => {
  const f = fixture();
  f.session.start();
  await f.session.whenDone();
  const order = f.server.gfdi.map(typeOf);
  expect(order.slice(0, 6)).toEqual([
    "status:5024:0",
    "status:5024:0:reply",
    "status:5050:0",
    "5050",
    String(GARMIN_MESSAGE.SUPPORTED_FILE_TYPES_REQUEST),
    String(GARMIN_MESSAGE.SYSTEM_EVENT),
  ]);
  const configuration = f.server.gfdi.find((frame) => frame.messageType === 5050)!;
  expect(configuration.payload.length).toBe(18);
  expect(configuration.payload[0]).toBe(17);
});

test("a watch that never sends CONFIGURATION still syncs after the wait", async () => {
  const f = fixture({
    handshake: false,
    configurationWaitMs: 20,
    syncState: createMemoryGarminSyncStateStore(),
  });
  f.session.start();
  await f.session.whenDone();
  expect(f.records.length).toBeGreaterThan(0);
  expect(f.server.gfdi.map(typeOf)[0]).toBe(String(GARMIN_MESSAGE.SUPPORTED_FILE_TYPES_REQUEST));
});

test("auth, time and other watch messages get upstream's replies; unknown ones none", async () => {
  const f = fixture({ handshake: false, configurationWaitMs: 50 });
  f.session.start();
  // Wait for registration, then play the watch's side.
  await new Promise((resolve) => setTimeout(resolve, 10));
  f.server.handle = 5;
  f.server.emit({
    messageType: GARMIN_MESSAGE.AUTH_NEGOTIATION,
    payload: Uint8Array.of(7, 0x81, 0x02, 0, 0),
  });
  f.server.emit({
    messageType: GARMIN_MESSAGE.CURRENT_TIME_REQUEST,
    payload: Uint8Array.of(1, 0, 0, 0),
  });
  f.server.emit({ messageType: GARMIN_MESSAGE.BATTERY_STATUS, payload: Uint8Array.of(0, 0, 80) });
  f.server.emit({ messageType: 5099, payload: new Uint8Array(0) });
  await f.session.whenDone();
  const replies = f.server.gfdi.filter((frame) => frame.messageType === GARMIN_MESSAGE.RESPONSE);
  expect(Array.from(replies[0]!.payload)).toEqual([0xed, 0x13, 0, 0, 7, 0x81, 0, 0, 0]);
  expect(typeOf(replies[1]!)).toBe("status:5052:2");
  expect(typeOf(replies[2]!)).toBe("status:5023:0");
  expect(replies.some((frame) => typeOf(frame).startsWith("status:5099"))).toBe(false);
});

test("close() during the configuration wait settles at once", async () => {
  const f = fixture({ handshake: false, configurationWaitMs: 60_000 });
  f.session.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await f.session.close();
  await expect(f.session.whenDone()).resolves.toBeUndefined();
  expect(f.server.downloads).toEqual([]);
});

test("a compact (sequence-numbered) message gets the status for its full id", async () => {
  const f = fixture({ handshake: false, configurationWaitMs: 50 });
  f.session.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  f.server.emit({
    messageType: GARMIN_MESSAGE.WEATHER_REQUEST,
    sequenceNumber: 3,
    payload: new Uint8Array(0),
  });
  await f.session.whenDone();
  const statuses = f.server.gfdi.filter((frame) => frame.messageType === GARMIN_MESSAGE.RESPONSE);
  expect(typeOf(statuses[0]!)).toBe("status:5014:0");
});

test("failed reply writes neither reject nor hang the session", async () => {
  const f = fixture({ configurationWaitMs: 20, syncState: createMemoryGarminSyncStateStore() });
  const write = f.server.write.bind(f.server);
  let rejected = 0;
  f.server.write = async (frame: GarminGfdiFrame) => {
    const original = frame.payload[0]! | (frame.payload[1]! << 8);
    if (
      frame.messageType === GARMIN_MESSAGE.RESPONSE &&
      original === GARMIN_MESSAGE.DEVICE_INFORMATION
    ) {
      rejected += 1;
      throw new Error("BLE_WRITE_FAILED");
    }
    return write(frame);
  };
  f.session.start();
  await f.session.whenDone();
  expect(rejected).toBe(1); // the chain stops after the failed ACK
  expect(f.records.length).toBeGreaterThan(0);
});

test("a slow file keeps downloading while chunks keep arriving", async () => {
  // 30 ms watchdog, 10 ms per chunk, many chunks: well past 30 ms in total.
  const f = fixture({
    watchdogMs: 30,
    chunkSize: 8,
    syncState: createMemoryGarminSyncStateStore(),
  });
  f.server.chunkDelayMs = 10;
  f.session.start();
  await f.session.whenDone();
  expect(f.server.downloads).toEqual([0, 1, 2, 4, 3]);
  expect(f.records.some((record) => record.type === "workout")).toBe(true);
  expect(f.failures).toEqual([]);
  expect(f.session.complete).toBe(true);
});

test("a stalled transfer stops the sync instead of requesting more files", async () => {
  const f = fixture({ watchdogMs: 40, syncState: createMemoryGarminSyncStateStore() });
  const write = f.server.write.bind(f.server);
  f.server.write = async (frame: GarminGfdiFrame) => {
    // The monitoring file (index 1) stalls after two chunks.
    if (frame.messageType === GARMIN_MESSAGE.DOWNLOAD_REQUEST)
      f.server.stallAfterChunks = (frame.payload[0]! | (frame.payload[1]! << 8)) === 1 ? 2 : null;
    return write(frame);
  };
  f.session.start();
  await f.session.whenDone();
  expect(f.server.downloads).toEqual([0, 1]);
  expect(f.failures).toContain("file_transfer");
  expect(f.server.archived).toEqual([]);
  // Not complete: no SYNC_COMPLETE, so the watch keeps its remaining files.
  expect(f.session.complete).toBe(false);
  expect(f.server.systemEvents()).toEqual([8]);
});

test("health files download before workouts, and oversized files are skipped", async () => {
  const files = new Map<number, Uint8Array>([
    [
      DIRECTORY_INDEX,
      directoryPayload([
        directoryEntry({ fileIndex: 3, dataType: 128, subType: 4, size: ACTIVITY_FIT.length }),
        directoryEntry({ fileIndex: 6, dataType: 128, subType: 4, size: 9 * 1024 * 1024 }),
        directoryEntry({ fileIndex: 1, dataType: 128, subType: 32, size: MONITORING_FIT.length }),
      ]),
    ],
    [1, MONITORING_FIT],
    [3, ACTIVITY_FIT],
  ]);
  const f = fixture({ files, syncState: createMemoryGarminSyncStateStore() });
  f.session.start();
  await f.session.whenDone();
  expect(f.server.downloads).toEqual([0, 1, 3]);
  expect(f.server.archived).toEqual([1, 3]);
});

/** DEVICE_INFORMATION with `hasMac = 1`, BLE then Classic address (little-endian), then the unknown byte. */
const DEVICE_INFORMATION_WITH_MAC = Uint8Array.of(
  ...DEVICE_INFORMATION,
  1,
  0x01,
  0x02,
  0x03,
  0x04,
  0x05,
  0x06,
  0x11,
  0x22,
  0x33,
  0x44,
  0x55,
  0x66,
  0,
);

test("a directory without FIT files hands the sync to the RFCOMM hook with the Classic address", async () => {
  // Edge 520 Plus: the BLE directory lists only non-FIT entries (GarminSupport:1067-1087).
  const files = new Map<number, Uint8Array>([
    [
      DIRECTORY_INDEX,
      directoryPayload([directoryEntry({ fileIndex: 7, dataType: 8, subType: 255, size: 4 })]),
    ],
  ]);
  const calls: string[] = [];
  const f = fixture({
    files,
    deviceInformation: DEVICE_INFORMATION_WITH_MAC,
    onDirectoryWithoutFitFiles: async (classicAddress) => {
      calls.push(classicAddress);
      return true;
    },
  });
  f.session.start();
  await f.session.whenDone();
  expect(calls).toEqual(["66:55:44:33:22:11"]);
  expect(f.server.downloads).toEqual([0]);
  expect(f.session.complete).toBe(true);
  expect(f.server.systemEvents()).toEqual([8, 0]); // SYNC_READY, SYNC_COMPLETE

  // An RFCOMM sync cut short leaves the session incomplete (no SYNC_COMPLETE).
  const short = fixture({
    files,
    deviceInformation: DEVICE_INFORMATION_WITH_MAC,
    onDirectoryWithoutFitFiles: async () => false,
  });
  short.session.start();
  await short.session.whenDone();
  expect(short.session.complete).toBe(false);
  expect(short.server.systemEvents()).toEqual([8]);
});

test("the RFCOMM hook is skipped without a Classic address or when the directory has FIT files", async () => {
  const calls: string[] = [];
  const hook = async (classicAddress: string) => {
    calls.push(classicAddress);
    return true;
  };
  const noMac = fixture({
    files: new Map([[DIRECTORY_INDEX, directoryPayload([])]]),
    onDirectoryWithoutFitFiles: hook,
  });
  noMac.session.start();
  await noMac.session.whenDone();
  const withFit = fixture({
    deviceInformation: DEVICE_INFORMATION_WITH_MAC,
    onDirectoryWithoutFitFiles: hook,
    syncState: createMemoryGarminSyncStateStore(),
  });
  withFit.session.start();
  await withFit.session.whenDone();
  expect(calls).toEqual([]);
  expect(withFit.server.downloads).toEqual([0, 1, 2, 4, 3]);
});
