/**
 * Pure FitPro (LM517-class) protocol codecs and parsers.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2:
 * - `devices/fitpro/FitProConstants.java`
 * - `devices/fitpro/FitProSampleProvider.java`
 * - `service/devices/fitpro/FitProDeviceSupport.java`
 *
 * Framing
 * -------
 * `CD | fullLenHi | fullLenLo | group | 01 | command | lenHi | lenLo | payload…`
 *
 * - `fullLen = totalLength - 3`, i.e. everything after the two length bytes.
 * - Byte 4 is a constant delimiter/version byte, always `0x01`.
 * - The payload length is repeated in bytes 6..7.
 * - There is NO CRC and NO end byte: the length field is the only integrity
 *   check, so a frame is complete exactly when `fullLen + 3` bytes have
 *   arrived. `createFitProReassembler` relies on that.
 *
 * Acknowledgements
 * ----------------
 * `DC 00 05 <group> 01 <lenHi> <lenLo> 01`, where `<lenHi><lenLo>` is the
 * incoming frame's `fullLen + 3` — that is, the incoming frame's total length
 * (`FitProDeviceSupport.sendAck`). The band only pushes the next packet after
 * it has been acked, so the transport is ack-driven.
 *
 * Fetch chain
 * -----------
 * The trigger is `0x15/0x06` with payload `01`. The band then pushes
 * `0x15/0x07` (start), `0x15/0x08` (data packets) and `0x15/0x10` (end), each
 * acked, followed by the per-day packets `0x15/0x02` (steps) and `0x15/0x03`
 * (sleep), each acked after it has been stored.
 *
 * Step packets (`0x15/0x02`)
 * --------------------------
 * Payload: a 2-byte packed date, two bytes upstream never reads, then 8-byte
 * big-endian records starting at payload offset 4 (frame offset 12). Per
 * record:
 * `steps = data >> 52`, `duration = (data >> 48) & 0xf` (15-minute units),
 * `distance = (data >> 32) & 0xffff`, `calories = data & 0x7ffff`,
 * `activityKind = (data >> 19) & 1`, `time = (data >> 21) & 0x7ff`
 * (15-minute units of the day, `getSecondsOfDay`).
 *
 * Sleep packets (`0x15/0x03`)
 * ---------------------------
 * Payload: the same 2-byte date, the same two unread bytes, then 4-byte
 * records from payload offset 4.
 * Per record: `kind = data & 0xff`, `minutesOfDay = data >> 16` (hh*60+mm).
 * Each record is a stage *start*; upstream marks every record as 15 active
 * minutes. `assembleSleepSessions` turns the starts into sessions.
 *
 * Heart rate (`0x15/0x0e`)
 * ------------------------
 * `seconds = value[12..15]` (i32 BE), `spo2 = value[13]`,
 * `pressureHigh = value[17]`, `pressureLow = value[18]`, `hr = value[19]`, in
 * *frame* coordinates. UPSTREAM BUG: `value[13]` is the second byte of the
 * seconds field, so `spo2` is not a real reading, and the pressure offsets are
 * unverified. This port reads `hr = value[19]` exactly as upstream does and
 * deliberately drops spo2/pressure instead of persisting numbers that are
 * known to overlap another field.
 *
 * Timestamps are device-local wall-clock values with no timezone, interpreted
 * with the phone's timezone offset at that instant (a local `Date` is built and
 * serialised with `.toISOString()`), matching the other direct-device parsers.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { FitProRecordType } from "../models/fitpro";

/** Sleep stage labels, mapped from the upstream stage kind bytes. */
export type FitProStage = "awake" | "light" | "deep";

/** One 15-minute step bucket. */
export type FitProStepsInterval = Readonly<{
  type: "steps_interval";
  startTime: string;
  endTime: string;
  count: number;
}>;

export type FitProSleepStage = Readonly<{
  stage: FitProStage;
  startTime: string;
  endTime: string;
}>;

export type FitProSleepSession = Readonly<{
  type: "sleep_session";
  startTime: string;
  endTime: string;
  stages?: readonly FitProSleepStage[];
}>;

export type FitProHeartRateSample = Readonly<{
  type: "heart_rate";
  time: string;
  bpm: number;
}>;

/** Any record a FitPro session can emit. */
export type FitProRecord = FitProStepsInterval | FitProSleepSession | FitProHeartRateSample;

/** Failure kinds reported by the transport. */
export type FitProFailure = FitProRecordType | "init";

/** A parsed frame: group byte, command byte and payload. */
export type FitProFrame = Readonly<{
  group: number;
  command: number;
  payload: Uint8Array;
}>;

/** A parsed acknowledgement. `length` is the acked frame's total length. */
export type FitProAck = Readonly<{ group: number; length: number }>;

/** A packed calendar date from a per-day packet. */
export type FitProDate = Readonly<{ year: number; month: number; day: number }>;

export const FITPRO_HEADER = 0xcd;
export const FITPRO_HEADER_ACK = 0xdc;
/** Constant delimiter/version byte at frame offset 4. */
export const FITPRO_DELIMITER = 0x01;
/** Header bytes before the payload: `CD lenHi lenLo group 01 cmd lenHi lenLo`. */
export const FITPRO_HEADER_LENGTH = 8;
export const FITPRO_ACK_LENGTH = 8;
/** `fullLen = totalLength - 3`. */
export const FITPRO_LENGTH_BIAS = 3;
/** Largest payload whose `fullLen` still fits the 16-bit field. */
export const FITPRO_MAX_PAYLOAD_LENGTH = 0xffff - (FITPRO_HEADER_LENGTH - FITPRO_LENGTH_BIAS);

/** Command groups (`FitProConstants.CMD_GROUP_*`). */
export const FITPRO_GROUP_GENERAL = 0x12;
export const FITPRO_GROUP_BAND_INFO = 0x20;
export const FITPRO_GROUP_RECEIVE_BUTTON_DATA = 0x1c;
export const FITPRO_GROUP_RECEIVE_SPORTS_DATA = 0x15;
export const FITPRO_GROUP_HEART_RATE_SETTINGS = 0x16;
export const FITPRO_GROUP_REQUEST_DATA = 0x1a;
export const FITPRO_GROUP_BIND = 0x14;
export const FITPRO_GROUP_RESET = 0x1d;

/** General-group commands used here (`FitProConstants.CMD_*`). */
export const FITPRO_CMD_SET_DATE_TIME = 0x01;
export const FITPRO_CMD_INIT1 = 0x0a;
export const FITPRO_CMD_INIT2 = 0x0c;
export const FITPRO_CMD_INIT3 = 0xff;
export const FITPRO_CMD_HEART_RATE_MEASUREMENT = 0x18;

/** Sports-group commands (`FitProConstants.CMD_REQUEST_*`, `RX_*`). */
export const FITPRO_CMD_FETCH_TRIGGER = 0x06;
export const FITPRO_CMD_FETCH_START = 0x07;
export const FITPRO_CMD_FETCH_DATA = 0x08;
export const FITPRO_CMD_FETCH_END = 0x10;
export const FITPRO_CMD_STEPS_PER_DAY = 0x02;
export const FITPRO_CMD_SLEEP_PER_DAY = 0x03;
export const FITPRO_CMD_DAY_TOTALS = 0x0c;
export const FITPRO_CMD_HEART_RATE_DATA = 0x0e;
export const FITPRO_CMD_BAND_INFO = 0x02;

/** Step records: 8 bytes each, 15-minute buckets. */
export const FITPRO_STEPS_RECORD_BYTES = 8;
export const FITPRO_STEPS_RECORDS_OFFSET = 4;
export const FITPRO_STEPS_INTERVAL_MS = 15 * 60_000;

/** Sleep records: 4 bytes each, 15-minute stage windows. */
export const FITPRO_SLEEP_RECORD_BYTES = 4;
export const FITPRO_SLEEP_RECORDS_OFFSET = 4;
export const FITPRO_STAGE_WINDOW_MS = 15 * 60_000;

/** Sleep segmentation bounds, mirroring `SleepSessionSegmenter`. */
export const FITPRO_MIN_SESSION_MS = 5 * 60_000;
export const FITPRO_MAX_WAKE_PHASE_MS = 60 * 60_000;

/** Heart-rate packets need at least the 12 payload bytes upstream reads. */
export const FITPRO_HEART_RATE_PAYLOAD_LENGTH = 12;

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;

function iso(millis: number): string {
  return new Date(millis).toISOString();
}

function toBytes(payload: Uint8Array | readonly number[]): Uint8Array {
  return payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

/** Builds a frame: `CD fullLen group 01 cmd lenHi lenLo payload…`. */
export function buildFrame(
  group: number,
  command: number,
  payload: Uint8Array | readonly number[] = [],
): Uint8Array {
  const bytes = toBytes(payload);
  if (bytes.length > FITPRO_MAX_PAYLOAD_LENGTH) throw new RangeError("FITPRO_PAYLOAD_TOO_LONG");
  const total = FITPRO_HEADER_LENGTH + bytes.length;
  const fullLength = total - FITPRO_LENGTH_BIAS;
  const frame = new Uint8Array(total);
  frame[0] = FITPRO_HEADER;
  frame[1] = (fullLength >> 8) & 0xff;
  frame[2] = fullLength & 0xff;
  frame[3] = group & 0xff;
  frame[4] = FITPRO_DELIMITER;
  frame[5] = command & 0xff;
  frame[6] = (bytes.length >> 8) & 0xff;
  frame[7] = bytes.length & 0xff;
  frame.set(bytes, FITPRO_HEADER_LENGTH);
  return frame;
}

/**
 * Reads the announced total length (`fullLen + 3`) from the first bytes of a
 * frame. Returns null when the header byte is wrong or the length is
 * impossible.
 */
export function announcedLength(bytes: Uint8Array): number | null {
  if (bytes.length < 3) return null;
  if (bytes[0] !== FITPRO_HEADER) return null;
  const total = (((bytes[1]! << 8) | bytes[2]!) + FITPRO_LENGTH_BIAS) & 0xffff;
  return total < FITPRO_HEADER_LENGTH ? null : total;
}

/** Total length of a parsed frame, as the ack length field expects it. */
export function frameLength(frame: FitProFrame): number {
  return FITPRO_HEADER_LENGTH + frame.payload.length;
}

/**
 * Parses one complete frame. Returns null when the header byte, the delimiter
 * byte, the announced length or the payload length disagree with the bytes
 * actually present — the length field is the only integrity check the protocol
 * has.
 */
export function parseFrame(bytes: Uint8Array): FitProFrame | null {
  if (bytes.length < FITPRO_HEADER_LENGTH) return null;
  if (bytes[0] !== FITPRO_HEADER) return null;
  if (bytes[4] !== FITPRO_DELIMITER) return null;
  const fullLength = (bytes[1]! << 8) | bytes[2]!;
  if (fullLength !== bytes.length - FITPRO_LENGTH_BIAS) return null;
  const payloadLength = (bytes[6]! << 8) | bytes[7]!;
  if (payloadLength !== bytes.length - FITPRO_HEADER_LENGTH) return null;
  return {
    group: bytes[3]!,
    command: bytes[5]!,
    payload: bytes.slice(FITPRO_HEADER_LENGTH),
  };
}

/**
 * Builds the acknowledgement for a received frame:
 * `DC 00 05 group 01 lenHi lenLo 01`, with `length` = the received frame's
 * total length (`fullLen + 3`).
 */
export function buildAck(group: number, length: number): Uint8Array {
  if (!Number.isInteger(length) || length < FITPRO_HEADER_LENGTH || length > 0xffff)
    throw new RangeError("FITPRO_INVALID_ACK_LENGTH");
  return Uint8Array.from([
    FITPRO_HEADER_ACK,
    0x00,
    0x05,
    group & 0xff,
    FITPRO_DELIMITER,
    (length >> 8) & 0xff,
    length & 0xff,
    FITPRO_DELIMITER,
  ]);
}

/** Parses an acknowledgement (`DC 00 05 group 01 lenHi lenLo 01`). */
export function parseAck(bytes: Uint8Array): FitProAck | null {
  if (bytes.length < FITPRO_ACK_LENGTH) return null;
  if (bytes[0] !== FITPRO_HEADER_ACK) return null;
  if (bytes[2] !== 0x05) return null;
  if (bytes[4] !== FITPRO_DELIMITER || bytes[7] !== FITPRO_DELIMITER) return null;
  return { group: bytes[3]!, length: (bytes[5]! << 8) | bytes[6]! };
}

export type FitProReassembler = Readonly<{
  /** Stores one notification; returns every frame it completed. */
  push(fragment: Uint8Array): readonly FitProFrame[];
}>;

/**
 * Reassembles notifications into frames. A step packet with many records is
 * larger than one notification, so fragments are collected until the announced
 * `fullLen + 3` bytes are present. A notification that carries several whole
 * frames yields several parsed frames.
 */
export function createFitProReassembler(): FitProReassembler {
  let buffer = new Uint8Array(0);
  return {
    push(fragment) {
      if (fragment.length === 0) return [];
      const merged = new Uint8Array(buffer.length + fragment.length);
      merged.set(buffer, 0);
      merged.set(fragment, buffer.length);
      buffer = merged;

      const frames: FitProFrame[] = [];
      while (buffer.length > 0) {
        if (buffer[0] !== FITPRO_HEADER) {
          buffer = new Uint8Array(0);
          break;
        }
        const total = announcedLength(buffer);
        if (total === null || buffer.length < total) break;
        const frame = parseFrame(buffer.subarray(0, total));
        if (frame) frames.push(frame);
        buffer = buffer.slice(total);
      }
      return frames;
    },
  };
}

// ---------------------------------------------------------------------------
// Command builders
// ---------------------------------------------------------------------------

/** The fetch trigger: `0x15/0x06` with payload `01`. */
export function buildFetchTriggerPacket(): Uint8Array {
  return buildFrame(FITPRO_GROUP_RECEIVE_SPORTS_DATA, FITPRO_CMD_FETCH_TRIGGER, [0x01]);
}

/**
 * Realtime heart-rate measurement on/off (`0x12/0x18`, upstream
 * `onHeartRateTest`).
 */
export function buildHeartRateMeasurementPacket(enabled: boolean): Uint8Array {
  return buildFrame(FITPRO_GROUP_GENERAL, FITPRO_CMD_HEART_RATE_MEASUREMENT, [enabled ? 1 : 0]);
}

/**
 * Clock set (`0x12/0x01`, upstream `setTime`). The four-byte value is the
 * phone's local calendar packed as
 * `second | minute << 6 | hour << 12 | day << 17 | month << 22 | (year-2000) << 26`.
 */
export function buildSetTimePacket(now: Date): Uint8Array {
  const packed =
    (now.getSeconds() & 0x3f) |
    ((now.getMinutes() & 0x3f) << 6) |
    ((now.getHours() & 0x1f) << 12) |
    ((now.getDate() & 0x1f) << 17) |
    (((now.getMonth() + 1) & 0x0f) << 22) |
    (((now.getFullYear() - 2000) & 0x3f) << 26);
  return buildFrame(FITPRO_GROUP_GENERAL, FITPRO_CMD_SET_DATE_TIME, [
    (packed >>> 24) & 0xff,
    (packed >>> 16) & 0xff,
    (packed >>> 8) & 0xff,
    packed & 0xff,
  ]);
}

/**
 * The upstream init priming sequence, in order. Upstream notes that fetching
 * does not work (and the band drains its battery) without it.
 *
 * Deliberately omitted: the language write (`0x12/0x15`), the user-data write
 * (`0x12/0x04`) and the step-goal write (`0x12/0x03`). Those are device
 * settings with no read-back, so sending defaults would overwrite the user's
 * real profile and goal. None of them affects capture.
 */
export function buildInitPackets(now: Date): readonly Uint8Array[] {
  return [
    buildFrame(FITPRO_GROUP_GENERAL, FITPRO_CMD_INIT1, [0x02]),
    buildSetTimePacket(now),
    buildFrame(FITPRO_GROUP_REQUEST_DATA, FITPRO_CMD_INIT1),
    buildFrame(FITPRO_GROUP_REQUEST_DATA, FITPRO_CMD_INIT2),
    buildFrame(FITPRO_GROUP_GENERAL, FITPRO_CMD_INIT3, [0x01]),
    buildFrame(FITPRO_GROUP_REQUEST_DATA, 0x01),
    buildFrame(FITPRO_GROUP_REQUEST_DATA, 0x0f),
    buildFrame(FITPRO_GROUP_REQUEST_DATA, 0x10),
    buildFrame(FITPRO_GROUP_BAND_INFO, FITPRO_CMD_BAND_INFO),
  ];
}

// ---------------------------------------------------------------------------
// Date decoding
// ---------------------------------------------------------------------------

/**
 * Decodes the packed 2-byte date (`day = bits 0..4`, `month = bits 5..8`,
 * `year = bits 9..15 + 2000`). Returns null for impossible calendar fields.
 */
export function decodeFitProDate(bytes: Uint8Array, offset = 0): FitProDate | null {
  if (offset < 0 || offset + 2 > bytes.length) return null;
  const packed = (bytes[offset]! << 8) | bytes[offset + 1]!;
  const day = packed & 0x1f;
  const month = (packed >> 5) & 0x0f;
  const year = (packed >> 9) + 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** Local midnight of a decoded date, or null when the date does not exist. */
function localMidnight(date: FitProDate): number | null {
  const start = new Date(date.year, date.month - 1, date.day, 0, 0, 0, 0);
  if (Number.isNaN(start.getTime())) return null;
  if (start.getFullYear() !== date.year) return null;
  if (start.getMonth() !== date.month - 1 || start.getDate() !== date.day) return null;
  return start.getTime();
}

function readUint32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

// ---------------------------------------------------------------------------
// Step packets
// ---------------------------------------------------------------------------

/** One decoded step record, with the fields the record itself does not carry. */
export type FitProStepsBucket = Readonly<{
  record: FitProStepsInterval;
  /** Raw 15-minute-of-day field (`(data >> 21) & 0x7ff`). */
  timeUnits: number;
  /** Raw active-time field (`(data >> 48) & 0xf`), in 15-minute units. */
  durationUnits: number;
  distanceMeters: number;
  calories: number;
  /** `(data >> 19) & 1`; upstream stores it as the activity kind. */
  activityKind: number;
}>;

export type FitProStepsPacket = Readonly<{
  date: FitProDate;
  buckets: readonly FitProStepsBucket[];
}>;

/**
 * Parses a per-day step packet (`0x15/0x02`). All-zero records are padding and
 * are skipped; every other record becomes one 15-minute bucket starting at
 * `date + timeUnits * 15 min`.
 */
export function parseStepsPacket(payload: Uint8Array): FitProStepsPacket | null {
  if (payload.length < FITPRO_STEPS_RECORDS_OFFSET) return null;
  const date = decodeFitProDate(payload, 0);
  if (!date) return null;
  const dayStart = localMidnight(date);
  if (dayStart === null) return null;

  const buckets: FitProStepsBucket[] = [];
  for (
    let offset = FITPRO_STEPS_RECORDS_OFFSET;
    offset + FITPRO_STEPS_RECORD_BYTES <= payload.length;
    offset += FITPRO_STEPS_RECORD_BYTES
  ) {
    // The record is one big-endian 64-bit value; the two halves are read
    // separately so no BigInt is needed on the JS side.
    const high = readUint32be(payload, offset);
    const low = readUint32be(payload, offset + 4);
    const steps = (high >>> 20) & 0xfff;
    const durationUnits = (high >>> 16) & 0xf;
    const distanceMeters = high & 0xffff;
    const calories = low & 0x7ffff;
    const activityKind = (low >>> 19) & 0x1;
    const timeUnits = (low >>> 21) & 0x7ff;
    if (steps === 0 && durationUnits === 0 && distanceMeters === 0 && calories === 0) continue;
    const start = dayStart + timeUnits * FITPRO_STEPS_INTERVAL_MS;
    buckets.push({
      record: {
        type: "steps_interval",
        startTime: iso(start),
        endTime: iso(start + FITPRO_STEPS_INTERVAL_MS),
        count: steps,
      },
      timeUnits,
      durationUnits,
      distanceMeters,
      calories,
      activityKind,
    });
  }
  return { date, buckets };
}

// ---------------------------------------------------------------------------
// Sleep packets
// ---------------------------------------------------------------------------

/** One stage start as the band reports it, before session assembly. */
export type FitProSleepStageStart = Readonly<{
  stage: FitProStage;
  startTime: string;
}>;

export type FitProSleepPacket = Readonly<{
  date: FitProDate;
  starts: readonly FitProSleepStageStart[];
}>;

/**
 * Maps a raw stage kind. Upstream stores `kind + 10` and `FitProSampleProvider`
 * normalises 11 to deep and 12 to light, leaving everything else UNKNOWN; the
 * segmenter treats "not a sleep stage" as awake, so unknown kinds map to
 * `awake` here.
 */
function stageForKind(kind: number): FitProStage {
  if (kind === 1) return "deep";
  if (kind === 2) return "light";
  return "awake";
}

/**
 * Parses a per-day sleep packet (`0x15/0x03`). Each 4-byte record is a stage
 * start at `minutesOfDay` on the packet's date.
 *
 * Day shift: a night crosses midnight, so the records after the wrap have a
 * smaller `minutesOfDay` than the ones before it. Records are kept in packet
 * order and every time the clock goes backwards the offset advances by one day,
 * which keeps the night on a monotonic timeline. Records with an impossible
 * `minutesOfDay` (> 1439) are skipped.
 */
export function parseSleepPacket(payload: Uint8Array): FitProSleepPacket | null {
  if (payload.length < FITPRO_SLEEP_RECORDS_OFFSET) return null;
  const date = decodeFitProDate(payload, 0);
  if (!date) return null;
  const dayStart = localMidnight(date);
  if (dayStart === null) return null;

  const starts: FitProSleepStageStart[] = [];
  let dayShift = 0;
  let previousMinutes = -1;
  for (
    let offset = FITPRO_SLEEP_RECORDS_OFFSET;
    offset + FITPRO_SLEEP_RECORD_BYTES <= payload.length;
    offset += FITPRO_SLEEP_RECORD_BYTES
  ) {
    const data = readUint32be(payload, offset);
    const kind = data & 0xff;
    const minutesOfDay = (data >>> 16) & 0xffff;
    if (minutesOfDay >= DAY_MINUTES) continue;
    let absolute = minutesOfDay + dayShift * DAY_MINUTES;
    if (previousMinutes >= 0 && absolute < previousMinutes) {
      dayShift += 1;
      absolute = minutesOfDay + dayShift * DAY_MINUTES;
    }
    previousMinutes = absolute;
    starts.push({
      stage: stageForKind(kind),
      startTime: iso(dayStart + absolute * MINUTE_MS),
    });
  }
  return { date, starts };
}

type SleepInterval = { stage: FitProStage; startMs: number; endMs: number };

/**
 * Derives sleep sessions from ordered stage starts, mirroring upstream's
 * `SleepSessionSegmenter` over the samples `handleSleepData` writes.
 *
 * Each stage spans `[thisStart, nextStart)`; the last record has no following
 * start, so its interval is the fixed 15-minute window upstream marks for every
 * sleep record. A wake interval longer than 60 minutes closes the session, a
 * wake interval inside the session becomes an `awake` stage, and a wake before
 * the first sleep stage or after the last one only bounds the neighbouring
 * sleep interval. Sessions of 5 minutes or less are discarded.
 */
export function assembleSleepSessions(
  starts: readonly FitProSleepStageStart[],
): readonly FitProSleepSession[] {
  const ordered = [...starts]
    .map((start) => ({ stage: start.stage, startMs: Date.parse(start.startTime) }))
    .filter((start) => Number.isFinite(start.startMs))
    .sort((left, right) => left.startMs - right.startMs);

  const intervals: SleepInterval[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]!;
    const next = ordered[index + 1];
    const endMs = next ? next.startMs : current.startMs + FITPRO_STAGE_WINDOW_MS;
    if (endMs <= current.startMs) continue;
    const previous = intervals[intervals.length - 1];
    if (previous && previous.stage === current.stage && previous.endMs === current.startMs)
      previous.endMs = endMs;
    else intervals.push({ stage: current.stage, startMs: current.startMs, endMs });
  }

  let lastSleepIndex = -1;
  for (let index = 0; index < intervals.length; index += 1)
    if (intervals[index]!.stage !== "awake") lastSleepIndex = index;

  const sessions: FitProSleepSession[] = [];
  let stages: SleepInterval[] = [];
  let sessionStart: number | null = null;

  const addStage = (stage: FitProStage, startMs: number, endMs: number) => {
    const previous = stages[stages.length - 1];
    if (previous && previous.stage === stage && previous.endMs === startMs) previous.endMs = endMs;
    else stages.push({ stage, startMs, endMs });
  };

  const close = () => {
    if (sessionStart !== null && stages.length > 0) {
      const endMs = stages[stages.length - 1]!.endMs;
      if (endMs - sessionStart > FITPRO_MIN_SESSION_MS)
        sessions.push({
          type: "sleep_session",
          startTime: iso(sessionStart),
          endTime: iso(endMs),
          stages: stages.map((stage) => ({
            stage: stage.stage,
            startTime: iso(stage.startMs),
            endTime: iso(stage.endMs),
          })),
        });
    }
    stages = [];
    sessionStart = null;
  };

  for (let index = 0; index < intervals.length; index += 1) {
    const interval = intervals[index]!;
    if (interval.stage === "awake") {
      if (interval.endMs - interval.startMs > FITPRO_MAX_WAKE_PHASE_MS) {
        close();
        continue;
      }
      if (sessionStart === null || index > lastSleepIndex) continue;
      addStage("awake", interval.startMs, interval.endMs);
      continue;
    }
    if (sessionStart === null) sessionStart = interval.startMs;
    addStage(interval.stage, interval.startMs, interval.endMs);
  }
  close();

  return sessions;
}

/** Parses one sleep packet and assembles its sessions. */
export function parseSleepHistory(payload: Uint8Array): readonly FitProSleepSession[] {
  const packet = parseSleepPacket(payload);
  if (!packet) return [];
  return assembleSleepSessions(packet.starts);
}

// ---------------------------------------------------------------------------
// Heart rate
// ---------------------------------------------------------------------------

export type FitProHeartRatePacket = Readonly<{
  /** Seconds since local midnight, from the i32 at frame offset 12. */
  seconds: number;
  bpm: number;
  /** Local timestamp derived the way upstream `handleHR` does. */
  time: string;
}>;

/**
 * Parses a realtime heart-rate packet (`0x15/0x0e`).
 *
 * Frame offsets (payload offset = frame offset - 8): `seconds` is the i32 at
 * payload[4..7], `hr` is payload[11]. Upstream also reads `spo2` from
 * payload[5] — which is the second byte of `seconds`, so it is not a real
 * reading — and pressures from payload[9]/[10], whose meaning is unverified.
 * Those three are deliberately not returned.
 *
 * Returns null when the packet is too short, the seconds field is outside a
 * day, or the band reports a zero heart rate (upstream returns early too).
 */
export function parseHeartRatePacket(
  payload: Uint8Array,
  options: { reference?: Date } = {},
): FitProHeartRatePacket | null {
  if (payload.length < FITPRO_HEART_RATE_PAYLOAD_LENGTH) return null;
  const seconds = (payload[4]! << 24) | (payload[5]! << 16) | (payload[6]! << 8) | payload[7]!;
  const bpm = payload[11]!;
  if (seconds < 0 || seconds >= 24 * 60 * 60) return null;
  if (bpm <= 0) return null;
  const reference = options.reference ?? new Date();
  const midnight = new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate(),
    0,
    0,
    0,
    0,
  ).getTime();
  if (Number.isNaN(midnight)) return null;
  return { seconds, bpm, time: iso(midnight + seconds * 1000) };
}
