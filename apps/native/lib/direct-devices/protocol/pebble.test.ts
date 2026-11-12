/**
 * Codec tests for the Pebble protocol.
 *
 * Vectors are derived from Gadgetbridge's `PebbleProtocol.java`,
 * `PebbleLESupport.java` and `DatalogSessionHealth*.java` at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";
import { directDeviceBatch } from "@openvalens/api/contracts/direct-device";

import {
  PEBBLE_DATALOG_ACK,
  PEBBLE_DATALOG_CLOSE,
  PEBBLE_DATALOG_NACK,
  PEBBLE_DATALOG_OPEN_SESSION,
  PEBBLE_DATALOG_SEND_DATA,
  PEBBLE_DATALOG_TIMEOUT,
  PEBBLE_ENDPOINT_BLOBDB,
  PEBBLE_ENDPOINT_DATALOG,
  PEBBLE_ENDPOINT_HEALTH_SYNC,
  PEBBLE_MTU_REQUEST,
  PEBBLE_PPOGATT_READ_UUID,
  PEBBLE_PPOGATT_SERVICE_UUID,
  PEBBLE_PPOGATT_WRITE_UUID,
  PEBBLE_SERVICE_UUID,
  PEBBLE_SLEEP_TYPE_ACTIVITY,
  PEBBLE_SLEEP_TYPE_DEEP_NAP,
  PEBBLE_SLEEP_TYPE_DEEP_SLEEP,
  PEBBLE_SLEEP_TYPE_LIGHT_NAP,
  PEBBLE_SLEEP_TYPE_LIGHT_SLEEP,
  PEBBLE_STEPS_VERSIONS,
  PEBBLE_UUID_ZERO,
  assembleSleepSessions,
  calcMaxWriteChunk,
  chunkPpogatt,
  createPebbleReassembler,
  decodeDatalogPayload,
  decodePebbleFrame,
  decodePpogattHeader,
  encodeActivateHealth,
  encodeActivateHrm,
  encodeBlobdb,
  encodeDatalogAck,
  encodeDatalogClose,
  encodeDatalogNack,
  encodeDatalogOpenSession,
  encodeDatalogSendData,
  encodeDatalogTimeout,
  encodeHealthSync,
  encodePebbleFrame,
  encodePpogattAck,
  encodePpogattData,
  encodeSetSaneDistanceUnit,
  nextPpogattSerial,
  parseFirmwareVersion,
  parseOverlaySessionData,
  parseSleepSessionData,
  parseStepsSessionData,
  ppogattChunkSize,
  ppogattMagicResponse,
  stepsSamplesToRecords,
} from "./pebble";

function hex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u16le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function i32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

test("the 4-byte framing round-trips and excludes the prefix from the length", () => {
  const frame = encodePebbleFrame(PEBBLE_ENDPOINT_DATALOG, Uint8Array.from([0x85, 0x07]));
  expect(hex(frame)).toBe("00 02 1a 7a 85 07");
  expect(decodePebbleFrame(frame)).toEqual({
    endpoint: PEBBLE_ENDPOINT_DATALOG,
    payload: Uint8Array.from([0x85, 0x07]),
  });
  // 6778 = 0x1a7a.
  expect(frame[2]).toBe(0x1a);
  expect(frame[3]).toBe(0x7a);
});

test("decoding rejects truncated and over-long buffers", () => {
  const frame = encodePebbleFrame(16, Uint8Array.from([0x00]));
  expect(decodePebbleFrame(frame.slice(0, frame.length - 1))).toBeNull();
  expect(decodePebbleFrame(concat([frame, Uint8Array.from([0x00])]))).toBeNull();
  expect(decodePebbleFrame(Uint8Array.from([0x00, 0x01]))).toBeNull();
});

test("the reassembler joins split frames and splits back-to-back frames", () => {
  const first = encodePebbleFrame(6778, Uint8Array.from([0x01, 0x02, 0x03]));
  const second = encodePebbleFrame(16, Uint8Array.from([0x00]));
  const reassembler = createPebbleReassembler();
  expect(reassembler.push(first.slice(0, 2))).toHaveLength(0);
  expect(reassembler.push(first.slice(2))).toHaveLength(1);
  const frames = reassembler.push(concat([second, second]));
  expect(frames).toHaveLength(2);
  expect(frames[0]!.endpoint).toBe(16);
  expect(frames[1]!.payload).toEqual(Uint8Array.from([0x00]));
});

// ---------------------------------------------------------------------------
// PPoGATT
// ---------------------------------------------------------------------------

test("PPoGATT header bits: command low 3, serial high 5", () => {
  expect(decodePpogattHeader(0x00)).toEqual({ command: 0, serial: 0 });
  expect(decodePpogattHeader(0x0a)).toEqual({ command: 2, serial: 1 });
  expect(decodePpogattHeader(0x19)).toEqual({ command: 1, serial: 3 });
  expect(decodePpogattHeader(0xf9)).toEqual({ command: 1, serial: 31 });
});

test("PPoGATT ACK is (serial << 3) | 1", () => {
  expect(hex(encodePpogattAck(0))).toBe("01");
  expect(hex(encodePpogattAck(3))).toBe("19");
  expect(hex(encodePpogattAck(31))).toBe("f9");
});

test("PPoGATT data packets carry the serial in the header", () => {
  expect(hex(encodePpogattData(0, Uint8Array.from([0xaa])))).toBe("00 aa");
  expect(hex(encodePpogattData(3, Uint8Array.from([0xaa])))).toBe("18 aa");
  expect(nextPpogattSerial(31)).toBe(0);
  expect(nextPpogattSerial(0)).toBe(1);
});

test("command 2 is answered with the magic response", () => {
  expect(hex(ppogattMagicResponse(true))).toBe("03 19 19");
  expect(hex(ppogattMagicResponse(false))).toBe("03");
});

test("the MTU chunk size follows calcMaxWriteChunk - 1", () => {
  expect(calcMaxWriteChunk(PEBBLE_MTU_REQUEST)).toBe(336);
  expect(calcMaxWriteChunk(23)).toBe(20);
  expect(calcMaxWriteChunk(20)).toBe(20);
  expect(calcMaxWriteChunk(512)).toBe(509);
  expect(calcMaxWriteChunk(600)).toBe(512);
  expect(ppogattChunkSize(339)).toBe(335);
  expect(ppogattChunkSize(23)).toBe(19);
});

test("chunkPpogatt splits a frame and increments the 5-bit serial", () => {
  const frame = new Uint8Array(700);
  const packets = chunkPpogatt(frame, 339);
  expect(packets).toHaveLength(3);
  expect(packets[0]!.length).toBe(336);
  expect(packets[1]!.length).toBe(336);
  expect(packets[2]!.length).toBe(31);
  expect(packets.map((packet) => decodePpogattHeader(packet[0]!).serial)).toEqual([0, 1, 2]);
  // Starting at a non-zero serial wraps at 32.
  const wrapped = chunkPpogatt(new Uint8Array(700), 339, 31);
  expect(wrapped.map((packet) => decodePpogattHeader(packet[0]!).serial)).toEqual([31, 0, 1]);
});

// ---------------------------------------------------------------------------
// DATALOG
// ---------------------------------------------------------------------------

test("all six DATALOG opcodes encode and decode", () => {
  const open = decodeDatalogPayload(
    encodeDatalogOpenSession({
      id: 4,
      uuid: PEBBLE_UUID_ZERO,
      timestamp: 1_700_000_000,
      logTag: 81,
      itemType: 0,
      itemSize: 22,
    }),
  );
  expect(open).toMatchObject({
    command: "open_session",
    id: 4,
    uuid: PEBBLE_UUID_ZERO,
    timestamp: 1_700_000_000,
    logTag: 81,
    itemType: 0,
    itemSize: 22,
  });

  const send = decodeDatalogPayload(
    encodeDatalogSendData({
      id: 4,
      itemsLeft: 2,
      crc: 0x11223344,
      data: Uint8Array.from([0xaa, 0xbb]),
    }),
  );
  expect(send).toMatchObject({
    command: "send_data",
    id: 4,
    itemsLeft: 2,
    crc: 0x11223344,
  });
  if (send?.command === "send_data") expect(hex(send.data)).toBe("aa bb");

  expect(decodeDatalogPayload(encodeDatalogClose(4))).toEqual({
    command: "close",
    id: 4,
  });
  expect(decodeDatalogPayload(encodeDatalogTimeout(4))).toEqual({
    command: "timeout",
    id: 4,
  });
  expect(decodeDatalogPayload(encodeDatalogAck(4))).toEqual({
    command: "ack",
    id: 4,
  });
  expect(decodeDatalogPayload(encodeDatalogNack(4))).toEqual({
    command: "nack",
    id: 4,
  });
  expect(encodeDatalogAck(4)[0]).toBe(PEBBLE_DATALOG_ACK);
  expect(encodeDatalogNack(4)[0]).toBe(PEBBLE_DATALOG_NACK);
  expect(encodeDatalogClose(4)[0]).toBe(PEBBLE_DATALOG_CLOSE);
  expect(encodeDatalogTimeout(4)[0]).toBe(PEBBLE_DATALOG_TIMEOUT);
  expect(
    encodeDatalogOpenSession({
      id: 0,
      uuid: PEBBLE_UUID_ZERO,
      timestamp: 0,
      logTag: 0,
      itemType: 0,
      itemSize: 0,
    })[0],
  ).toBe(PEBBLE_DATALOG_OPEN_SESSION);
  expect(
    encodeDatalogSendData({
      id: 0,
      itemsLeft: 0,
      crc: 0,
      data: new Uint8Array(0),
    })[0],
  ).toBe(PEBBLE_DATALOG_SEND_DATA);
});

test("unknown DATALOG opcodes and short payloads are rejected", () => {
  expect(decodeDatalogPayload(Uint8Array.from([0x42, 0x01]))).toEqual({
    command: "unknown",
    opcode: 0x42,
    id: 1,
  });
  expect(decodeDatalogPayload(new Uint8Array(0))).toBeNull();
  expect(decodeDatalogPayload(Uint8Array.from([PEBBLE_DATALOG_OPEN_SESSION, 0x01]))).toBeNull();
  expect(decodeDatalogPayload(Uint8Array.from([PEBBLE_DATALOG_SEND_DATA]))).toBeNull();
});

// ---------------------------------------------------------------------------
// Steps records
// ---------------------------------------------------------------------------

function recordLengthFor(version: number): number {
  return (
    5 +
    (version >= 5 ? 1 : 0) +
    (version >= 6 ? 6 : 0) +
    (version >= 7 ? 1 : 0) +
    (version >= 12 ? 2 : 0) +
    (version >= 13 ? 1 : 0) +
    (version >= 14 ? 2 : 0)
  );
}

type StepFields = {
  steps: number;
  orientation: number;
  intensity: number;
  lightIntensity: number;
  flags?: number;
  restingCalories?: number;
  activeCalories?: number;
  distanceCm?: number;
  heartRate?: number;
  heartRateTotalWeight?: number;
  heartRateZone?: number;
  spoPercent?: number;
  spoQuality?: number;
};

function writeRecord(out: Uint8Array, offset: number, version: number, fields: StepFields): void {
  let cursor = offset;
  out[cursor++] = fields.steps;
  out[cursor++] = fields.orientation;
  out.set(u16le(fields.intensity), cursor);
  cursor += 2;
  out[cursor++] = fields.lightIntensity;
  if (version >= 5) out[cursor++] = fields.flags ?? 0;
  if (version >= 6) {
    out.set(u16le(fields.restingCalories ?? 0), cursor);
    out.set(u16le(fields.activeCalories ?? 0), cursor + 2);
    out.set(u16le(fields.distanceCm ?? 0), cursor + 4);
    cursor += 6;
  }
  if (version >= 7) out[cursor++] = fields.heartRate ?? 0;
  if (version >= 12) {
    out.set(u16le(fields.heartRateTotalWeight ?? 0), cursor);
    cursor += 2;
  }
  if (version >= 13) out[cursor++] = fields.heartRateZone ?? 0;
  if (version >= 14) {
    out[cursor++] = fields.spoPercent ?? 0;
    out[cursor++] = fields.spoQuality ?? 0;
  }
}

function stepsPacket(
  version: number,
  timestamp: number,
  records: readonly StepFields[],
): Uint8Array {
  const recordLength = recordLengthFor(version);
  const out = new Uint8Array(9 + recordLength * records.length);
  out.set(u16le(version), 0);
  out.set(i32le(timestamp), 2);
  out[6] = 0;
  out[7] = recordLength;
  out[8] = records.length;
  records.forEach((fields, index) => writeRecord(out, 9 + index * recordLength, version, fields));
  return out;
}

test("steps records parse for every accepted version with the right field matrix", () => {
  expect(PEBBLE_STEPS_VERSIONS).toEqual([5, 6, 7, 12, 13, 14]);
  for (const version of PEBBLE_STEPS_VERSIONS) {
    const packet = stepsPacket(version, 1_700_000_040, [
      {
        steps: 12,
        orientation: 3,
        intensity: 0x1234,
        lightIntensity: 200,
        flags: 0x81,
        restingCalories: 111,
        activeCalories: 222,
        distanceCm: 333,
        heartRate: 77,
        heartRateTotalWeight: 0x0102,
        heartRateZone: 4,
        spoPercent: 97,
        spoQuality: 88,
      },
    ]);
    const parsed = parseStepsSessionData(packet, packet.length);
    expect(parsed, String(version)).not.toBeNull();
    const sample = parsed![0]!.samples[0]!;
    expect(sample).toMatchObject({
      timestamp: 1_700_000_040,
      version,
      steps: 12,
      orientation: 3,
      intensity: 0x1234,
      lightIntensity: 200,
    });
    if (version >= 5) expect(sample.flags).toBe(0x81);
    else expect(sample).not.toHaveProperty("flags");
    if (version >= 6) {
      expect(sample).toMatchObject({
        restingCalories: 111,
        activeCalories: 222,
        distanceCm: 333,
      });
    } else expect(sample).not.toHaveProperty("restingCalories");
    if (version >= 7) expect(sample.heartRate).toBe(77);
    else expect(sample).not.toHaveProperty("heartRate");
    if (version >= 12) expect(sample.heartRateTotalWeight).toBe(0x0102);
    else expect(sample).not.toHaveProperty("heartRateTotalWeight");
    if (version >= 13) expect(sample.heartRateZone).toBe(4);
    else expect(sample).not.toHaveProperty("heartRateZone");
    if (version >= 14) expect(sample).toMatchObject({ spoPercent: 97, spoQuality: 88 });
    else expect(sample).not.toHaveProperty("spoPercent");
  }
});

test("steps timestamps advance by 60 seconds per record and roll over midnight", () => {
  const start = Date.UTC(2026, 1, 1, 23, 59, 0) / 1000;
  const packet = stepsPacket(7, start, [
    {
      steps: 1,
      orientation: 0,
      intensity: 0,
      lightIntensity: 0,
      heartRate: 60,
    },
    {
      steps: 2,
      orientation: 0,
      intensity: 0,
      lightIntensity: 0,
      heartRate: 61,
    },
    {
      steps: 3,
      orientation: 0,
      intensity: 0,
      lightIntensity: 0,
      heartRate: 62,
    },
  ]);
  const parsed = parseStepsSessionData(packet, packet.length)!;
  expect(parsed[0]!.samples.map((sample) => sample.timestamp)).toEqual([
    start,
    start + 60,
    start + 120,
  ]);
  const { steps, heartRate } = stepsSamplesToRecords(parsed[0]!.samples);
  expect(steps[0]).toEqual({
    type: "steps",
    startTime: "2026-02-01T23:59:00.000Z",
    endTime: "2026-02-02T00:00:00.000Z",
    count: 1,
  });
  expect(steps[2]!.startTime).toBe("2026-02-02T00:01:00.000Z");
  expect(heartRate.map((sample) => sample.bpm)).toEqual([60, 61, 62]);
  expect(
    directDeviceBatch.safeParse({
      schemaVersion: 1,
      deviceId: "00000000-0000-4000-8000-000000000000",
      provider: "direct_device",
      recordType: "steps",
      mode: "backfill",
      upserts: steps.map((record) => ({
        ...record,
        externalRecordId: "pebble-step",
        sourceApp: null,
      })),
      deletions: [],
      clientTimezone: "UTC",
    }).success,
  ).toBe(true);
});

test("multiple packets in one SENDDATA are all parsed", () => {
  // A session has one itemSize, so every packet in it must share the shape.
  const first = stepsPacket(6, 1_700_000_040, [
    { steps: 5, orientation: 0, intensity: 0, lightIntensity: 0 },
  ]);
  const second = stepsPacket(6, 1_700_000_100, [
    { steps: 6, orientation: 0, intensity: 0, lightIntensity: 0 },
  ]);
  const data = concat([first, second]);
  const parsed = parseStepsSessionData(data, first.length)!;
  expect(parsed).toHaveLength(2);
  expect(parsed[0]!.version).toBe(6);
  expect(parsed[1]!.timestamp).toBe(1_700_000_100);

  const v14First = stepsPacket(14, 1_700_000_040, [
    {
      steps: 1,
      orientation: 0,
      intensity: 0,
      lightIntensity: 0,
      spoPercent: 98,
    },
  ]);
  const v14Second = stepsPacket(14, 1_700_000_100, [
    {
      steps: 2,
      orientation: 0,
      intensity: 0,
      lightIntensity: 0,
      spoPercent: 97,
    },
  ]);
  const v14 = parseStepsSessionData(concat([v14First, v14Second]), v14First.length)!;
  expect(v14).toHaveLength(2);
  expect(v14[0]!.version).toBe(14);
  expect(v14[1]!.samples[0]!.spoPercent).toBe(97);
});

test("unknown versions and malformed steps payloads are rejected", () => {
  const packet = stepsPacket(7, 1_700_000_000, [
    { steps: 1, orientation: 0, intensity: 0, lightIntensity: 0 },
  ]);
  const unknown = Uint8Array.from(packet);
  unknown[0] = 8;
  expect(parseStepsSessionData(unknown, unknown.length)).toBeNull();
  expect(parseStepsSessionData(packet.slice(0, packet.length - 1), packet.length)).toBeNull();
  expect(parseStepsSessionData(packet, 0)).toBeNull();
  expect(parseStepsSessionData(new Uint8Array(0), 10)).toBeNull();
  const unaligned = stepsPacket(7, 1_700_000_001, [
    { steps: 1, orientation: 0, intensity: 0, lightIntensity: 0 },
  ]);
  expect(parseStepsSessionData(unaligned, unaligned.length)).toBeNull();
});

// ---------------------------------------------------------------------------
// Sleep records
// ---------------------------------------------------------------------------

function sleepRecord(fields: {
  version: number;
  offsetUtc: number;
  bedTimeStart: number;
  bedTimeEnd: number;
  deepSleepSeconds: number;
}): Uint8Array {
  return Uint8Array.from([
    ...u16le(fields.version),
    ...i32le(fields.offsetUtc),
    ...i32le(fields.bedTimeStart),
    ...i32le(fields.bedTimeEnd),
    ...i32le(fields.deepSleepSeconds),
  ]);
}

function overlayRecord(fields: {
  version: number;
  type: number;
  offsetUtc: number;
  timestampStart: number;
  durationSeconds: number;
}): Uint8Array {
  return Uint8Array.from([
    ...u16le(fields.version),
    ...u16le(0),
    ...u16le(fields.type),
    ...i32le(fields.offsetUtc),
    ...i32le(fields.timestampStart),
    ...i32le(fields.durationSeconds),
  ]);
}

test("tag 83 sleep bounds parse one record per period", () => {
  const record = sleepRecord({
    version: 1,
    offsetUtc: 3600,
    bedTimeStart: 1_700_000_000,
    bedTimeEnd: 1_700_028_800,
    deepSleepSeconds: 7200,
  });
  const parsed = parseSleepSessionData(concat([record, record]), record.length)!;
  expect(parsed).toHaveLength(2);
  expect(parsed[0]).toEqual({
    version: 1,
    offsetUtc: 3600,
    bedTimeStart: 1_700_000_000,
    bedTimeEnd: 1_700_028_800,
    deepSleepSeconds: 7200,
  });
  expect(parseSleepSessionData(record.slice(0, 10), record.length)).toBeNull();
});

test("sleep parsers reject unknown versions and invalid intervals", () => {
  const badBounds = sleepRecord({
    version: 2,
    offsetUtc: 0,
    bedTimeStart: 10,
    bedTimeEnd: 20,
    deepSleepSeconds: 5,
  });
  expect(parseSleepSessionData(badBounds, badBounds.length)).toBeNull();
  const reversed = sleepRecord({
    version: 1,
    offsetUtc: 0,
    bedTimeStart: 20,
    bedTimeEnd: 10,
    deepSleepSeconds: 5,
  });
  expect(parseSleepSessionData(reversed, reversed.length)).toBeNull();
  const badOverlay = overlayRecord({
    version: 2,
    type: 1,
    offsetUtc: 0,
    timestampStart: 10,
    durationSeconds: 5,
  });
  expect(parseOverlaySessionData(badOverlay, badOverlay.length)).toBeNull();
  const zeroOverlay = overlayRecord({
    version: 3,
    type: 1,
    offsetUtc: 0,
    timestampStart: 10,
    durationSeconds: 0,
  });
  expect(parseOverlaySessionData(zeroOverlay, zeroOverlay.length)).toBeNull();
});

test("tag 84 overlays parse versions 1 and 3", () => {
  const light = overlayRecord({
    version: 1,
    type: PEBBLE_SLEEP_TYPE_LIGHT_SLEEP,
    offsetUtc: 0,
    timestampStart: 1_700_000_000,
    durationSeconds: 3600,
  });
  const deep = overlayRecord({
    version: 3,
    type: PEBBLE_SLEEP_TYPE_DEEP_SLEEP,
    offsetUtc: 0,
    timestampStart: 1_700_003_600,
    durationSeconds: 1800,
  });
  const parsed = parseOverlaySessionData(concat([light, deep]), light.length)!;
  expect(parsed).toHaveLength(2);
  expect(parsed[0]).toMatchObject({
    version: 1,
    type: 1,
    durationSeconds: 3600,
  });
  expect(parsed[1]).toMatchObject({
    version: 3,
    type: 2,
    durationSeconds: 1800,
  });
});

test("sleep sessions combine bounds with clipped, sorted stages", () => {
  const start = 1_700_000_000;
  const end = start + 8 * 3600;
  const bounds = [
    {
      version: 1,
      offsetUtc: 0,
      bedTimeStart: start,
      bedTimeEnd: end,
      deepSleepSeconds: 3600,
    },
  ];
  const overlays = [
    // Deep interval that starts before the period and is clipped.
    {
      version: 1,
      type: PEBBLE_SLEEP_TYPE_DEEP_SLEEP,
      offsetUtc: 0,
      timestampStart: start - 600,
      durationSeconds: 1200,
    },
    {
      version: 1,
      type: PEBBLE_SLEEP_TYPE_LIGHT_NAP,
      offsetUtc: 0,
      timestampStart: start + 600,
      durationSeconds: 1800,
    },
    {
      version: 1,
      type: PEBBLE_SLEEP_TYPE_DEEP_NAP,
      offsetUtc: 0,
      timestampStart: start + 3600,
      durationSeconds: 1800,
    },
    // Activity is not sleep and is dropped.
    {
      version: 1,
      type: PEBBLE_SLEEP_TYPE_ACTIVITY,
      offsetUtc: 0,
      timestampStart: start + 7200,
      durationSeconds: 600,
    },
    // Outside the period entirely.
    {
      version: 1,
      type: PEBBLE_SLEEP_TYPE_LIGHT_SLEEP,
      offsetUtc: 0,
      timestampStart: end + 60,
      durationSeconds: 600,
    },
  ];
  const sessions = assembleSleepSessions(bounds, overlays);
  expect(sessions).toHaveLength(3);
  expect(sessions[0]).toEqual({
    type: "sleep_session",
    startTime: new Date((start - 600) * 1000).toISOString(),
    endTime: new Date(start * 1000).toISOString(),
    stages: [
      {
        stage: "deep",
        startTime: new Date((start - 600) * 1000).toISOString(),
        endTime: new Date(start * 1000).toISOString(),
      },
    ],
  });
  expect(sessions[1]!.startTime).toBe(new Date(start * 1000).toISOString());
  expect(sessions[1]!.endTime).toBe(new Date(end * 1000).toISOString());
  expect(sessions[1]!.stages).toEqual([
    {
      stage: "deep",
      startTime: new Date(start * 1000).toISOString(),
      endTime: new Date((start + 600) * 1000).toISOString(),
    },
    {
      stage: "light",
      startTime: new Date((start + 600) * 1000).toISOString(),
      endTime: new Date((start + 2400) * 1000).toISOString(),
    },
    {
      stage: "deep",
      startTime: new Date((start + 3600) * 1000).toISOString(),
      endTime: new Date((start + 5400) * 1000).toISOString(),
    },
  ]);
  expect(sessions[2]!.startTime).toBe(new Date((end + 60) * 1000).toISOString());
  expect(sessions[2]!.endTime).toBe(new Date((end + 660) * 1000).toISOString());
});

test("sleep bounds without overlays carry no stages", () => {
  const bounds = [
    {
      version: 1,
      offsetUtc: 0,
      bedTimeStart: 1_700_000_000,
      bedTimeEnd: 1_700_028_800,
      deepSleepSeconds: 7200,
    },
  ];
  const sessions = assembleSleepSessions(bounds, []);
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).not.toHaveProperty("stages");
});

test("later tag 84 records override earlier sleep and activity intervals", () => {
  const start = 1_700_000_000;
  const bounds = [
    {
      version: 1,
      offsetUtc: 3600,
      bedTimeStart: start,
      bedTimeEnd: start + 600,
      deepSleepSeconds: 300,
    },
  ];
  const overlays = [
    {
      version: 1,
      type: PEBBLE_SLEEP_TYPE_LIGHT_SLEEP,
      offsetUtc: 3600,
      timestampStart: start,
      durationSeconds: 600,
    },
    {
      version: 3,
      type: PEBBLE_SLEEP_TYPE_DEEP_SLEEP,
      offsetUtc: -18000,
      timestampStart: start + 120,
      durationSeconds: 360,
    },
    {
      version: 3,
      type: PEBBLE_SLEEP_TYPE_ACTIVITY,
      offsetUtc: 0,
      timestampStart: start + 240,
      durationSeconds: 120,
    },
  ];
  const stages = assembleSleepSessions(bounds, overlays)[0]!.stages!;
  expect(
    stages.map(({ stage, startTime, endTime }) => [
      stage,
      Date.parse(startTime) / 1000,
      Date.parse(endTime) / 1000,
    ]),
  ).toEqual([
    ["light", start, start + 120],
    ["deep", start + 120, start + 240],
    ["deep", start + 360, start + 480],
    ["light", start + 480, start + 600],
  ]);
});

test("tag 84-only sleep and nap intervals produce sessions without UTC-offset adjustment", () => {
  const start = Date.UTC(2026, 2, 8, 6, 30) / 1000;
  const sessions = assembleSleepSessions(
    [],
    [
      {
        version: 1,
        type: PEBBLE_SLEEP_TYPE_LIGHT_NAP,
        offsetUtc: -18000,
        timestampStart: start,
        durationSeconds: 600,
      },
      {
        version: 3,
        type: PEBBLE_SLEEP_TYPE_DEEP_NAP,
        offsetUtc: -14400,
        timestampStart: start + 600,
        durationSeconds: 300,
      },
    ],
  );
  expect(sessions).toHaveLength(1);
  expect(sessions[0]!.startTime).toBe(new Date(start * 1000).toISOString());
  expect(sessions[0]!.endTime).toBe(new Date((start + 900) * 1000).toISOString());
  expect(sessions[0]!.stages).toHaveLength(2);
});

test("mixed bounds preserve uncovered naps and clip overlays that straddle bounds", () => {
  const start = 1_700_000_000;
  const bounds = [
    {
      version: 1,
      offsetUtc: 0,
      bedTimeStart: start + 100,
      bedTimeEnd: start + 300,
      deepSleepSeconds: 0,
    },
  ];
  const overlays = [
    {
      version: 1,
      type: PEBBLE_SLEEP_TYPE_LIGHT_SLEEP,
      offsetUtc: 0,
      timestampStart: start,
      durationSeconds: 500,
    },
    {
      version: 1,
      type: PEBBLE_SLEEP_TYPE_DEEP_NAP,
      offsetUtc: 0,
      timestampStart: start + 600,
      durationSeconds: 100,
    },
  ];
  const sessions = assembleSleepSessions(bounds, overlays);
  expect(sessions).toHaveLength(4);
  expect(
    sessions.map(({ startTime, endTime }) => [
      Date.parse(startTime) / 1000,
      Date.parse(endTime) / 1000,
    ]),
  ).toEqual([
    [start, start + 100],
    [start + 100, start + 300],
    [start + 300, start + 500],
    [start + 600, start + 700],
  ]);
  expect(sessions[1]!.stages).toEqual([
    {
      stage: "light",
      startTime: new Date((start + 100) * 1000).toISOString(),
      endTime: new Date((start + 300) * 1000).toISOString(),
    },
  ]);
  expect(sessions[3]!.stages).toEqual([
    {
      stage: "deep",
      startTime: new Date((start + 600) * 1000).toISOString(),
      endTime: new Date((start + 700) * 1000).toISOString(),
    },
  ]);
  for (const session of sessions) {
    expect(
      directDeviceBatch.safeParse({
        schemaVersion: 1,
        deviceId: "00000000-0000-4000-8000-000000000000",
        provider: "direct_device",
        recordType: "sleep_session",
        mode: "backfill",
        upserts: [{ ...session, externalRecordId: "pebble-sleep", sourceApp: null }],
        deletions: [],
        clientTimezone: "UTC",
      }).success,
    ).toBe(true);
  }
});

test("duplicate bounds and overlays are deduplicated with packet-order precedence", () => {
  const start = 1_700_000_000;
  const period = {
    version: 1,
    offsetUtc: 0,
    bedTimeStart: start,
    bedTimeEnd: start + 600,
    deepSleepSeconds: 0,
  };
  const light = {
    version: 1,
    type: PEBBLE_SLEEP_TYPE_LIGHT_SLEEP,
    offsetUtc: 0,
    timestampStart: start,
    durationSeconds: 600,
  };
  const deep = {
    version: 3,
    type: PEBBLE_SLEEP_TYPE_DEEP_SLEEP,
    offsetUtc: 0,
    timestampStart: start + 120,
    durationSeconds: 120,
  };
  const first = assembleSleepSessions([period, { ...period }], [light, deep, { ...deep }]);
  expect(first).toHaveLength(1);
  expect(first[0]!.stages).toEqual([
    {
      stage: "light",
      startTime: new Date(start * 1000).toISOString(),
      endTime: new Date((start + 120) * 1000).toISOString(),
    },
    {
      stage: "deep",
      startTime: new Date((start + 120) * 1000).toISOString(),
      endTime: new Date((start + 240) * 1000).toISOString(),
    },
    {
      stage: "light",
      startTime: new Date((start + 240) * 1000).toISOString(),
      endTime: new Date((start + 600) * 1000).toISOString(),
    },
  ]);
  // Packet arrival order defines precedence, not timestamp sorting.
  const reversed = assembleSleepSessions([period], [deep, light]);
  expect(reversed[0]!.stages).toEqual([
    {
      stage: "light",
      startTime: new Date(start * 1000).toISOString(),
      endTime: new Date((start + 600) * 1000).toISOString(),
    },
  ]);
});

// ---------------------------------------------------------------------------
// BlobDB health enable
// ---------------------------------------------------------------------------

test("the health-enable BlobDB write matches the upstream byte layout", () => {
  const frame = encodeActivateHealth({
    heightCm: 175,
    weightKg: 75,
    age: 30,
    gender: 1,
    token: 0x1234,
  });
  const decoded = decodePebbleFrame(frame)!;
  expect(decoded.endpoint).toBe(PEBBLE_ENDPOINT_BLOBDB);
  // length = 5 + 19-byte key + 2 + 9-byte blob = 35.
  expect(frame[0]).toBe(0x00);
  expect(frame[1]).toBe(0x23);
  const payload = decoded.payload;
  expect(payload[0]).toBe(1); // BLOBDB_INSERT
  expect(payload[1]).toBe(0x34); // token LE
  expect(payload[2]).toBe(0x12);
  expect(payload[3]).toBe(7); // BLOBDB_PREFERENCES
  expect(payload[4]).toBe(19);
  expect(Buffer.from(payload.slice(5, 24)).toString("ascii")).toBe("activityPreferences");
  expect(payload[24]).toBe(9); // blob length LE
  expect(payload[25]).toBe(0);
  // heightMm 1750 = 0x06d6, weightDag 7500 = 0x1d4c.
  expect(hex(payload.slice(26))).toBe("d6 06 4c 1d 01 00 00 1e 01");
});

test("the HRM and distance-unit preference writes match upstream", () => {
  const hrm = decodePebbleFrame(encodeActivateHrm(true, 0))!.payload;
  // 5 header bytes + 14-byte key + 2-byte blob length + 1-byte blob.
  expect(Buffer.from(hrm.slice(5, 19)).toString("ascii")).toBe("hrmPreferences");
  expect(hrm[19]).toBe(1);
  expect(hrm[20]).toBe(0);
  expect(hrm[21]).toBe(1);

  const metric = decodePebbleFrame(encodeSetSaneDistanceUnit(true, 0))!.payload;
  expect(Buffer.from(metric.slice(5, 18)).toString("ascii")).toBe("unitsDistance");
  expect(metric[18]).toBe(1);
  expect(metric[19]).toBe(0);
  expect(metric[20]).toBe(0);

  const imperial = decodePebbleFrame(encodeSetSaneDistanceUnit(false, 0))!.payload;
  expect(imperial[20]).toBe(1);
});

test("encodeBlobdb rejects an over-long key and supports a missing blob", () => {
  expect(() => encodeBlobdb({ key: "x".repeat(256), command: 1, database: 7 })).toThrow(
    "KEY_TOO_LONG",
  );
  const withoutBlob = decodePebbleFrame(
    encodeBlobdb({ key: "unitsDistance", command: 4, database: 7 }),
  )!;
  // 5 + 13 key bytes, no blob length.
  expect(withoutBlob.payload.length).toBe(18);
});

// ---------------------------------------------------------------------------
// Health sync and firmware version
// ---------------------------------------------------------------------------

test("the health-sync request is endpoint 911 with a zero cursor", () => {
  const frame = encodeHealthSync();
  expect(hex(frame)).toBe("00 05 03 8f 01 00 00 00 00");
  expect(decodePebbleFrame(frame)!.endpoint).toBe(PEBBLE_ENDPOINT_HEALTH_SYNC);
});

test("the firmware-version reply exposes the hardware revision", () => {
  const payload = new Uint8Array(47);
  payload[0] = 0;
  payload.set([...Buffer.from("v4.9.169")], 5);
  payload.set([...Buffer.from("abcdef12")], 37);
  payload[45] = 0x04;
  payload[46] = 18;
  const parsed = parseFirmwareVersion(payload)!;
  expect(parsed.fwVersion).toBe("v4.9.169");
  expect(parsed.gitHash).toBe("abcdef12");
  expect(parsed.flags).toBe(0x04);
  expect(parsed.hardwareId).toBe(18);
  expect(parseFirmwareVersion(payload.slice(0, 46))).toBeNull();
});

test("the GATT constants match the upstream table", () => {
  expect(PEBBLE_SERVICE_UUID).toBe("0000fed9-0000-1000-8000-00805f9b34fb");
  expect(PEBBLE_PPOGATT_SERVICE_UUID).toBe("30000003-328e-0fbb-c642-1aa6699bdada");
  expect(PEBBLE_PPOGATT_READ_UUID).toBe("30000004-328e-0fbb-c642-1aa6699bdada");
  expect(PEBBLE_PPOGATT_WRITE_UUID).toBe("30000006-328e-0fbb-c642-1aa6699bdada");
  expect(PEBBLE_MTU_REQUEST).toBe(339);
});
