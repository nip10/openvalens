/**
 * Pure GloryFit protocol codecs and parsers.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2:
 * - `service/devices/gloryfit/GloryFitSupport.kt`
 * - `service/devices/gloryfit/GloryFitFetcher.kt`
 * - `devices/gloryfit/GloryFitSleepSessionProvider.kt`
 *
 * Framing
 * -------
 * There is no framing at all. The first byte of every payload is the command;
 * there is no length, header or checksum. Notifications are dispatched by
 * command byte on the command characteristic (`33f2`) and, for sleep stages, on
 * the bulk-data characteristic (`34f2`).
 *
 * Steps
 * -----
 * `0xB2` is both the request and the record command. A fetch starts with
 * `B2 FA`; the watch then sends 18-byte hourly records and closes with a
 * 3-byte `B2 FD xx` end marker. A record is:
 *
 *   byte 0      command (0xB2)
 *   bytes 1-2   year, big-endian uint16
 *   byte 3      month (1-12)
 *   byte 4      day (1-31)
 *   byte 5      hour (0-23)
 *   bytes 6-7   total steps that hour, big-endian uint16
 *   byte 8      running start
 *   byte 9      running end
 *   byte 10     unknown
 *   bytes 11-12 running steps, big-endian uint16
 *   byte 13     walking start
 *   byte 14     walking end
 *   byte 15     unknown
 *   bytes 16-17 walking steps, big-endian uint16
 *
 * Upstream stores `totalSteps` as the hourly value (it is not a running total
 * across hours), so the frozen `steps_interval` count is that field. The record
 * timestamp is the hour start; the interval end is one hour later.
 *
 * Heart rate
 * ----------
 * `0xF7` is both the request and the record command. A fetch starts with
 * `F7 FA`; the watch sends 18-byte records and closes with `F7 FD xx`. A record
 * is:
 *
 *   byte 0      command (0xF7)
 *   byte 1      fetch-data marker (0x07 — also the high byte of the year)
 *   bytes 2-3   year, big-endian uint16
 *   byte 4      month
 *   byte 5      day
 *   byte 6      hour
 *   bytes 7-17  twelve heart-rate values, one per 10-minute block
 *
 * The twelve values end at the record hour: upstream starts the cursor at
 * `hour − 10 * 12 + 10` minutes and advances 10 minutes per value. `0x00` and
 * `0xFF` values are skipped.
 *
 * Sleep
 * -----
 * Two phases. `31 01` asks for a sleep session; the watch answers `31 01
 * <year:uint16 BE> <month> <day> <stageCount>` on the command characteristic.
 * The stage records then arrive on the bulk-data characteristic as `32`
 * payloads whose remaining bytes are 6-byte records:
 *
 *   byte 0      hour
 *   byte 1      minute
 *   byte 2      stage (1 deep, 2 light, 3 awake, 4 rem, other unknown)
 *   byte 3      unknown
 *   bytes 4-5   duration in minutes, big-endian uint16
 *
 * Upstream starts each record at the session date's midnight. An hour greater
 * than 12 is treated as the previous evening until a record at or before noon
 * is seen, after which the flag stays set for the rest of the session. The
 * session closes with `31 02`. Stage samples are grouped into sessions exactly
 * like `SleepSessionProvider.groupIntoSessions`: a gap starts a new session,
 * adjacent equal stages merge, and unknown stages are dropped.
 *
 * Timestamps
 * ----------
 * All timestamps are device-local wall-clock values with no timezone. They are
 * interpreted with the phone's timezone offset at that instant, exactly like
 * the existing GATT and ring parsers: a local `Date` is constructed and
 * converted with `.toISOString()`.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { GloryFitRecordType } from "../models/gloryfit";

/** Sleep stage labels, mapped from the upstream stage type bytes. */
export type GloryFitStage = "awake" | "light" | "deep" | "rem";

/** One hourly activity bucket. */
export type GloryFitStepsInterval = Readonly<{
  type: "steps_interval";
  startTime: string;
  endTime: string;
  count: number;
}>;

export type GloryFitHeartRateSample = Readonly<{
  type: "heart_rate";
  time: string;
  bpm: number;
}>;

export type GloryFitSleepStageInterval = Readonly<{
  stage: GloryFitStage;
  startTime: string;
  endTime: string;
}>;

export type GloryFitSleepSession = Readonly<{
  type: "sleep_session";
  startTime: string;
  endTime: string;
  stages?: readonly GloryFitSleepStageInterval[];
}>;

/** Any record a GloryFit session can emit. */
export type GloryFitRecord = GloryFitStepsInterval | GloryFitHeartRateSample | GloryFitSleepSession;

/** Battery state from the `A2` response. */
export type GloryFitBatteryState = Readonly<{ percent: number; charging: boolean }>;

/** Failure kinds reported by the transport. */
export type GloryFitFailure = GloryFitRecordType | "init";

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Upstream requests this MTU at init (`GloryFitSupport.initializeDevice`). */
export const GLORYFIT_MTU_REQUEST = 247;

export const GLORYFIT_CMD_VERSION = 0xa1;
export const GLORYFIT_CMD_BATTERY = 0xa2;
export const GLORYFIT_CMD_STEPS = 0xb2;
export const GLORYFIT_CMD_HEART_RATE = 0xf7;
export const GLORYFIT_CMD_SLEEP_INFO = 0x31;
export const GLORYFIT_CMD_SLEEP_STAGES = 0x32;

export const GLORYFIT_FETCH_START = 0xfa;
export const GLORYFIT_FETCH_DATA = 0x07;
export const GLORYFIT_FETCH_END = 0xfd;

export const GLORYFIT_SLEEP_INFO_DATE = 0x01;
export const GLORYFIT_SLEEP_INFO_END = 0x02;

/** Steps records are one hour wide. */
export const GLORYFIT_STEPS_INTERVAL_MS = 60 * 60_000;
/** Heart-rate records carry twelve 10-minute blocks. */
export const GLORYFIT_HEART_RATE_INTERVAL_MS = 10 * 60_000;
/** Steps and heart-rate records are 18 bytes. */
export const GLORYFIT_RECORD_LENGTH = 18;
/** Sleep stage records are 6 bytes after the command byte. */
export const GLORYFIT_SLEEP_STAGE_RECORD_LENGTH = 6;

/** Upstream stage type bytes (`GloryFitSleepSessionProvider`). */
const STAGE_BY_TYPE: Readonly<Record<number, GloryFitStage>> = {
  0x01: "deep",
  0x02: "light",
  0x03: "awake",
  0x04: "rem",
};

/** `A1`: firmware version request. */
export function buildVersionCommand(): Uint8Array {
  return Uint8Array.of(GLORYFIT_CMD_VERSION);
}

/** `A2`: battery request. */
export function buildBatteryCommand(): Uint8Array {
  return Uint8Array.of(GLORYFIT_CMD_BATTERY);
}

/** `B2 FA`: start the hourly steps fetch. */
export function buildStepsFetchCommand(): Uint8Array {
  return Uint8Array.of(GLORYFIT_CMD_STEPS, GLORYFIT_FETCH_START);
}

/** `F7 FA`: start the heart-rate fetch. */
export function buildHeartRateFetchCommand(): Uint8Array {
  return Uint8Array.of(GLORYFIT_CMD_HEART_RATE, GLORYFIT_FETCH_START);
}

/** `31 01`: start the sleep-session fetch (date + stage count). */
export function buildSleepFetchCommand(): Uint8Array {
  return Uint8Array.of(GLORYFIT_CMD_SLEEP_INFO, GLORYFIT_SLEEP_INFO_DATE);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uint16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0;
}

/** Reads a big-endian year, month and day triple into a validated local midnight. */
function readDate(bytes: Uint8Array, offset: number): Date | null {
  if (offset + 3 >= bytes.length) return null;
  const year = uint16be(bytes, offset);
  const month = bytes[offset + 2]!;
  const day = bytes[offset + 3]!;
  if (year < 1970 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
    return null;
  return date;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parses one 18-byte hourly steps record (`B2`). Returns null when the payload
 * is not a well-formed record. `count` is the hourly total-steps field.
 */
export function parseGloryFitStepsRecord(bytes: Uint8Array): GloryFitStepsInterval | null {
  if (bytes.length !== GLORYFIT_RECORD_LENGTH || bytes[0] !== GLORYFIT_CMD_STEPS) return null;
  const date = readDate(bytes, 1);
  if (!date) return null;
  const hour = bytes[5]!;
  if (hour > 23) return null;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0, 0, 0);
  if (Number.isNaN(start.getTime())) return null;
  return {
    type: "steps_interval",
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + GLORYFIT_STEPS_INTERVAL_MS).toISOString(),
    count: uint16be(bytes, 6),
  };
}

/**
 * Parses one 18-byte heart-rate record (`F7 07 …`). Returns the twelve
 * 10-minute samples, skipping `0x00` and `0xFF` placeholders. A malformed
 * record yields an empty array.
 */
export function parseGloryFitHeartRateRecord(
  bytes: Uint8Array,
): readonly GloryFitHeartRateSample[] {
  if (bytes.length !== GLORYFIT_RECORD_LENGTH) return [];
  if (bytes[0] !== GLORYFIT_CMD_HEART_RATE || bytes[1] !== GLORYFIT_FETCH_DATA) return [];
  const date = readDate(bytes, 1);
  if (!date) return [];
  const hour = bytes[5]!;
  if (hour > 23) return [];
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0, 0, 0);
  if (Number.isNaN(start.getTime())) return [];

  // Upstream reads the hour after the command byte and the four date bytes, so
  // the twelve values start at offset 6 and end at the record hour.
  const valueOffset = 6;
  const remaining = bytes.length - valueOffset;
  let cursor =
    start.getTime() - remaining * GLORYFIT_HEART_RATE_INTERVAL_MS + GLORYFIT_HEART_RATE_INTERVAL_MS;
  const samples: GloryFitHeartRateSample[] = [];
  for (let index = valueOffset; index < bytes.length; index += 1) {
    const bpm = bytes[index]!;
    const time = cursor;
    cursor += GLORYFIT_HEART_RATE_INTERVAL_MS;
    if (bpm === 0x00 || bpm === 0xff) continue;
    samples.push({ type: "heart_rate", time: new Date(time).toISOString(), bpm });
  }
  return samples;
}

/** Parses the `A2 <percent> <charging>` battery response. */
export function parseGloryFitBatteryResponse(bytes: Uint8Array): GloryFitBatteryState | null {
  if (bytes.length < 2 || bytes[0] !== GLORYFIT_CMD_BATTERY) return null;
  const percent = bytes[1]!;
  if (percent > 100) return null;
  return { percent, charging: bytes[2] === 0x01 };
}

export type GloryFitSleepInfo =
  | Readonly<{ kind: "date"; date: Date; stageCount: number }>
  | Readonly<{ kind: "end" }>;

/**
 * Parses a `31` sleep-info payload: either the session date (`31 01 …`) or the
 * end marker (`31 02`).
 */
export function parseGloryFitSleepInfo(bytes: Uint8Array): GloryFitSleepInfo | null {
  if (bytes.length < 2 || bytes[0] !== GLORYFIT_CMD_SLEEP_INFO) return null;
  if (bytes[1] === GLORYFIT_SLEEP_INFO_END) return { kind: "end" };
  if (bytes[1] !== GLORYFIT_SLEEP_INFO_DATE) return null;
  if (bytes.length < 7) return null;
  const date = readDate(bytes, 2);
  if (!date) return null;
  return { kind: "date", date, stageCount: bytes[6]! };
}

/** One parsed sleep stage sample, before grouping into sessions. */
export type GloryFitSleepStageSample = Readonly<{
  stage: GloryFitStage;
  /** Local epoch milliseconds of the stage start. */
  startTime: number;
  durationMinutes: number;
}>;

export type GloryFitSleepStagesResult = Readonly<{
  samples: readonly GloryFitSleepStageSample[];
  /** Whether the after-midnight flag has been set (callers must carry it). */
  afterMidnight: boolean;
}>;

/**
 * Parses one `32` sleep-stages payload. `sessionDate` is the date from the
 * preceding `31 01` message, and `afterMidnight` is the flag carried from the
 * previous payload. Returns null when the payload is not a valid stages frame.
 */
export function parseGloryFitSleepStages(
  bytes: Uint8Array,
  sessionDate: Date,
  afterMidnight: boolean,
): GloryFitSleepStagesResult | null {
  if (bytes.length < 1 || bytes[0] !== GLORYFIT_CMD_SLEEP_STAGES) return null;
  if ((bytes.length - 1) % GLORYFIT_SLEEP_STAGE_RECORD_LENGTH !== 0) return null;

  let flag = afterMidnight;
  const samples: GloryFitSleepStageSample[] = [];
  for (let offset = 1; offset < bytes.length; offset += GLORYFIT_SLEEP_STAGE_RECORD_LENGTH) {
    const hour = bytes[offset]!;
    const minute = bytes[offset + 1]!;
    const stage = bytes[offset + 2]!;
    const duration = uint16be(bytes, offset + 4);
    if (hour > 23 || minute > 59) continue;

    const timestamp = new Date(
      sessionDate.getFullYear(),
      sessionDate.getMonth(),
      sessionDate.getDate(),
      0,
      0,
      0,
      0,
    );
    if (hour > 12) {
      // Assume times after noon belong to the previous day, unless a
      // before-noon record has already established that we crossed midnight.
      if (!flag) timestamp.setDate(timestamp.getDate() - 1);
    } else {
      flag = true;
    }
    timestamp.setHours(hour, minute, 0, 0);

    const mapped = STAGE_BY_TYPE[stage];
    if (!mapped || duration <= 0) continue;
    samples.push({ stage: mapped, startTime: timestamp.getTime(), durationMinutes: duration });
  }
  return { samples, afterMidnight: flag };
}

/**
 * Groups stage samples into sessions, mirroring upstream
 * `SleepSessionProvider.groupIntoSessions`: a gap between stages starts a new
 * session, adjacent equal stages merge, and overlapping stages are clipped.
 */
export function groupGloryFitSleepStages(
  samples: readonly GloryFitSleepStageSample[],
): readonly GloryFitSleepSession[] {
  type WorkingStage = { stage: GloryFitStage; startTime: number; endTime: number };
  type WorkingSession = { stages: WorkingStage[] };
  const sessions: WorkingSession[] = [];
  let current: WorkingSession | null = null;

  for (const sample of [...samples].sort((left, right) => left.startTime - right.startTime)) {
    const end = sample.startTime + sample.durationMinutes * 60_000;
    const lastEnd = current?.stages[current.stages.length - 1]?.endTime ?? null;
    if (lastEnd !== null && sample.startTime > lastEnd) {
      sessions.push(current!);
      current = null;
    }
    const previousEnd = current?.stages[current.stages.length - 1]?.endTime ?? null;
    const start = previousEnd !== null ? Math.max(sample.startTime, previousEnd) : sample.startTime;
    if (start >= end) continue;
    if (!current) current = { stages: [] };
    const last = current.stages[current.stages.length - 1];
    if (last && last.stage === sample.stage && last.endTime === start) {
      last.endTime = end;
    } else {
      current.stages.push({ stage: sample.stage, startTime: start, endTime: end });
    }
  }
  if (current) sessions.push(current);

  return sessions
    .filter((session) => session.stages.length > 0)
    .map((session) => {
      const stages: GloryFitSleepStageInterval[] = session.stages.map((stage) => ({
        stage: stage.stage,
        startTime: new Date(stage.startTime).toISOString(),
        endTime: new Date(stage.endTime).toISOString(),
      }));
      return {
        type: "sleep_session",
        startTime: stages[0]!.startTime,
        endTime: stages[stages.length - 1]!.endTime,
        ...(stages.length ? { stages } : {}),
      };
    });
}

export type GloryFitSleepAccumulator = Readonly<{
  /** Starts a session from a `31 01` date message. */
  begin(date: Date): void;
  /** Parses a `32` stages payload and appends its samples. */
  pushStages(bytes: Uint8Array): readonly GloryFitSleepStageSample[];
  /** Ends the session and returns the grouped sleep sessions. */
  end(): readonly GloryFitSleepSession[];
  /** Drops any in-progress session. */
  reset(): void;
}>;

/**
 * Stateful sleep accumulator for the two-phase `31`/`32` flow. The date and
 * after-midnight flag persist across stage payloads, exactly like upstream's
 * `mCurrentSleepSession`/`mCurrentSessionAfterMidnight`.
 */
export function createGloryFitSleepAccumulator(): GloryFitSleepAccumulator {
  let sessionDate: Date | null = null;
  let afterMidnight = false;
  let samples: GloryFitSleepStageSample[] = [];

  return {
    begin(date) {
      sessionDate = date;
      afterMidnight = false;
      samples = [];
    },
    pushStages(bytes) {
      if (!sessionDate) return [];
      const result = parseGloryFitSleepStages(bytes, sessionDate, afterMidnight);
      if (!result) return [];
      afterMidnight = result.afterMidnight;
      samples.push(...result.samples);
      return result.samples;
    },
    end() {
      const grouped = groupGloryFitSleepStages(samples);
      sessionDate = null;
      afterMidnight = false;
      samples = [];
      return grouped;
    },
    reset() {
      sessionDate = null;
      afterMidnight = false;
      samples = [];
    },
  };
}
