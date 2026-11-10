/**
 * Codec and parser tests for the legacy Huami protocol.
 *
 * Derived from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { createCipheriv } from "node:crypto";

import { expect, test } from "bun:test";

import {
  HUAMI_AUTH_FAIL,
  HUAMI_AUTH_REQUEST_RANDOM,
  HUAMI_AUTH_SEND_ENCRYPTED,
  HUAMI_AUTH_SEND_KEY,
  HUAMI_AUTH_SUCCESS,
  HUAMI_KIND_DEEP_SLEEP,
  HUAMI_KIND_LIGHT_SLEEP,
  HUAMI_KIND_WAKE_UP,
  buildActivityAckFrame,
  buildActivityFetchFrame,
  buildActivityStartFrame,
  buildAuthRequestRandom,
  buildAuthSendEncrypted,
  buildAuthSendKey,
  buildChunkedWrites,
  buildCurrentTimeFrame,
  calcMaxWriteChunk,
  chunkedPayloadCapacity,
  encryptAuthChallenge,
  isAuthFailure,
  isAuthSuccess,
  minuteSampleToRecords,
  parseActivityControlResponse,
  parseActivitySamples,
  parseAuthChallenge,
  parseAuthResponse,
  parseHeartRateMeasurement,
  parseHuamiAuthKey,
  parseHuamiTimestamp,
  segmentSleepSessions,
  type HuamiAuthCrypto,
  type HuamiMinuteSample,
} from "./huami-legacy";

const KEY = Uint8Array.from([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
]);

function nodeCrypto(): HuamiAuthCrypto {
  return {
    aesEcbEncrypt(key, data) {
      const cipher = createCipheriv("aes-128-ecb", key, null);
      cipher.setAutoPadding(false);
      return Uint8Array.from(Buffer.concat([cipher.update(data), cipher.final()]));
    },
  };
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

// ---------------------------------------------------------------------------
// Chunked writes
// ---------------------------------------------------------------------------

test("chunked writes split at the MTU-derived capacity with the upstream flags", () => {
  expect(calcMaxWriteChunk(23)).toBe(20);
  expect(chunkedPayloadCapacity(23)).toBe(17);
  expect(calcMaxWriteChunk(512)).toBe(509);
  expect(chunkedPayloadCapacity(512)).toBe(506);

  const data = Uint8Array.from({ length: 40 }, (_, index) => index);
  const chunks = buildChunkedWrites(0x0a, data, 23);
  expect(chunks).toHaveLength(3);
  expect(chunks.map((chunk) => chunk.length)).toEqual([20, 20, 9]);
  expect(chunks.map((chunk) => chunk[1])).toEqual([0x0a, 0x4a, 0x8a]);
  expect(chunks.map((chunk) => chunk[2])).toEqual([0, 1, 2]);
  expect(chunks[0]!.slice(3)).toEqual(data.slice(0, 17));
  expect(chunks[1]!.slice(3)).toEqual(data.slice(17, 34));
  expect(chunks[2]!.slice(3)).toEqual(data.slice(34));
});

test("a single-chunk write sets both the last and first flags", () => {
  const [chunk] = buildChunkedWrites(0x03, Uint8Array.of(1, 2, 3), 23);
  expect(chunk).toBeDefined();
  expect([...chunk!]).toEqual([0x00, 0xc3, 0x00, 1, 2, 3]);
});

test("the chunk counter wraps at 256", () => {
  const data = new Uint8Array(257 * 17);
  const chunks = buildChunkedWrites(0x01, data, 23);
  expect(chunks).toHaveLength(257);
  expect(chunks[255]![2]).toBe(255);
  expect(chunks[256]![2]).toBe(0);
  expect(chunks[256]![1]).toBe(0x81);
});

test("an empty chunked payload is rejected", () => {
  expect(() => buildChunkedWrites(0x01, new Uint8Array(0), 23)).toThrow("HUAMI_CHUNKED_EMPTY");
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

test("auth key parsing accepts 0x-hex, bare hex and raw ASCII", () => {
  expect(hex(parseHuamiAuthKey("0x000102030405060708090a0b0c0d0e0f"))).toBe(hex(KEY));
  expect(hex(parseHuamiAuthKey("000102030405060708090a0b0c0d0e0f"))).toBe(hex(KEY));
  expect(hex(parseHuamiAuthKey("0123456789@ABCDE"))).toBe("30313233343536373839404142434445");
  expect(() => parseHuamiAuthKey("not-a-key")).toThrow("HUAMI_AUTH_KEY_INVALID");
  expect(() => parseHuamiAuthKey("0x1234")).toThrow("HUAMI_AUTH_KEY_INVALID");
  expect(() => parseHuamiAuthKey("0123456789ABCDEFG")).toThrow("HUAMI_AUTH_KEY_INVALID");
});

test("the three-step handshake frames match InitOperation", () => {
  expect([...buildAuthSendKey(0x08, KEY)]).toEqual([0x01, 0x08, ...KEY]);
  expect([...buildAuthRequestRandom(0x08, 0x00)]).toEqual([0x02, 0x08]);
  const encrypted = Uint8Array.from({ length: 16 }, (_, index) => 0xa0 + index);
  expect([...buildAuthSendEncrypted(0x08, 0x00, encrypted)]).toEqual([0x03, 0x08, ...encrypted]);
});

test("the crypt handshake frames carry the 0x80 flag", () => {
  expect([...buildAuthRequestRandom(0x00, 0x80)]).toEqual([0x82, 0x00, 0x02, 0x01, 0x00]);
  const encrypted = Uint8Array.from({ length: 16 }, (_, index) => 0xb0 + index);
  expect([...buildAuthSendEncrypted(0x00, 0x80, encrypted)]).toEqual([0x83, 0x00, ...encrypted]);
});

test("AES-128-ECB challenge encryption matches the FIPS-197 vector", () => {
  const challenge = Uint8Array.from([
    0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
  ]);
  expect(hex(encryptAuthChallenge(KEY, challenge, nodeCrypto()))).toBe(
    "69c4e0d86a7b0430d8cdb78070b4c55a",
  );
});

test("auth responses parse command, success and failure", () => {
  expect(parseAuthResponse(Uint8Array.of(0x10, 0x01, 0x01))).toEqual({
    command: HUAMI_AUTH_SEND_KEY,
    status: HUAMI_AUTH_SUCCESS,
  });
  expect(parseAuthResponse(Uint8Array.of(0x10, 0x82, 0x01))).toEqual({
    command: HUAMI_AUTH_REQUEST_RANDOM,
    status: HUAMI_AUTH_SUCCESS,
  });
  expect(parseAuthResponse(Uint8Array.of(0x10, 0x03, 0x04))).toEqual({
    command: HUAMI_AUTH_SEND_ENCRYPTED,
    status: HUAMI_AUTH_FAIL,
  });
  expect(parseAuthResponse(Uint8Array.of(0x11, 0x01, 0x01))).toBeNull();
  expect(parseAuthResponse(Uint8Array.of(0x10, 0x01))).toBeNull();

  expect(isAuthSuccess(Uint8Array.of(0x10, 0x02, 0x01), HUAMI_AUTH_REQUEST_RANDOM)).toBe(true);
  expect(isAuthSuccess(Uint8Array.of(0x10, 0x02, 0x04), HUAMI_AUTH_REQUEST_RANDOM)).toBe(false);
  expect(isAuthFailure(Uint8Array.of(0x10, 0x03, 0x04))).toBe(true);
  expect(isAuthFailure(Uint8Array.of(0x10, 0x03, 0x01))).toBe(false);
});

test("the random challenge is extracted from a request-random response", () => {
  const challenge = Uint8Array.from({ length: 16 }, (_, index) => index);
  const response = Uint8Array.of(0x10, 0x02, 0x01, ...challenge);
  expect(parseAuthChallenge(response)).toEqual(challenge);
  expect(parseAuthChallenge(Uint8Array.of(0x10, 0x02, 0x04, ...challenge))).toBeNull();
  expect(parseAuthChallenge(Uint8Array.of(0x10, 0x02, 0x01, 1, 2))).toBeNull();
});

// ---------------------------------------------------------------------------
// Activity fetch
// ---------------------------------------------------------------------------

test("the activity start frame encodes the local minute and quarter-hour offset", () => {
  const since = new Date(2026, 10, 9, 12, 34, 0);
  const frame = buildActivityStartFrame(since, -since.getTimezoneOffset());
  const year = since.getFullYear();
  expect(Array.from(frame.slice(0, 8))).toEqual([
    0x01,
    0x01,
    year & 0xff,
    (year >>> 8) & 0xff,
    11,
    9,
    12,
    34,
  ]);
  expect(frame[8]).toBe(0x00);
  expect(frame[9]).toBe(Math.round(-since.getTimezoneOffset() / 15) & 0xff);
  expect([...buildActivityFetchFrame()]).toEqual([0x02]);
  expect([...buildActivityAckFrame()]).toEqual([0x03]);
});

test("the current-time frame matches calendarToRawBytes plus the timezone tail", () => {
  const now = new Date(2026, 1, 1, 8, 30, 15);
  const frame = buildCurrentTimeFrame(now, -now.getTimezoneOffset());
  expect(frame).toHaveLength(11);
  expect(Array.from(frame.slice(0, 7))).toEqual([0xea, 0x07, 2, 1, 8, 30, 15]);
  expect(frame[7]).toBe(7); // 2026-02-01 is a Sunday
  expect(frame[8]).toBe(0);
  expect(frame[9]).toBe(0);
});

test("a start response yields the expected length and device timestamp", () => {
  const response = Uint8Array.of(
    0x10,
    0x01,
    0x01,
    0x10,
    0x00,
    0x00,
    0x00,
    0xea,
    0x07,
    2,
    1,
    8,
    30,
    0,
    0,
  );
  expect(parseActivityControlResponse(response)).toEqual({
    kind: "start",
    expectedLength: 16,
    startTime: "2026-02-01T08:30:00.000Z",
  });
  // 16-byte MB7 variant with a trailing zero is accepted.
  expect(parseActivityControlResponse(Uint8Array.of(...response, 0x00))).toMatchObject({
    kind: "start",
    expectedLength: 16,
  });
  // Unsuccessful start is ignored.
  expect(parseActivityControlResponse(Uint8Array.of(0x10, 0x01, 0x02, 0, 0, 0, 0))).toBeNull();
});

test("data and ack responses parse, with an optional CRC32", () => {
  expect(parseActivityControlResponse(Uint8Array.of(0x10, 0x02, 0x01))).toEqual({
    kind: "data",
    crc32: null,
  });
  expect(
    parseActivityControlResponse(Uint8Array.of(0x10, 0x02, 0x01, 0x78, 0x56, 0x34, 0x12)),
  ).toEqual({ kind: "data", crc32: 0x12345678 });
  expect(parseActivityControlResponse(Uint8Array.of(0x10, 0x03, 0x01))).toEqual({
    kind: "ack",
  });
  expect(parseActivityControlResponse(Uint8Array.of(0x10, 0x09, 0x01))).toBeNull();
});

test("an 8-byte timestamp applies the signed quarter-hour offset", () => {
  // 2026-02-01 09:30 at UTC+1 is 08:30Z.
  const bytes = Uint8Array.of(0xea, 0x07, 2, 1, 9, 30, 0, 4);
  expect(parseHuamiTimestamp(bytes)).toBe("2026-02-01T08:30:00.000Z");
  // A negative offset (UTC-5) is a signed byte.
  const negative = Uint8Array.of(0xea, 0x07, 2, 1, 3, 30, 0, 0xec);
  expect(parseHuamiTimestamp(negative)).toBe("2026-02-01T08:30:00.000Z");
});

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------

test("4-byte samples parse one per minute and floor to the minute", () => {
  const bytes = Uint8Array.of(9, 10, 3, 60, 11, 5, 0, 0);
  const samples = parseActivitySamples(bytes, 4, "2026-02-01T08:30:42.000Z");
  expect(samples).toHaveLength(2);
  expect(samples[0]).toMatchObject({
    timestamp: Date.parse("2026-02-01T08:30:00.000Z"),
    rawKind: 9,
    rawIntensity: 10,
    steps: 3,
    heartRate: 60,
    sleep: null,
    deepSleep: null,
    remSleep: null,
  });
  expect(samples[1]).toMatchObject({
    timestamp: Date.parse("2026-02-01T08:31:00.000Z"),
    rawKind: 11,
    steps: 0,
    heartRate: 0,
  });
});

test("8-byte samples carry the extended sleep fields", () => {
  const bytes = Uint8Array.of(1, 2, 3, 60, 4, 5, 6, 7);
  const [sample] = parseActivitySamples(bytes, 8, "2026-02-01T08:30:00.000Z");
  expect(sample).toMatchObject({
    rawKind: 1,
    rawIntensity: 2,
    steps: 3,
    heartRate: 60,
    unknown1: 4,
    sleep: 5,
    deepSleep: 6,
    remSleep: 7,
  });
});

test("a partial sample is rejected", () => {
  expect(() => parseActivitySamples(Uint8Array.of(1, 2, 3), 4, "2026-02-01T08:30:00.000Z")).toThrow(
    "HUAMI_SAMPLE_LENGTH_MISMATCH",
  );
});

test("a minute becomes an exact-minute steps record and a valid heart-rate point", () => {
  const [sample] = parseActivitySamples(Uint8Array.of(9, 10, 3, 60), 4, "2026-02-01T08:30:00.000Z");
  expect(minuteSampleToRecords(sample!)).toEqual([
    {
      type: "steps",
      startTime: "2026-02-01T08:30:00.000Z",
      endTime: "2026-02-01T08:31:00.000Z",
      count: 3,
    },
    { type: "heart_rate", time: "2026-02-01T08:30:00.000Z", bpm: 60 },
  ]);

  const [zero] = parseActivitySamples(Uint8Array.of(9, 10, 0, 0), 4, "2026-02-01T08:30:00.000Z");
  expect(minuteSampleToRecords(zero!)).toEqual([
    {
      type: "steps",
      startTime: "2026-02-01T08:30:00.000Z",
      endTime: "2026-02-01T08:31:00.000Z",
      count: 0,
    },
  ]);
});

test("the realtime heart-rate parser handles 8- and 16-bit values", () => {
  expect(parseHeartRateMeasurement(Uint8Array.of(0x00, 72))).toBe(72);
  expect(parseHeartRateMeasurement(Uint8Array.of(0x01, 0x2c, 0x00))).toBe(44);
  expect(parseHeartRateMeasurement(Uint8Array.of(0x01, 0x2c, 0x01))).toBeNull();
  expect(parseHeartRateMeasurement(Uint8Array.of(0x00, 0))).toBeNull();
  expect(parseHeartRateMeasurement(Uint8Array.of(0x00, 255))).toBeNull();
  expect(parseHeartRateMeasurement(Uint8Array.of(0x00))).toBeNull();
});

// ---------------------------------------------------------------------------
// Sleep segmentation
// ---------------------------------------------------------------------------

function minute(index: number, kind: number, steps = 0): HuamiMinuteSample {
  return {
    timestamp: Date.parse("2026-02-01T00:00:00.000Z") + index * 60_000,
    rawKind: kind,
    rawIntensity: 0,
    steps,
    heartRate: 0,
    unknown1: null,
    sleep: null,
    deepSleep: null,
    remSleep: null,
  };
}

test("contiguous kind-9/11 runs become one session with per-stage intervals", () => {
  const samples = [
    ...Array.from({ length: 3 }, (_, index) => minute(index, HUAMI_KIND_LIGHT_SLEEP)),
    ...Array.from({ length: 3 }, (_, index) => minute(index + 3, HUAMI_KIND_DEEP_SLEEP)),
    minute(6, HUAMI_KIND_WAKE_UP),
    ...Array.from({ length: 3 }, (_, index) => minute(index + 7, HUAMI_KIND_LIGHT_SLEEP)),
  ];
  const sessions = segmentSleepSessions(samples);
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({
    type: "sleep_session",
    startTime: "2026-02-01T00:00:00.000Z",
    endTime: "2026-02-01T00:10:00.000Z",
  });
  expect(sessions[0]!.stages).toEqual([
    { stage: "light", startTime: "2026-02-01T00:00:00.000Z", endTime: "2026-02-01T00:03:00.000Z" },
    { stage: "deep", startTime: "2026-02-01T00:03:00.000Z", endTime: "2026-02-01T00:06:00.000Z" },
    { stage: "awake", startTime: "2026-02-01T00:06:00.000Z", endTime: "2026-02-01T00:07:00.000Z" },
    { stage: "light", startTime: "2026-02-01T00:07:00.000Z", endTime: "2026-02-01T00:10:00.000Z" },
  ]);
});

test("a non-sleep minute with steps closes the session", () => {
  const samples = [
    ...Array.from({ length: 10 }, (_, index) => minute(index, HUAMI_KIND_LIGHT_SLEEP)),
    minute(10, HUAMI_KIND_WAKE_UP, 5),
    ...Array.from({ length: 10 }, (_, index) => minute(index + 11, HUAMI_KIND_DEEP_SLEEP)),
  ];
  const sessions = segmentSleepSessions(samples);
  expect(sessions).toHaveLength(2);
  expect(sessions[0]!.endTime).toBe("2026-02-01T00:10:00.000Z");
  expect(sessions[1]!.startTime).toBe("2026-02-01T00:11:00.000Z");
});

test("a session of five minutes or less is discarded", () => {
  const samples = Array.from({ length: 5 }, (_, index) => minute(index, HUAMI_KIND_LIGHT_SLEEP));
  // span = 4 minutes + trailing minute = 300 s, not greater than the minimum.
  expect(segmentSleepSessions(samples)).toEqual([]);
});

test("non-sleep kinds alone produce no session", () => {
  const samples = Array.from({ length: 20 }, (_, index) => minute(index, HUAMI_KIND_WAKE_UP));
  expect(segmentSleepSessions(samples)).toEqual([]);
});
