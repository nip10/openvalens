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

const MONITORING_FIT = fitFile([
  definition(0, GARMIN_FIT_MESSAGE.MONITORING, MONITORING_FIELDS),
  data(0, MONITORING_FIELDS, [0x50000, 120, 70]),
  definition(1, GARMIN_FIT_MESSAGE.MONITORING, MONITORING_TS16_FIELDS),
  data(1, MONITORING_TS16_FIELDS, [(0x50000 + 60) & 0xffff, 8, 71]),
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

class FakeGarminServer implements GarminSessionLink {
  protocol: "v0" | "v1" | "v2" = "v2";
  readonly maxWriteBytes = 244;
  readonly gfdi: GarminGfdiFrame[] = [];
  readonly raw: Uint8Array[] = [];
  readonly archived: number[] = [];
  readonly downloads: number[] = [];
  reliable = 0;
  chunkSize = 32;
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

  private emit(frame: GarminGfdiFrame): void {
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
    }
  }

  async write(frame: GarminGfdiFrame): Promise<void> {
    this.gfdi.push(frame);
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
    for (let offset = 0; offset < file.length; offset += this.chunkSize) {
      await new Promise<void>((resolve) => {
        this.chunkTimer = setTimeout(resolve, 0);
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
          directoryEntry({ fileIndex: 3, dataType: 128, subType: 4, size: 64 }),
        ]),
      ],
      [1, MONITORING_FIT],
      [2, SLEEP_FIT],
    ]);
  const server = new FakeGarminServer(files);
  server.reliable = options.reliable ?? 0;
  server.protocol = options.protocol ?? "v2";
  server.chunkSize = options.chunkSize ?? 32;
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
    watchdogMs: options.watchdogMs ?? 500,
    keepOnDevice: options.keepOnDevice,
    syncState: options.syncState,
    link: server,
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
  // Directory, then only the two health files (ACTIVITY is skipped).
  expect(f.server.downloads).toEqual([0, 1, 2]);
  expect(f.server.archived).toEqual([1, 2]);
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
  expect(f.failures).toEqual([]);
});

test("already-downloaded files are archived and not fetched again", async () => {
  const syncState = createMemoryGarminSyncStateStore();
  // Key: fileIndex:fileNumber:fileSize:timestamp.
  syncState.markDownloaded("watch-1", `2:0:${SLEEP_FIT.length}:0`);
  const f = fixture({ syncState });
  f.session.start();
  await f.session.whenDone();

  expect(f.server.downloads).toEqual([0, 1]);
  expect(f.server.archived).toEqual([1, 2]);
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
