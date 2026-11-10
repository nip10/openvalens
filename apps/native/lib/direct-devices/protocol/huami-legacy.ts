/**
 * Pure legacy Huami protocol codecs and parsers.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2:
 * - `service/devices/huami/HuamiSupport.java` (`writeToChunkedOld`,
 *   `getTimeBytes`, `handleHeartrate`, HR control-point commands)
 * - `service/devices/huami/operations/init/InitOperation.java` (auth handshake)
 * - `service/devices/huami/operations/fetch/AbstractFetchOperation.java`
 * - `service/devices/huami/operations/fetch/AbstractRepeatingFetchOperation.java`
 * - `service/devices/huami/operations/fetch/FetchActivityOperation.java`
 * - `devices/huami/HuamiConst.java` (activity kinds)
 * - `devices/SleepSessionSegmenter.java` (sleep session rules)
 *
 * Chunked writes
 * --------------
 * `writeToChunkedOld` frames a payload as `00 <flags|type> <count> <bytes>`.
 * The payload capacity per write is `calcMaxWriteChunk(mtu) - 3`, where
 * `calcMaxWriteChunk(mtu) = min(512, max(23, mtu) - 3)`. The last chunk sets
 * `0x80`; the first chunk of a single-chunk message also sets `0x40`, and every
 * non-first chunk sets `0x40`. `count` is a byte and wraps at 256.
 *
 * Auth
 * ----
 * Three-step handshake (`cryptFlags == 0x00`):
 *   `01 <authFlags> <16-byte key>` → `10 01 01`
 *   `02 <authFlags>` → `10 02 01 <16-byte random challenge>`
 *   `03 <authFlags> <AES-128-ECB(key, challenge)>` → `10 03 01`
 * Crypt handshake (`cryptFlags == 0x80`): the send-key step is skipped and the
 * request/response commands carry the 0x80 bit:
 *   `82 <authFlags> 02 01 00` → `10 02 01 <challenge>`
 *   `83 <authFlags> <AES-128-ECB(key, challenge)>` → `10 03 01`
 * A failure status is `0x04` (`AUTH_FAIL`).
 *
 * Activity fetch
 * --------------
 * Control characteristic `00000004`, data characteristic `00000005`.
 *   start: `01 01 <8-byte local timestamp>` → `10 01 01 <len LE32> <8-byte ts>`
 *   fetch: `02` (data notifications already enabled)
 *   stream: first byte is a wrapping packet counter, the rest is sample bytes
 *   done:  `10 02 01 [<crc32 LE32>]` (the checksum is ignored, as upstream)
 *   ack:   `03` → `10 03 ...`
 * Repeating fetches continue from the last sample + 1 minute, capped at ten
 * rounds, until the device reports data at or past the current time.
 *
 * Samples
 * -------
 * One sample per minute. 4-byte: `rawKind, rawIntensity, steps, heartRate`.
 * 8-byte adds `unknown1, sleep, deepSleep, remSleep`. Timestamps are
 * device-local wall-clock values plus the device's UTC offset, so samples land
 * on exact UTC minutes.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import { resolveHuamiSampleSize } from "../models/huami-legacy";
import type { HuamiLegacyRecordType } from "../models/huami-legacy";

/** Auth command bytes (`HuamiService`). */
export const HUAMI_AUTH_SEND_KEY = 0x01;
export const HUAMI_AUTH_REQUEST_RANDOM = 0x02;
export const HUAMI_AUTH_SEND_ENCRYPTED = 0x03;
export const HUAMI_AUTH_RESPONSE = 0x10;
export const HUAMI_AUTH_SUCCESS = 0x01;
export const HUAMI_AUTH_FAIL = 0x04;
/** Default auth byte (`HuamiService.AUTH_BYTE`). */
export const HUAMI_AUTH_BYTE = 0x08;
/** Crypt flag ORed into request/response commands. */
export const HUAMI_CRYPT_FLAG = 0x80;

/** Activity control/data commands (`HuamiService`). */
export const HUAMI_COMMAND_ACTIVITY_START_DATE = 0x01;
export const HUAMI_COMMAND_ACTIVITY_TYPE = 0x01;
export const HUAMI_COMMAND_FETCH_DATA = 0x02;
export const HUAMI_COMMAND_ACK_ACTIVITY_DATA = 0x03;
export const HUAMI_RESPONSE = 0x10;
export const HUAMI_SUCCESS = 0x01;

/** Activity kinds (`HuamiConst`). */
export const HUAMI_KIND_NONWEAR = 3;
export const HUAMI_KIND_LIGHT_SLEEP = 9;
export const HUAMI_KIND_IGNORE = 10;
export const HUAMI_KIND_DEEP_SLEEP = 11;
export const HUAMI_KIND_WAKE_UP = 12;

/** Upstream `SleepSessionSegmenter` constants. */
export const HUAMI_MIN_SESSION_SECONDS = 5 * 60;
export const HUAMI_MAX_WAKE_PHASE_SECONDS = 60 * 60;
export const HUAMI_TRAILING_STAGE_SECONDS = 60;

/** One activity sample, one exact minute. */
export type HuamiMinuteSample = Readonly<{
  /** Epoch milliseconds of the minute start (floored to the minute). */
  timestamp: number;
  rawKind: number;
  rawIntensity: number;
  steps: number;
  heartRate: number;
  /** 8-byte samples only. */
  unknown1: number | null;
  sleep: number | null;
  deepSleep: number | null;
  remSleep: number | null;
}>;

export type HuamiStepsRecord = Readonly<{
  type: "steps";
  startTime: string;
  endTime: string;
  count: number;
}>;

export type HuamiHeartRateRecord = Readonly<{
  type: "heart_rate";
  time: string;
  bpm: number;
}>;

export type HuamiSleepStage = Readonly<{
  stage: "light" | "deep" | "awake";
  startTime: string;
  endTime: string;
}>;

export type HuamiSleepSession = Readonly<{
  type: "sleep_session";
  startTime: string;
  endTime: string;
  stages?: readonly HuamiSleepStage[];
}>;

/** Any record a legacy Huami session can emit. */
export type HuamiLegacyRecord = HuamiStepsRecord | HuamiHeartRateRecord | HuamiSleepSession;

/** Failure kinds reported by the transport. */
export type HuamiLegacyFailure = HuamiLegacyRecordType | "init" | "auth";

/** AES-128-ECB with no padding; injected so tests can use independent crypto. */
export type HuamiAuthCrypto = Readonly<{
  aesEcbEncrypt(key: Uint8Array, data: Uint8Array): Uint8Array;
}>;

const MINUTE_MS = 60_000;

function uint32le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function int8(value: number): number {
  return (value << 24) >> 24;
}

function isoMinute(timestamp: number): string {
  return new Date(Math.floor(timestamp / MINUTE_MS) * MINUTE_MS).toISOString();
}

// ---------------------------------------------------------------------------
// Chunked writes
// ---------------------------------------------------------------------------

/** `AbstractBTLEDeviceSupport.calcMaxWriteChunk`: the max single-write payload. */
export function calcMaxWriteChunk(mtu: number): number {
  const safeMtu = Math.max(23, Math.trunc(mtu));
  return Math.min(512, safeMtu - 3);
}

/** Payload bytes per chunked write after the 3-byte header. */
export function chunkedPayloadCapacity(mtu: number): number {
  return calcMaxWriteChunk(mtu) - 3;
}

/**
 * Builds the chunked-write frames for `data`: `00 <flags|type> <count>` plus
 * payload. Throws when `data` is empty (upstream never writes an empty chunk).
 */
export function buildChunkedWrites(type: number, data: Uint8Array, mtu: number): Uint8Array[] {
  if (data.length === 0) throw new RangeError("HUAMI_CHUNKED_EMPTY");
  const capacity = chunkedPayloadCapacity(mtu);
  if (capacity < 1) throw new RangeError("HUAMI_CHUNKED_INVALID_MTU");
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let count = 0;
  while (offset < data.length) {
    const remaining = data.length - offset;
    const take = Math.min(remaining, capacity);
    const last = remaining <= capacity;
    let flags = 0;
    if (last) {
      flags |= 0x80;
      if (count === 0) flags |= 0x40;
    } else if (count > 0) {
      flags |= 0x40;
    }
    const chunk = new Uint8Array(3 + take);
    chunk[0] = 0x00;
    chunk[1] = (flags | (type & 0xff)) & 0xff;
    chunk[2] = count & 0xff;
    chunk.set(data.subarray(offset, offset + take), 3);
    chunks.push(chunk);
    offset += take;
    count += 1;
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Parses a user-entered 16-byte key. Accepts `0x` + 32 hex characters, bare
 * 32 hex characters (the settings screen accepts both), or exactly 16 printable
 * ASCII characters. Everything else is rejected.
 */
export function parseHuamiAuthKey(input: string): Uint8Array {
  const trimmed = input.trim();
  if (/^0x[0-9a-fA-F]{32}$/.test(trimmed)) return hexToBytes(trimmed.slice(2));
  if (/^[0-9a-fA-F]{32}$/.test(trimmed)) return hexToBytes(trimmed);
  if (trimmed.length === 16 && /^[\x20-\x7e]{16}$/.test(trimmed)) {
    return Uint8Array.from(trimmed, (character) => character.charCodeAt(0));
  }
  throw new RangeError("HUAMI_AUTH_KEY_INVALID");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** `01 <authFlags> <16-byte key>`. */
export function buildAuthSendKey(authFlags: number, key: Uint8Array): Uint8Array {
  if (key.length !== 16) throw new RangeError("HUAMI_AUTH_KEY_LENGTH");
  const frame = new Uint8Array(2 + key.length);
  frame[0] = HUAMI_AUTH_SEND_KEY;
  frame[1] = authFlags & 0xff;
  frame.set(key, 2);
  return frame;
}

/**
 * `02 <authFlags>` for the three-step handshake, or
 * `82 <authFlags> 02 01 00` for the crypt handshake.
 */
export function buildAuthRequestRandom(authFlags: number, cryptFlags: number): Uint8Array {
  if ((cryptFlags & HUAMI_CRYPT_FLAG) !== 0) {
    return Uint8Array.of(
      (HUAMI_AUTH_REQUEST_RANDOM | HUAMI_CRYPT_FLAG) & 0xff,
      authFlags & 0xff,
      0x02,
      0x01,
      0x00,
    );
  }
  return Uint8Array.of(HUAMI_AUTH_REQUEST_RANDOM, authFlags & 0xff);
}

/** `<03|cryptFlags> <authFlags> <16-byte encrypted challenge>`. */
export function buildAuthSendEncrypted(
  authFlags: number,
  cryptFlags: number,
  encrypted: Uint8Array,
): Uint8Array {
  if (encrypted.length !== 16) throw new RangeError("HUAMI_AUTH_BLOCK_LENGTH");
  const frame = new Uint8Array(2 + encrypted.length);
  frame[0] = (HUAMI_AUTH_SEND_ENCRYPTED | (cryptFlags & HUAMI_CRYPT_FLAG)) & 0xff;
  frame[1] = authFlags & 0xff;
  frame.set(encrypted, 2);
  return frame;
}

export type HuamiAuthResponse = Readonly<{ command: number; status: number }>;

/** Parses an auth notification (`10 <command> <status> ...`). */
export function parseAuthResponse(bytes: Uint8Array): HuamiAuthResponse | null {
  if (bytes.length < 3 || bytes[0] !== HUAMI_AUTH_RESPONSE) return null;
  return { command: bytes[1]! & 0x0f, status: bytes[2]! };
}

/** True when the response is a success for `command`. */
export function isAuthSuccess(bytes: Uint8Array, command: number): boolean {
  const response = parseAuthResponse(bytes);
  return (
    response !== null && response.command === command && response.status === HUAMI_AUTH_SUCCESS
  );
}

/** True when the response is an explicit authentication failure. */
export function isAuthFailure(bytes: Uint8Array): boolean {
  const response = parseAuthResponse(bytes);
  return response !== null && response.status === HUAMI_AUTH_FAIL;
}

/**
 * Extracts the 16-byte challenge from a request-random response
 * (`10 02 01 <challenge>`).
 */
export function parseAuthChallenge(bytes: Uint8Array): Uint8Array | null {
  if (!isAuthSuccess(bytes, HUAMI_AUTH_REQUEST_RANDOM) || bytes.length < 19) return null;
  return bytes.slice(3, 19);
}

/** AES-128-ECB/NoPadding over the 16-byte challenge. */
export function encryptAuthChallenge(
  key: Uint8Array,
  challenge: Uint8Array,
  crypto: HuamiAuthCrypto,
): Uint8Array {
  if (key.length !== 16) throw new RangeError("HUAMI_AUTH_KEY_LENGTH");
  if (challenge.length !== 16) throw new RangeError("HUAMI_AUTH_BLOCK_LENGTH");
  const encrypted = crypto.aesEcbEncrypt(key, challenge);
  if (encrypted.length !== 16) throw new RangeError("HUAMI_AUTH_BLOCK_LENGTH");
  return encrypted;
}

/** Lazily loads AES-128-ECB from `react-native-quick-crypto`. */
export async function loadHuamiAuthCrypto(): Promise<HuamiAuthCrypto> {
  const native = (await import("react-native-quick-crypto")) as unknown as {
    createCipheriv(
      algorithm: string,
      key: Uint8Array,
      iv: Uint8Array | null,
    ): {
      setAutoPadding(value: boolean): void;
      update(data: Uint8Array): Uint8Array;
      final(): Uint8Array;
    };
  };
  return {
    aesEcbEncrypt(key, data) {
      const cipher = native.createCipheriv("aes-128-ecb", key, null);
      cipher.setAutoPadding(false);
      return concatBytes(cipher.update(data), cipher.final());
    },
  };
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Current time
// ---------------------------------------------------------------------------

/**
 * `<year LE16> <month> <day> <hour> <minute> <second> <dayOfWeek> 00 00 <tz>`
 * where `tz` is the UTC offset in signed quarter-hours (`mapTimeZone`).
 */
export function buildCurrentTimeFrame(now: Date, tzOffsetMinutes: number): Uint8Array {
  const year = now.getFullYear();
  const quarterHours = Math.max(-48, Math.min(56, Math.round(tzOffsetMinutes / 15)));
  const day = now.getDay();
  return Uint8Array.of(
    year & 0xff,
    (year >>> 8) & 0xff,
    now.getMonth() + 1,
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    day === 0 ? 7 : day,
    0x00,
    0x00,
    quarterHours & 0xff,
  );
}

// ---------------------------------------------------------------------------
// Activity fetch frames
// ---------------------------------------------------------------------------

/**
 * `01 01 <year LE16> <month> <day> <hour> <minute> 00 <tz quarter-hours>`.
 * `tzOffsetMinutes` is the device-local offset east of UTC at `since`
 * (`-since.getTimezoneOffset()`).
 */
export function buildActivityStartFrame(since: Date, tzOffsetMinutes: number): Uint8Array {
  const year = since.getFullYear();
  const quarterHours = Math.max(-48, Math.min(56, Math.round(tzOffsetMinutes / 15)));
  return Uint8Array.of(
    HUAMI_COMMAND_ACTIVITY_START_DATE,
    HUAMI_COMMAND_ACTIVITY_TYPE,
    year & 0xff,
    (year >>> 8) & 0xff,
    since.getMonth() + 1,
    since.getDate(),
    since.getHours(),
    since.getMinutes(),
    0x00,
    quarterHours & 0xff,
  );
}

/** `02`: request the actual data transfer. */
export function buildActivityFetchFrame(): Uint8Array {
  return Uint8Array.of(HUAMI_COMMAND_FETCH_DATA);
}

/** `03`: acknowledge (and drop) the transferred data. */
export function buildActivityAckFrame(): Uint8Array {
  return Uint8Array.of(HUAMI_COMMAND_ACK_ACTIVITY_DATA);
}

// ---------------------------------------------------------------------------
// Heart rate
// ---------------------------------------------------------------------------

/** `15 01 01`: start continuous measurement (`startHeartMeasurementContinuous`). */
export const HUAMI_HR_START_CONTINUOUS = Uint8Array.of(0x15, 0x01, 0x01);
/** `15 01 00`: stop continuous measurement. */
export const HUAMI_HR_STOP_CONTINUOUS = Uint8Array.of(0x15, 0x01, 0x00);
/** `15 02 01`: start a manual measurement. */
export const HUAMI_HR_START_MANUAL = Uint8Array.of(0x15, 0x02, 0x01);
/** `15 02 00`: stop a manual measurement. */
export const HUAMI_HR_STOP_MANUAL = Uint8Array.of(0x15, 0x02, 0x00);

/**
 * Parses a standard Heart Rate Measurement (`0x2A37`) notification. Bit 0 of
 * the flags selects a 16-bit value; Huami emits `00 <bpm>`. Values outside
 * 1..254 are treated as unmeasured.
 */
export function parseHeartRateMeasurement(bytes: Uint8Array): number | null {
  if (bytes.length < 2) return null;
  const flags = bytes[0]!;
  const bpm =
    (flags & 0x01) !== 0 ? (bytes.length >= 3 ? bytes[1]! | (bytes[2]! << 8) : 0) : bytes[1]!;
  return bpm >= 1 && bpm <= 254 ? bpm : null;
}

export type HuamiActivityControlResponse =
  | Readonly<{ kind: "start"; expectedLength: number; startTime: string }>
  | Readonly<{ kind: "data"; crc32: number | null }>
  | Readonly<{ kind: "ack" }>;

/**
 * Parses a control-characteristic notification. Returns null for non-responses
 * and for unsuccessful start/fetch replies.
 */
export function parseActivityControlResponse(
  bytes: Uint8Array,
): HuamiActivityControlResponse | null {
  if (bytes.length < 3 || bytes[0] !== HUAMI_RESPONSE) return null;
  const command = bytes[1]!;
  if (command === HUAMI_COMMAND_ACTIVITY_START_DATE) {
    if (bytes[2] !== HUAMI_SUCCESS) return null;
    if (bytes.length !== 15 && bytes.length !== 16) return null;
    const startTime = parseHuamiTimestamp(bytes.subarray(7, 15));
    if (!startTime) return null;
    return { kind: "start", expectedLength: uint32le(bytes, 3), startTime };
  }
  if (command === HUAMI_COMMAND_FETCH_DATA) {
    if (bytes[2] !== HUAMI_SUCCESS) return null;
    if (bytes.length !== 3 && bytes.length !== 7) return null;
    return { kind: "data", crc32: bytes.length === 7 ? uint32le(bytes, 3) : null };
  }
  if (command === HUAMI_COMMAND_ACK_ACTIVITY_DATA) return { kind: "ack" };
  return null;
}

/**
 * Parses the 8-byte device timestamp (`year LE16, month, day, hour, minute,
 * second, tz quarter-hours`). A 7-byte value is interpreted in the phone's
 * timezone, matching upstream `rawBytesToCalendar`.
 */
export function parseHuamiTimestamp(bytes: Uint8Array): string | null {
  if (bytes.length < 7) return null;
  const year = bytes[0]! | (bytes[1]! << 8);
  const month = bytes[2]!;
  const day = bytes[3]!;
  const hour = bytes[4]!;
  const minute = bytes[5]!;
  const second = bytes[6]!;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const date =
    bytes.length >= 8
      ? new Date(
          Date.UTC(year, month - 1, day, hour, minute, second) - int8(bytes[7]!) * 15 * MINUTE_MS,
        )
      : new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

// ---------------------------------------------------------------------------
// Activity samples
// ---------------------------------------------------------------------------

/**
 * Splits one round's buffered sample bytes into per-minute samples. `startTime`
 * is the device-reported first-sample timestamp; any seconds are discarded so
 * every sample lands on an exact UTC minute. Throws when the buffer is not a
 * whole number of samples.
 */
export function parseActivitySamples(
  bytes: Uint8Array,
  sampleSize: 4 | 8,
  startTime: string,
): HuamiMinuteSample[] {
  if (sampleSize !== 4 && sampleSize !== 8) throw new RangeError("HUAMI_SAMPLE_SIZE_INVALID");
  if (bytes.length % sampleSize !== 0) throw new RangeError("HUAMI_SAMPLE_LENGTH_MISMATCH");
  const start = Date.parse(startTime);
  if (Number.isNaN(start)) throw new RangeError("HUAMI_SAMPLE_START_INVALID");
  const minuteStart = Math.floor(start / MINUTE_MS) * MINUTE_MS;
  const samples: HuamiMinuteSample[] = [];
  for (let offset = 0, minute = 0; offset < bytes.length; offset += sampleSize, minute += 1) {
    samples.push({
      timestamp: minuteStart + minute * MINUTE_MS,
      rawKind: bytes[offset]!,
      rawIntensity: bytes[offset + 1]!,
      steps: bytes[offset + 2]!,
      heartRate: bytes[offset + 3]!,
      unknown1: sampleSize === 8 ? bytes[offset + 4]! : null,
      sleep: sampleSize === 8 ? bytes[offset + 5]! : null,
      deepSleep: sampleSize === 8 ? bytes[offset + 6]! : null,
      remSleep: sampleSize === 8 ? bytes[offset + 7]! : null,
    });
  }
  return samples;
}

/**
 * Converts one minute into the frozen record shapes: always an exact-minute
 * `steps` record, plus a `heart_rate` point when the sample carries a valid
 * value (1..254, the range upstream treats as measured).
 */
export function minuteSampleToRecords(sample: HuamiMinuteSample): readonly HuamiLegacyRecord[] {
  const records: HuamiLegacyRecord[] = [
    {
      type: "steps",
      startTime: isoMinute(sample.timestamp),
      endTime: new Date(
        Math.floor(sample.timestamp / MINUTE_MS) * MINUTE_MS + MINUTE_MS,
      ).toISOString(),
      count: sample.steps,
    },
  ];
  if (sample.heartRate >= 1 && sample.heartRate <= 254) {
    records.push({
      type: "heart_rate",
      time: isoMinute(sample.timestamp),
      bpm: sample.heartRate,
    });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Sleep
// ---------------------------------------------------------------------------

function isSleepKind(kind: number): boolean {
  return kind === HUAMI_KIND_LIGHT_SLEEP || kind === HUAMI_KIND_DEEP_SLEEP;
}

function sleepStage(kind: number): HuamiSleepStage["stage"] {
  if (kind === HUAMI_KIND_LIGHT_SLEEP) return "light";
  if (kind === HUAMI_KIND_DEEP_SLEEP) return "deep";
  return "awake";
}

/**
 * Derives sleep sessions from ordered per-minute samples, mirroring
 * `SleepSessionSegmenter`:
 * - a session starts at the first kind-9/11 sample;
 * - a non-sleep sample with steps, or a wake phase longer than 60 minutes,
 *   closes it;
 * - sessions spanning five minutes or less (including the trailing minute) are
 *   discarded;
 * - stages are contiguous runs of the same kind, with non-sleep minutes inside
 *   the session reported as `awake`, and the final stage extended by 60 s.
 */
export function segmentSleepSessions(
  samples: readonly HuamiMinuteSample[],
): readonly HuamiSleepSession[] {
  const sessions: HuamiSleepSession[] = [];
  let firstSleep = -1;
  let lastSleep = -1;
  let wakeSeconds = 0;
  let previous: HuamiMinuteSample | null = null;

  const emit = () => {
    if (firstSleep === -1 || lastSleep === -1) return;
    const start = samples[firstSleep]!.timestamp;
    const end = samples[lastSleep]!.timestamp + HUAMI_TRAILING_STAGE_SECONDS * 1000;
    if (end - start <= HUAMI_MIN_SESSION_SECONDS * 1000) return;
    const stages: HuamiSleepStage[] = [];
    let stageStart = start;
    let stageKind = sleepStage(samples[firstSleep]!.rawKind);
    for (let index = firstSleep + 1; index <= lastSleep; index += 1) {
      const kind = sleepStage(samples[index]!.rawKind);
      if (kind !== stageKind) {
        const stageEnd = samples[index]!.timestamp;
        stages.push({
          stage: stageKind,
          startTime: new Date(stageStart).toISOString(),
          endTime: new Date(stageEnd).toISOString(),
        });
        stageKind = kind;
        stageStart = stageEnd;
      }
    }
    stages.push({
      stage: stageKind,
      startTime: new Date(stageStart).toISOString(),
      endTime: new Date(end).toISOString(),
    });
    sessions.push({
      type: "sleep_session",
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
      stages,
    });
  };

  const reset = () => {
    firstSleep = -1;
    lastSleep = -1;
    wakeSeconds = 0;
  };

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    const sleep = isSleepKind(sample.rawKind);
    if (sleep) {
      if (firstSleep === -1) firstSleep = index;
      lastSleep = index;
      wakeSeconds = 0;
    } else if (firstSleep !== -1 && previous) {
      const gap = (sample.timestamp - previous.timestamp) / 1000;
      if (sample.steps > 0 || wakeSeconds + gap > HUAMI_MAX_WAKE_PHASE_SECONDS) {
        emit();
        reset();
      }
    }
    if (previous && !sleep) {
      wakeSeconds += (sample.timestamp - previous.timestamp) / 1000;
      if (firstSleep !== -1 && wakeSeconds > HUAMI_MAX_WAKE_PHASE_SECONDS) {
        emit();
        reset();
      }
    }
    previous = sample;
  }
  emit();
  return sessions;
}

/**
 * Resolves the sample width for a model rule, given an optional firmware
 * version. Re-exported from the registry so the transport uses one import.
 */
export const resolveSampleSize = resolveHuamiSampleSize;
