/**
 * Codec tests for the Garmin GFDI + FIT layer.
 *
 * Vectors are derived from the upstream framing (`CobsCoDec`, `GFDIMessage`,
 * `ChecksumCalculator`, `FileTransferHandler`) and the FIT profile at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  GARMIN_OUR_CAPABILITIES,
  buildGarminAuthNegotiationStatus,
  buildGarminConfiguration,
  buildGarminDeviceInformationReply,
  buildGarminStatusPayload,
  parseGarminDeviceInformation,
  GARMIN_FILE_FLAG,
  GARMIN_FIT_MESSAGE,
  GARMIN_ML_REQUEST,
  GARMIN_MESSAGE,
  GARMIN_SLEEP_LEVEL,
  GARMIN_TIME_EPOCH,
  buildGarminDownloadRequest,
  buildGarminMlCloseAll,
  buildGarminMlRegisterService,
  buildGarminSetFileFlags,
  buildGarminSystemEvent,
  buildGarminTransferDataStatus,
  decodeGarminGfdiFrame,
  decodeGarminMonitoring,
  decodeGarminSleepLevels,
  encodeGarminCobs,
  encodeGarminGfdiFrame,
  garminCrc16,
  garminFitRecords,
  isGarminDirectorySentinel,
  isGarminHealthFile,
  parseGarminDirectory,
  parseGarminFileTransferData,
  parseGarminMlMessage,
  parseGarminStatus,
  segmentGarminSleepSessions,
  type GarminFitMessage,
  type GarminHeartRateRecord,
  type GarminRecord,
  type GarminSleepSession,
  type GarminStepsRecord,
} from "./garmin";

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const stepsOf = (records: readonly GarminRecord[]): GarminStepsRecord[] =>
  records.filter((record): record is GarminStepsRecord => record.type === "steps");
const heartRateOf = (records: readonly GarminRecord[]): GarminHeartRateRecord[] =>
  records.filter((record): record is GarminHeartRateRecord => record.type === "heart_rate");
const sleepOf = (records: readonly GarminRecord[]): GarminSleepSession[] =>
  records.filter((record): record is GarminSleepSession => record.type === "sleep_session");

// FIT base type identifiers.
const ENUM = 0x00;
const UINT8 = 0x02;
const BYTE = 0x0d;
const UINT16 = 0x84;
const UINT32 = 0x86;
const SINT16 = 0x83;

type Field = readonly [number, number, number]; // number, size, base type

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

function invalidFor(base: number): number {
  if (base === UINT8 || base === ENUM || base === BYTE) return 0xff;
  if (base === UINT16) return 0xffff;
  if (base === UINT32) return 0xffffffff;
  if (base === SINT16) return 0x7fff;
  return 0;
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
    const resolved = value === null || value === undefined ? invalidFor(base) : value;
    for (let byte = 0; byte < size; byte += 1) out.push((resolved >>> (8 * byte)) & 0xff);
  });
  return Uint8Array.from(out);
}

function compressed(
  localType: number,
  timeOffset: number,
  fields: readonly Field[],
  values: readonly (number | null)[],
): Uint8Array {
  const record = data(localType, fields, values);
  record[0] = 0x80 | ((localType & 0x03) << 5) | (timeOffset & 0x1f);
  return record;
}

function fitFile(records: readonly Uint8Array[]): Uint8Array {
  const body = concat(records);
  const header = new Uint8Array(14);
  header[0] = 14;
  header[1] = 0x10;
  writeUint32(header, 4, body.length);
  writeUint32(header, 8, 0x5449462e); // ".FIT"
  const withoutCrc = concat([header, body]);
  const crc = new Uint8Array(2);
  const value = garminCrc16(withoutCrc);
  crc[0] = value & 0xff;
  crc[1] = (value >>> 8) & 0xff;
  return concat([withoutCrc, crc]);
}

const MONITORING_FIELDS: readonly Field[] = [
  [253, 4, UINT32], // timestamp
  [3, 4, UINT32], // cycles (profile scale 2)
  [27, 1, UINT8], // heart_rate
  [2, 4, UINT32], // distance (profile scale 100)
  [19, 2, UINT16], // active_calories
  [24, 1, BYTE], // current_activity_type_intensity
];
const MONITORING_TS16_FIELDS: readonly Field[] = [
  [26, 2, UINT16], // timestamp_16
  [3, 4, UINT32],
  [27, 1, UINT8],
  [2, 4, UINT32],
];
const SLEEP_LEVEL_FIELDS: readonly Field[] = [
  [0, 1, ENUM],
  [253, 4, UINT32],
];
const SLEEP_LEVEL_COMPRESSED_FIELDS: readonly Field[] = [[0, 1, ENUM]];
const EVENT_FIELDS: readonly Field[] = [
  [0, 1, ENUM],
  [1, 1, ENUM],
  [253, 4, UINT32],
];
const NAP_FIELDS: readonly Field[] = [
  [0, 4, UINT32],
  [2, 4, UINT32],
];

// ---------------------------------------------------------------------------
// COBS
// ---------------------------------------------------------------------------

test("COBS escapes 254-byte blocks and round-trips zero runs", () => {
  const long = Uint8Array.from({ length: 300 }, (_, index) => (index + 1) % 256 || 1);
  const encoded = encodeGarminCobs(long);
  expect(encoded[0]).toBe(0);
  expect(encoded[encoded.length - 1]).toBe(0);
  expect(encoded[1]).toBe(0xff);
  expect(encoded[256]).toBe(47);

  const withZeroAtBoundary = Uint8Array.from({ length: 300 }, (_, index) =>
    index === 254 ? 0 : 7,
  );
  expect(encodeGarminCobs(withZeroAtBoundary)[1]).toBe(0xff);
  expect(hex(encodeGarminCobs(Uint8Array.of(0, 1, 0)))).toBe("000102010100");
});

// ---------------------------------------------------------------------------
// GFDI framing
// ---------------------------------------------------------------------------

test("GFDI frames match the upstream length/type/CRC vector", () => {
  const frame = encodeGarminGfdiFrame({
    messageType: GARMIN_MESSAGE.SUPPORTED_FILE_TYPES_REQUEST,
    payload: new Uint8Array(0),
  });
  // 06 00 length, a7 13 type (5031), 3b 75 CRC-16/ARC.
  expect(hex(frame)).toBe("0600a7133b75");
  expect(decodeGarminGfdiFrame(frame)).toEqual({
    messageType: 5031,
    payload: new Uint8Array(0),
  });
});

test("GFDI sequence numbers live in the type word's high bit", () => {
  const frame = encodeGarminGfdiFrame({
    messageType: GARMIN_MESSAGE.DOWNLOAD_REQUEST,
    payload: Uint8Array.of(1, 2),
    sequenceNumber: 3,
  });
  expect(hex(frame)).toBe("0800028301027149");
  expect(decodeGarminGfdiFrame(frame)).toEqual({
    messageType: 5002,
    payload: Uint8Array.of(1, 2),
    sequenceNumber: 3,
  });
  expect(() =>
    encodeGarminGfdiFrame({ messageType: 5002, payload: new Uint8Array(0), sequenceNumber: 128 }),
  ).toThrow("GARMIN_SEQUENCE");
});

test("GFDI rejects a bad CRC and a mismatched length", () => {
  const frame = encodeGarminGfdiFrame({
    messageType: GARMIN_MESSAGE.SYSTEM_EVENT,
    payload: buildGarminSystemEvent(8),
  });
  const badCrc = frame.slice();
  badCrc[badCrc.length - 1] = badCrc[badCrc.length - 1]! ^ 0xff;
  expect(() => decodeGarminGfdiFrame(badCrc)).toThrow("GARMIN_PACKET_CRC");
  const badLength = frame.slice();
  badLength[0] = (badLength[0]! + 1) & 0xff;
  expect(() => decodeGarminGfdiFrame(badLength)).toThrow("GARMIN_PACKET_LENGTH");
});

// ---------------------------------------------------------------------------
// File transfer
// ---------------------------------------------------------------------------

test("directory records decode the 16-byte little-endian layout", () => {
  const record = new Uint8Array(16);
  record[0] = 0x02;
  record[1] = 0x01; // fileIndex 0x0102
  record[2] = 128;
  record[3] = 32;
  record[4] = 0x03;
  record[5] = 0x00; // fileNumber 3
  record[6] = 0x01; // specific flags
  record[7] = 0x02; // file flags
  writeUint32(record, 8, 0x1234);
  writeUint32(record, 12, 0x12345678);
  const [entry] = parseGarminDirectory(record);
  expect(entry).toEqual({
    fileIndex: 0x0102,
    dataType: 128,
    subType: 32,
    fileNumber: 3,
    specificFlags: 1,
    fileFlags: 2,
    fileSize: 0x1234,
    timestamp: 0x12345678,
  });
  expect(isGarminHealthFile(entry!)).toBe(true);
  expect(isGarminDirectorySentinel(entry!)).toBe(false);

  const sentinel = parseGarminDirectory(new Uint8Array(16))[0]!;
  expect(isGarminDirectorySentinel(sentinel)).toBe(true);
  expect(isGarminHealthFile(sentinel)).toBe(false);

  expect(() => parseGarminDirectory(new Uint8Array(15))).toThrow("GARMIN_DIRECTORY_LENGTH");
});

test("a download request matches the upstream writer layout", () => {
  expect(hex(buildGarminDownloadRequest({ fileIndex: 0x0102 }))).toBe(
    "0201000000000100000000000000",
  );
  expect(
    hex(
      buildGarminDownloadRequest({
        fileIndex: 7,
        dataOffset: 16,
        requestType: 0,
        crcSeed: 0x1234,
        dataSize: 32,
        flags: 1,
      }),
    ),
  ).toBe("0700100000000034122000000001");
});

test("file transfer chunks and statuses round-trip", () => {
  const chunk = new Uint8Array(7 + 4);
  chunk[0] = 0;
  chunk[1] = 0x34;
  chunk[2] = 0x12;
  writeUint32(chunk, 3, 64);
  chunk.set(Uint8Array.of(9, 8, 7, 6), 7);
  expect(parseGarminFileTransferData(chunk)).toEqual({
    flags: 0,
    crc: 0x1234,
    dataOffset: 64,
    data: Uint8Array.of(9, 8, 7, 6),
  });

  expect(hex(buildGarminTransferDataStatus(68))).toBe("8c13000044000000");
  expect(parseGarminStatus(buildGarminTransferDataStatus(68))).toEqual({
    originalMessageType: GARMIN_MESSAGE.FILE_TRANSFER_DATA,
    status: 0,
    downloadStatus: null,
    maxFileSize: null,
    transferStatus: 0,
    transferOffset: 68,
  });

  const downloadStatus = new Uint8Array(8);
  downloadStatus[0] = 0x8a;
  downloadStatus[1] = 0x13; // 5002
  downloadStatus[2] = 0; // ACK
  downloadStatus[3] = 0; // OK
  writeUint32(downloadStatus, 4, 4096);
  expect(parseGarminStatus(downloadStatus)).toMatchObject({
    originalMessageType: GARMIN_MESSAGE.DOWNLOAD_REQUEST,
    status: 0,
    downloadStatus: 0,
    maxFileSize: 4096,
  });

  expect(hex(buildGarminSetFileFlags(0x0102, GARMIN_FILE_FLAG.ARCHIVE))).toBe("020110");
});

test("ML handle management frames match CommunicatorV2", () => {
  expect(hex(buildGarminMlCloseAll())).toBe("00050200000000000000000000");
  expect(hex(buildGarminMlRegisterService(1))).toBe("00000200000000000000010000");
  expect(parseGarminMlMessage(buildGarminMlCloseAll())).toMatchObject({
    requestType: GARMIN_ML_REQUEST.CLOSE_ALL_REQ,
  });
  expect(parseGarminMlMessage(buildGarminMlRegisterService(1))).toMatchObject({
    requestType: GARMIN_ML_REQUEST.REGISTER_ML_REQ,
    service: 1,
  });

  const registered = new Uint8Array(15);
  registered[1] = GARMIN_ML_REQUEST.REGISTER_ML_RESP;
  writeUint32(registered, 2, 2); // client id 2
  registered[10] = 1; // GFDI
  registered[12] = 0; // status OK
  registered[13] = 5; // handle
  registered[14] = 0; // reliable
  expect(parseGarminMlMessage(registered)).toEqual({
    requestType: GARMIN_ML_REQUEST.REGISTER_ML_RESP,
    service: 1,
    status: 0,
    handle: 5,
    reliable: 0,
  });

  const foreign = registered.slice();
  foreign[2] = 9; // not our client id
  expect(parseGarminMlMessage(foreign)).toBeNull();
});

// ---------------------------------------------------------------------------
// FIT parsing
// ---------------------------------------------------------------------------

test("MONITORING decodes cycles, heart rate, distance and the activity bitmap", () => {
  const base = 0xfff0;
  const file = fitFile([
    definition(0, GARMIN_FIT_MESSAGE.MONITORING, MONITORING_FIELDS),
    data(0, MONITORING_FIELDS, [base, 120, 70, 500, 3, 0xe5]),
  ]);
  const records = garminFitRecords(file);
  const startTime = new Date((base + GARMIN_TIME_EPOCH) * 1000).toISOString();
  expect(stepsOf(records)).toEqual([
    {
      type: "steps",
      startTime,
      endTime: new Date(Date.parse(startTime) + 60_000).toISOString(),
      count: 120,
    },
  ]);
  expect(heartRateOf(records)).toEqual([{ type: "heart_rate", time: startTime, bpm: 70 }]);

  const messages: GarminFitMessage[] = [
    {
      messageNumber: GARMIN_FIT_MESSAGE.MONITORING,
      timestamp: base + GARMIN_TIME_EPOCH,
      fields: new Map([
        [253, base],
        [3, 120],
        [27, 70],
        [2, 500],
        [19, 3],
        [24, 0xe5],
      ]),
    },
  ];
  expect(decodeGarminMonitoring(messages)[0]).toMatchObject({
    steps: 120,
    heartRate: 70,
    distanceMeters: 5,
    activeCalories: 3,
    activityType: 5,
    intensity: 7,
  });

  // Messages sharing a timestamp are summed across activity types, exactly like
  // `FitImporter.persistActivitySamples`. The first record is activity type 5
  // (0xe5 & 0x1f) with intensity 7 (0xe5 >> 5); the second is type 7 (0x67 &
  // 0x1f) with intensity 3 (0x67 >> 5).
  const aggregated = decodeGarminMonitoring([
    ...messages,
    {
      messageNumber: GARMIN_FIT_MESSAGE.MONITORING,
      timestamp: base + GARMIN_TIME_EPOCH,
      fields: new Map([
        [253, base],
        [3, 4],
        [27, 72],
        [2, 100],
        [19, 1],
        [24, 0x67],
      ]),
    },
  ]);
  expect(aggregated).toHaveLength(1);
  expect(aggregated[0]).toMatchObject({
    steps: 124,
    heartRate: 72,
    distanceMeters: 6,
    activeCalories: 4,
    activityType: 5,
    intensity: 3,
  });

  // A second record for the *same* activity type overwrites the first rather
  // than adding to it (Garmin reports cumulative per-activity totals).
  const overwritten = decodeGarminMonitoring([
    ...messages,
    {
      messageNumber: GARMIN_FIT_MESSAGE.MONITORING,
      timestamp: base + GARMIN_TIME_EPOCH,
      fields: new Map([
        [253, base],
        [3, 30],
        [27, 73],
        [2, 200],
        [19, 2],
        [24, 0xe5],
      ]),
    },
  ]);
  expect(overwritten).toHaveLength(1);
  expect(overwritten[0]).toMatchObject({
    steps: 30,
    heartRate: 73,
    distanceMeters: 2,
    activeCalories: 2,
    activityType: 5,
    intensity: 7,
  });
});

test("MONITORING resolves timestamp_16 rollover across the 16-bit boundary", () => {
  const base = 0xfff0;
  const file = fitFile([
    definition(0, GARMIN_FIT_MESSAGE.MONITORING, MONITORING_FIELDS),
    data(0, MONITORING_FIELDS, [base, 120, 70, 500, 3, 0xe5]),
    definition(1, GARMIN_FIT_MESSAGE.MONITORING, MONITORING_TS16_FIELDS),
    data(1, MONITORING_TS16_FIELDS, [(base + 60) & 0xffff, 4, null, null]),
    data(1, MONITORING_TS16_FIELDS, [(base + 120) & 0xffff, 6, 71, null]),
  ]);
  const records = garminFitRecords(file);
  expect(stepsOf(records).map((record) => record.count)).toEqual([120, 4, 6]);
  expect(stepsOf(records)[1]!.startTime).toBe(
    new Date((base + 60 + GARMIN_TIME_EPOCH) * 1000).toISOString(),
  );
  expect(stepsOf(records)[2]!.startTime).toBe(
    new Date((base + 120 + GARMIN_TIME_EPOCH) * 1000).toISOString(),
  );
  expect(heartRateOf(records).map((record) => record.bpm)).toEqual([70, 71]);
});

test("compressed timestamps resolve against the last full timestamp", () => {
  const base = 0x12340;
  const file = fitFile([
    definition(0, GARMIN_FIT_MESSAGE.MONITORING, MONITORING_FIELDS),
    data(0, MONITORING_FIELDS, [base, 10, 60, null, null, null]),
    definition(1, GARMIN_FIT_MESSAGE.SLEEP_LEVEL, SLEEP_LEVEL_COMPRESSED_FIELDS),
    compressed(1, (base + 60) & 0x1f, SLEEP_LEVEL_COMPRESSED_FIELDS, [GARMIN_SLEEP_LEVEL.LIGHT]),
  ]);
  const levels = decodeGarminSleepLevels([
    {
      messageNumber: GARMIN_FIT_MESSAGE.SLEEP_LEVEL,
      timestamp: base + 60 + GARMIN_TIME_EPOCH,
      fields: new Map([[0, GARMIN_SLEEP_LEVEL.LIGHT]]),
    },
  ]);
  expect(levels).toHaveLength(1);
  // A single level with no EVENT pair segments on its own and is discarded for
  // being under five minutes.
  expect(sleepOf(garminFitRecords(file))).toEqual([]);
});

test("SLEEP_LEVEL with EVENT pairs becomes an event-bounded session", () => {
  const start = 0x20000;
  const end = start + 120 * 60;
  const iso = (seconds: number) => new Date((seconds + GARMIN_TIME_EPOCH) * 1000).toISOString();
  const file = fitFile([
    definition(0, GARMIN_FIT_MESSAGE.EVENT, EVENT_FIELDS),
    data(0, EVENT_FIELDS, [74, 0, start]),
    definition(1, GARMIN_FIT_MESSAGE.SLEEP_LEVEL, SLEEP_LEVEL_FIELDS),
    data(1, SLEEP_LEVEL_FIELDS, [GARMIN_SLEEP_LEVEL.LIGHT, start + 30 * 60]),
    data(1, SLEEP_LEVEL_FIELDS, [GARMIN_SLEEP_LEVEL.DEEP, start + 60 * 60]),
    data(1, SLEEP_LEVEL_FIELDS, [GARMIN_SLEEP_LEVEL.REM, start + 90 * 60]),
    data(0, EVENT_FIELDS, [74, 1, end]),
  ]);
  const sessions = sleepOf(garminFitRecords(file));
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toEqual({
    type: "sleep_session",
    startTime: iso(start),
    endTime: iso(end),
    stages: [
      { stage: "light", startTime: iso(start), endTime: iso(start + 30 * 60) },
      { stage: "deep", startTime: iso(start + 30 * 60), endTime: iso(start + 60 * 60) },
      { stage: "rem", startTime: iso(start + 60 * 60), endTime: iso(end) },
    ],
  });
});

test("SLEEP_LEVEL without events falls back to huami-style segmentation", () => {
  const start = 0x30000;
  const ms = (seconds: number) => (seconds + GARMIN_TIME_EPOCH) * 1000;
  const sessions = segmentGarminSleepSessions({
    levels: [
      { timestamp: ms(start), level: GARMIN_SLEEP_LEVEL.LIGHT },
      { timestamp: ms(start + 30 * 60), level: GARMIN_SLEEP_LEVEL.DEEP },
      { timestamp: ms(start + 60 * 60), level: GARMIN_SLEEP_LEVEL.LIGHT },
    ],
    events: [],
    naps: [],
  });
  expect(sessions).toHaveLength(1);
  expect(sessions[0]!.stages).toHaveLength(3);
  expect(sessions[0]!.stages!.map((stage) => stage.stage)).toEqual(["light", "deep", "light"]);

  // Five minutes or less is discarded.
  expect(
    segmentGarminSleepSessions({
      levels: [
        { timestamp: ms(start), level: GARMIN_SLEEP_LEVEL.LIGHT },
        { timestamp: ms(start + 2 * 60), level: GARMIN_SLEEP_LEVEL.LIGHT },
      ],
      events: [],
      naps: [],
    }),
  ).toEqual([]);

  // A wake phase longer than an hour closes the session.
  expect(
    segmentGarminSleepSessions({
      levels: [
        { timestamp: ms(start), level: GARMIN_SLEEP_LEVEL.LIGHT },
        { timestamp: ms(start + 10 * 60), level: GARMIN_SLEEP_LEVEL.LIGHT },
        { timestamp: ms(start + 90 * 60), level: GARMIN_SLEEP_LEVEL.LIGHT },
        { timestamp: ms(start + 100 * 60), level: GARMIN_SLEEP_LEVEL.LIGHT },
      ],
      events: [],
      naps: [],
    }),
  ).toHaveLength(2);
});

test("NAP_EVENT becomes a light session and unknown messages are skipped", () => {
  const start = 0x40000;
  const iso = (seconds: number) => new Date((seconds + GARMIN_TIME_EPOCH) * 1000).toISOString();
  const file = fitFile([
    // Unknown message first: the parser must still walk past it.
    definition(0, 999, [
      [0, 4, UINT32],
      [1, 2, UINT16],
    ]),
    data(
      0,
      [
        [0, 4, UINT32],
        [1, 2, UINT16],
      ],
      [1, 2],
    ),
    definition(1, GARMIN_FIT_MESSAGE.NAP_EVENT, NAP_FIELDS),
    data(1, NAP_FIELDS, [start, start + 20 * 60]),
    definition(2, GARMIN_FIT_MESSAGE.MONITORING, MONITORING_FIELDS),
    data(2, MONITORING_FIELDS, [start + 3600, 8, 55, null, null, null]),
  ]);
  const records = garminFitRecords(file);
  expect(sleepOf(records)).toEqual([
    {
      type: "sleep_session",
      startTime: iso(start),
      endTime: iso(start + 20 * 60),
      stages: [{ stage: "light", startTime: iso(start), endTime: iso(start + 20 * 60) }],
    },
  ]);
  expect(stepsOf(records)).toHaveLength(1);
});

test("a corrupted FIT file is rejected by its CRC", () => {
  const file = fitFile([
    definition(0, GARMIN_FIT_MESSAGE.MONITORING, MONITORING_FIELDS),
    data(0, MONITORING_FIELDS, [1, 2, 3, null, null, null]),
  ]);
  file[file.length - 1] = file[file.length - 1]! ^ 0xff;
  expect(() => garminFitRecords(file)).toThrow("GARMIN_FIT_CRC");
  expect(() => garminFitRecords(Uint8Array.of(1, 2, 3))).toThrow("GARMIN_FIT_TRUNCATED");
  const badMagic = fitFile([]);
  badMagic[8] = 0;
  expect(() => garminFitRecords(badMagic)).toThrow("GARMIN_FIT_MAGIC");
});

test("handshake replies match upstream's layouts", () => {
  expect(Array.from(buildGarminStatusPayload(5024, 0))).toEqual([0xa0, 0x13, 0]);
  expect(
    parseGarminDeviceInformation(Uint8Array.of(150, 0, 0xdb, 0x0c, 1, 2, 3, 4, 0xd0, 7, 0x77, 1)),
  ).toEqual({
    protocolVersion: 150,
    productNumber: 3291,
    softwareVersion: 2000,
    maxPacketSize: 375,
  });
  // RESPONSE for 5024, ACK, protocol 150, product/unit/max packet -1, software 7791,
  // "OpenValens", "OpenValens", "phone", then flag 1 for a 1xx watch protocol.
  const name = [10, ...Array.from("OpenValens", (c) => c.charCodeAt(0))];
  expect(Array.from(buildGarminDeviceInformationReply(150))).toEqual([
    0xa0,
    0x13,
    0,
    0x96,
    0,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0x6f,
    0x1e,
    0xff,
    0xff,
    ...name,
    ...name,
    5,
    ...Array.from("phone", (c) => c.charCodeAt(0)),
    1,
  ]);
  expect(buildGarminDeviceInformationReply(250).at(-1)).toBe(0);
  expect(Array.from(buildGarminAuthNegotiationStatus(Uint8Array.of(7, 0x81, 0x02, 0, 0)))).toEqual([
    0xed, 0x13, 0, 0, 7, 0x81, 0, 0, 0,
  ]);
});

test("our capabilities are upstream's: all 129 but the 17 it removes", () => {
  // Upstream ordinals of LIVETRACK, LIVETRACK_AUTO_START, GPS_EPHEMERIS_DOWNLOAD and
  // CAPABILITY_104–111, 114–119 in GarminCapability.java at the pinned commit.
  const removed = new Set([
    22, 23, 28, 104, 105, 106, 107, 108, 109, 110, 111, 114, 115, 116, 117, 118, 119,
  ]);
  expect(GARMIN_OUR_CAPABILITIES.length).toBe(17);
  for (let bit = 0; bit < 17 * 8; bit += 1) {
    const set = (GARMIN_OUR_CAPABILITIES[bit >> 3]! >> (bit & 7)) & 1;
    expect([bit, set]).toEqual([bit, bit < 129 && !removed.has(bit) ? 1 : 0]);
  }
  expect(Array.from(buildGarminConfiguration().subarray(0, 1))).toEqual([17]);
});
