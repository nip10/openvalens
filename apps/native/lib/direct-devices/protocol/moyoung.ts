/**
 * Pure Moyoung / Da Fit protocol codecs and parsers.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2:
 * - `devices/moyoung/MoyoungConstants.java`
 * - `service/devices/moyoung/MoyoungPacketIn.java`
 * - `service/devices/moyoung/MoyoungPacketOut.java`
 * - `service/devices/moyoung/FetchDataOperation.java`
 * - `service/devices/moyoung/MoyoungDeviceSupport.java`
 *
 * Framing
 * -------
 * `FE EA <sizeHi> <sizeLo> <command> <payload…>`. The size bytes encode the
 * total packet length (header included). In legacy mode (`mtu == 20`) `sizeHi`
 * is the constant 16; otherwise it is `32 + (length >> 8)`. Parsing treats a
 * `sizeHi` of 16 as legacy and any other value below 32 as corruption. Packets
 * larger than one write are fragmented at the MTU and reassembled by
 * `createMoyoungReassembler`.
 *
 * Commands used here
 * ------------------
 * - 49 sync time: `{time:uint32 BE, 0x08}`. `time` is epoch seconds of the
 *   phone's *wall clock* interpreted as GMT+8. The watch is hardcoded to GMT+8
 *   internally; upstream writes 0x08 as a timezone byte even though changing it
 *   has no effect. This is a watch-clock quirk, not a phone setting.
 * - 50 today's sleep: `{}` → repeating `{type, start_h, start_m}`.
 * - 51 past sleep/step: `{arg}`; args 3/4 are yesterday / day-before sleep and
 *   answer with the same `{type, start_h, start_m}` records. Args 1/2 are daily
 *   step totals and are deliberately not requested.
 * - 53 two-day heart rate, one sample per 5 minutes: `{index}` → `{index,
 *   bpm[72]}`; index 0..3 is today (6 h per packet), 4..7 is yesterday.
 * - 54 today's heart rate, one sample per minute: `{index}` → `{index, bpm[72]}`,
 *   20 packets cover 1440 minutes.
 *
 * Sleep semantics
 * ---------------
 * A stage record marks the *start* of a stage; the stage ends where the next
 * record starts. A record with `start_h >= 20` belongs to the previous calendar
 * day (evening sleep). Sessions are derived the way upstream's
 * `SleepSessionSegmenter` derives them from the minute samples that
 * `MoyoungActivitySampleProvider.overlaySleep` writes: a wake run longer than
 * 60 minutes closes the session, a shorter wake becomes an `awake` stage inside
 * it, and a session shorter than 5 minutes is discarded. The final record of a
 * payload is the wake that closes the last stage, so it contributes no stage of
 * its own.
 *
 * Timestamps are device-local wall-clock values with no timezone, interpreted
 * with the phone's timezone offset at that instant (a local `Date` is built and
 * serialised with `.toISOString()`), matching the other direct-device parsers.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { MoyoungRecordType } from "../models/moyoung";

/** Sleep stage labels, mapped from the upstream stage type bytes. */
export type MoyoungStage = "awake" | "light" | "deep" | "rem";

export type MoyoungSleepStage = Readonly<{
  stage: MoyoungStage;
  startTime: string;
  endTime: string;
}>;

export type MoyoungSleepSession = Readonly<{
  type: "sleep_session";
  startTime: string;
  endTime: string;
  stages?: readonly MoyoungSleepStage[];
}>;

export type MoyoungHeartRateSample = Readonly<{
  type: "heart_rate";
  time: string;
  bpm: number;
}>;

/** Any record a Moyoung session can emit. */
export type MoyoungRecord = MoyoungSleepSession | MoyoungHeartRateSample;

/** Failure kinds reported by the transport. */
export type MoyoungFailure = MoyoungRecordType | "init";

/** A parsed packet: command byte and payload. */
export type MoyoungPacket = Readonly<{ command: number; payload: Uint8Array }>;

/** One stage start as the watch reports it, before session assembly. */
export type MoyoungSleepStageStart = Readonly<{
  stage: MoyoungStage;
  startTime: string;
}>;

export const MOYOUNG_HEADER_FIRST = 0xfe;
export const MOYOUNG_HEADER_SECOND = 0xea;
export const MOYOUNG_LEGACY_MTU = 20;
export const MOYOUNG_LEGACY_SIZE_HIGH = 16;
export const MOYOUNG_MTU_SIZE_BASE = 32;
export const MOYOUNG_HEADER_LENGTH = 5;

/** Command bytes (MoyoungConstants). */
export const MOYOUNG_CMD_SYNC_TIME = 49;
export const MOYOUNG_CMD_SYNC_SLEEP = 50;
export const MOYOUNG_CMD_SYNC_PAST_SLEEP_AND_STEP = 51;
export const MOYOUNG_CMD_QUERY_PAST_HEART_RATE_5MIN = 53;
export const MOYOUNG_CMD_QUERY_PAST_HEART_RATE_1MIN = 54;

/** CMD 51 argument bytes. Only the sleep arguments are used. */
export const MOYOUNG_ARG_YESTERDAY_STEPS = 1;
export const MOYOUNG_ARG_DAY_BEFORE_YESTERDAY_STEPS = 2;
export const MOYOUNG_ARG_YESTERDAY_SLEEP = 3;
export const MOYOUNG_ARG_DAY_BEFORE_YESTERDAY_SLEEP = 4;

/** CMD 53: 8 packets of 6 hours each, one sample per 5 minutes. */
export const MOYOUNG_HR_5MIN_PACKET_COUNT = 8;
export const MOYOUNG_HR_5MIN_SAMPLES_PER_PACKET = 72;
/** CMD 54: 20 packets of 72 minutes, one sample per minute. */
export const MOYOUNG_HR_1MIN_PACKET_COUNT = 20;
export const MOYOUNG_HR_1MIN_SAMPLES_PER_PACKET = 72;

/** Upstream `HeartRateUtils` defaults: values outside this range are gaps. */
export const MOYOUNG_MIN_HEART_RATE = 10;
export const MOYOUNG_MAX_HEART_RATE = 250;

/** Upstream `SleepSessionSegmenter` bounds. */
export const MOYOUNG_MIN_SESSION_MS = 5 * 60_000;
export const MOYOUNG_MAX_WAKE_PHASE_MS = 60 * 60_000;

/** Upstream stage type bytes (`MoyoungConstants.SLEEP_*`). */
const STAGE_BY_TYPE: Readonly<Record<number, MoyoungStage>> = {
  0: "awake",
  1: "light",
  2: "deep",
  3: "rem",
};

/** Seconds between the GMT+8 watch clock and UTC. */
const WATCH_TIMEZONE_OFFSET_SECONDS = 8 * 60 * 60;

function iso(millis: number): string {
  return new Date(millis).toISOString();
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

/**
 * Builds a packet. `mtu` selects the framing mode, exactly like upstream's
 * `buildPacket(int mtu, …)`: 20 is legacy (`sizeHi = 16`), anything else uses
 * `sizeHi = 32 + (length >> 8)`.
 */
export function buildPacket(
  mtu: number,
  command: number,
  payload: Uint8Array | readonly number[] = [],
): Uint8Array {
  const bytes = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
  const length = bytes.length + MOYOUNG_HEADER_LENGTH;
  const packet = new Uint8Array(length);
  packet[0] = MOYOUNG_HEADER_FIRST;
  packet[1] = MOYOUNG_HEADER_SECOND;
  packet[2] =
    mtu === MOYOUNG_LEGACY_MTU
      ? MOYOUNG_LEGACY_SIZE_HIGH
      : (MOYOUNG_MTU_SIZE_BASE + (length >> 8)) & 0xff;
  packet[3] = length & 0xff;
  packet[4] = command & 0xff;
  packet.set(bytes, MOYOUNG_HEADER_LENGTH);
  return packet;
}

/**
 * Reads the announced packet length from a complete packet or its first
 * fragment. Returns null for a bad header or an unparsable size byte.
 */
export function parsePacketLength(bytes: Uint8Array): number | null {
  if (bytes.length < 4) return null;
  if (bytes[0] !== MOYOUNG_HEADER_FIRST || bytes[1] !== MOYOUNG_HEADER_SECOND) return null;
  let high = 0;
  if (bytes[2] !== MOYOUNG_LEGACY_SIZE_HIGH) {
    if (bytes[2]! < MOYOUNG_MTU_SIZE_BASE) return null;
    high = bytes[2]! - MOYOUNG_MTU_SIZE_BASE;
  }
  return (high << 8) | bytes[3]!;
}

/** Parses a complete packet into its command byte and payload. */
export function parsePacket(packet: Uint8Array): MoyoungPacket | null {
  const length = parsePacketLength(packet);
  if (length === null || length !== packet.length || length < MOYOUNG_HEADER_LENGTH) return null;
  return {
    command: packet[4]!,
    payload: packet.slice(MOYOUNG_HEADER_LENGTH),
  };
}

/** Splits an outgoing packet into MTU-sized writes. */
export function fragmentPacket(packet: Uint8Array, mtu: number): Uint8Array[] {
  if (!Number.isInteger(mtu) || mtu <= 0) throw new RangeError("MOYOUNG_INVALID_MTU");
  const fragments: Uint8Array[] = [];
  for (let offset = 0; offset < packet.length; offset += mtu)
    fragments.push(packet.slice(offset, offset + mtu));
  return fragments;
}

export type MoyoungReassembler = Readonly<{
  /** Stores one notification; returns the packet once it is complete. */
  push(fragment: Uint8Array): MoyoungPacket | null;
}>;

/**
 * Reassembles notifications into packets. Upstream keeps one `MoyoungPacketIn`
 * per connection and resets it after each complete packet; this does the same.
 * The cursor advances by the fragment length, as upstream does, so a fragment
 * longer than the remaining bytes is truncated to the announced length.
 */
export function createMoyoungReassembler(): MoyoungReassembler {
  let buffer: Uint8Array | null = null;
  let position = 0;
  return {
    push(fragment) {
      if (!buffer) {
        const length = parsePacketLength(fragment);
        if (length === null || length < MOYOUNG_HEADER_LENGTH) return null;
        buffer = new Uint8Array(length);
        position = 0;
      }
      const toCopy = Math.min(fragment.length, buffer.length - position);
      buffer.set(fragment.subarray(0, toCopy), position);
      position += fragment.length;
      if (position < buffer.length) return null;
      const packet = buffer;
      buffer = null;
      position = 0;
      return parsePacket(packet);
    },
  };
}

// ---------------------------------------------------------------------------
// Command builders
// ---------------------------------------------------------------------------

/**
 * Converts a phone-local instant to the watch's GMT+8 wall-clock epoch seconds.
 * Upstream formats the local wall clock and parses it as GMT+8, which is the
 * same as taking the local calendar fields as if they were GMT+8.
 */
export function localTimeToWatchTime(now: Date): number {
  const wallClockMillis = Date.UTC(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
  );
  return Math.floor(wallClockMillis / 1000) - WATCH_TIMEZONE_OFFSET_SECONDS;
}

/** CMD 49: `{time:uint32 BE, 0x08}`. */
export function buildSyncTimePacket(mtu: number, now: Date): Uint8Array {
  const time = localTimeToWatchTime(now) >>> 0;
  return buildPacket(mtu, MOYOUNG_CMD_SYNC_TIME, [
    (time >>> 24) & 0xff,
    (time >>> 16) & 0xff,
    (time >>> 8) & 0xff,
    time & 0xff,
    0x08,
  ]);
}

/** CMD 50: today's sleep stages. */
export function buildSleepTodayPacket(mtu: number): Uint8Array {
  return buildPacket(mtu, MOYOUNG_CMD_SYNC_SLEEP);
}

/** CMD 51: past sleep, arg 3 (yesterday) or 4 (day before). */
export function buildPastSleepPacket(mtu: number, arg: number): Uint8Array {
  if (arg !== MOYOUNG_ARG_YESTERDAY_SLEEP && arg !== MOYOUNG_ARG_DAY_BEFORE_YESTERDAY_SLEEP)
    throw new RangeError("MOYOUNG_INVALID_SLEEP_ARG");
  return buildPacket(mtu, MOYOUNG_CMD_SYNC_PAST_SLEEP_AND_STEP, [arg]);
}

/** CMD 53: two-day heart-rate history packet `index` (0..7). */
export function buildHeartRateHistoryPacket(mtu: number, index: number): Uint8Array {
  return buildPacket(mtu, MOYOUNG_CMD_QUERY_PAST_HEART_RATE_5MIN, [index & 0xff]);
}

/** CMD 54: today's one-minute heart-rate history packet `index` (0..19). */
export function buildTodayHeartRatePacket(mtu: number, index: number): Uint8Array {
  return buildPacket(mtu, MOYOUNG_CMD_QUERY_PAST_HEART_RATE_1MIN, [index & 0xff]);
}

// ---------------------------------------------------------------------------
// Sleep parsing
// ---------------------------------------------------------------------------

/**
 * Upstream's `daysAgoOffset` in `FetchDataOperation`: at or after 20:00 the
 * watch already treats the current night as "yesterday", so the labelled sleep
 * blocks shift one day closer.
 */
export function sleepDaysAgoOffset(reference: Date): 0 | 1 {
  return reference.getHours() + 4 >= 24 ? 1 : 0;
}

/**
 * Parses a sleep payload (`{type, start_h, start_m}` repeating) into stage
 * starts. Records with `start_h >= 20` are shifted back one day. Unknown stage
 * types and out-of-range clock fields are skipped rather than persisted as
 * garbage activity.
 */
export function parseSleepStages(
  payload: Uint8Array,
  options: { daysAgo: number; reference?: Date },
): readonly MoyoungSleepStageStart[] {
  if (payload.length % 3 !== 0) return [];
  const reference = options.reference ?? new Date();
  const stages: MoyoungSleepStageStart[] = [];
  for (let offset = 0; offset < payload.length; offset += 3) {
    const stage = STAGE_BY_TYPE[payload[offset]!];
    const hour = payload[offset + 1]!;
    const minute = payload[offset + 2]!;
    if (!stage || hour > 23 || minute > 59) continue;
    let start = new Date(
      reference.getFullYear(),
      reference.getMonth(),
      reference.getDate() - options.daysAgo,
      hour,
      minute,
      0,
      0,
    );
    if (hour >= 20) start = new Date(start.getTime() - 24 * 60 * 60_000);
    stages.push({ stage, startTime: start.toISOString() });
  }
  return stages;
}

type SleepInterval = { stage: MoyoungStage; startMs: number; endMs: number };

/**
 * Derives sleep sessions from ordered stage starts, mirroring upstream's
 * `SleepSessionSegmenter` over the minute samples `overlaySleep` produces.
 *
 * Each stage spans `[thisStart, nextStart)`. A wake run longer than 60 minutes
 * closes the session; a shorter one becomes an `awake` stage inside it. The
 * final record has no following start, so it contributes no interval — the
 * watch sends a trailing wake record to close the night. Sessions of 5 minutes
 * or less are discarded.
 */
export function assembleSleepSessions(
  starts: readonly MoyoungSleepStageStart[],
): readonly MoyoungSleepSession[] {
  const ordered = [...starts]
    .map((start) => ({ stage: start.stage, startMs: Date.parse(start.startTime) }))
    .filter((start) => Number.isFinite(start.startMs))
    .sort((left, right) => left.startMs - right.startMs);

  const intervals: SleepInterval[] = [];
  for (let index = 0; index + 1 < ordered.length; index += 1) {
    const current = ordered[index]!;
    const next = ordered[index + 1]!;
    if (next.startMs <= current.startMs) continue;
    const previous = intervals[intervals.length - 1];
    if (previous && previous.stage === current.stage && previous.endMs === current.startMs)
      previous.endMs = next.startMs;
    else intervals.push({ stage: current.stage, startMs: current.startMs, endMs: next.startMs });
  }

  let lastSleepIndex = -1;
  for (let index = 0; index < intervals.length; index += 1)
    if (intervals[index]!.stage !== "awake") lastSleepIndex = index;

  const sessions: MoyoungSleepSession[] = [];
  let stages: SleepInterval[] = [];
  let sessionStart: number | null = null;

  const addStage = (stage: MoyoungStage, startMs: number, endMs: number) => {
    const previous = stages[stages.length - 1];
    if (previous && previous.stage === stage && previous.endMs === startMs) previous.endMs = endMs;
    else stages.push({ stage, startMs, endMs });
  };

  const close = () => {
    if (sessionStart !== null && stages.length > 0) {
      const endMs = stages[stages.length - 1]!.endMs;
      if (endMs - sessionStart > MOYOUNG_MIN_SESSION_MS)
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
      if (interval.endMs - interval.startMs > MOYOUNG_MAX_WAKE_PHASE_MS) {
        close();
        continue;
      }
      // A wake before the first sleep stage or after the last one is outside
      // the session; it only bounds the neighbouring sleep interval.
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

/** Parses one sleep payload and assembles its sessions. */
export function parseSleepHistory(
  payload: Uint8Array,
  options: { daysAgo: number; reference?: Date },
): readonly MoyoungSleepSession[] {
  return assembleSleepSessions(parseSleepStages(payload, options));
}

// ---------------------------------------------------------------------------
// Heart-rate history
// ---------------------------------------------------------------------------

function isValidHeartRate(value: number): boolean {
  return value >= MOYOUNG_MIN_HEART_RATE && value <= MOYOUNG_MAX_HEART_RATE;
}

export type MoyoungHeartRateHistoryPacket = Readonly<{
  packetIndex: number;
  daysAgo: number;
  startHour: number;
  samples: readonly MoyoungHeartRateSample[];
}>;

/**
 * Parses a CMD 53 packet: `{index, bpm[72]}`. Packet `index` covers six hours
 * starting at `(index % 4) * 6` on the day `index / 4` days ago, sampled every
 * five minutes. Zero/invalid values and future timestamps are skipped, but the
 * five-minute cursor advances for every slot either way.
 */
export function parseHeartRateHistoryPacket(
  payload: Uint8Array,
  options: { reference?: Date; now?: Date } = {},
): MoyoungHeartRateHistoryPacket | null {
  if (payload.length < 1) return null;
  const packetIndex = payload[0]!;
  const daysAgo = Math.floor(packetIndex / 4);
  const startHour = (packetIndex % 4) * 6;
  const reference = options.reference ?? options.now ?? new Date();
  const limit = (options.now ?? reference).getTime();
  const samples: MoyoungHeartRateSample[] = [];

  const available = Math.min(payload.length - 1, MOYOUNG_HR_5MIN_SAMPLES_PER_PACKET);
  for (let index = 0; index < available; index += 1) {
    const hour = startHour + Math.floor(index / 12);
    const minute = (index % 12) * 5;
    const time = new Date(
      reference.getFullYear(),
      reference.getMonth(),
      reference.getDate() - daysAgo,
      hour,
      minute,
      0,
      0,
    ).getTime();
    const bpm = payload[index + 1]!;
    if (!isValidHeartRate(bpm) || time >= limit) continue;
    samples.push({ type: "heart_rate", time: iso(time), bpm });
  }

  return { packetIndex, daysAgo, startHour, samples };
}

export type MoyoungTodayHeartRatePacket = Readonly<{
  packetIndex: number;
  samples: readonly MoyoungHeartRateSample[];
}>;

/**
 * Parses a CMD 54 packet: `{index, bpm[72]}`. Packet `index` covers minutes
 * `index * 72 … index * 72 + 71` of today, one sample per minute.
 */
export function parseTodayHeartRatePacket(
  payload: Uint8Array,
  options: { reference?: Date; now?: Date } = {},
): MoyoungTodayHeartRatePacket | null {
  if (payload.length < 1) return null;
  const packetIndex = payload[0]!;
  const reference = options.reference ?? options.now ?? new Date();
  const limit = (options.now ?? reference).getTime();
  const samples: MoyoungHeartRateSample[] = [];

  const available = Math.min(payload.length - 1, MOYOUNG_HR_1MIN_SAMPLES_PER_PACKET);
  for (let index = 0; index < available; index += 1) {
    const minuteOfDay = packetIndex * MOYOUNG_HR_1MIN_SAMPLES_PER_PACKET + index;
    if (minuteOfDay >= 24 * 60) break;
    const time = new Date(
      reference.getFullYear(),
      reference.getMonth(),
      reference.getDate(),
      Math.floor(minuteOfDay / 60),
      minuteOfDay % 60,
      0,
      0,
    ).getTime();
    const bpm = payload[index + 1]!;
    if (!isValidHeartRate(bpm) || time >= limit) continue;
    samples.push({ type: "heart_rate", time: iso(time), bpm });
  }

  return { packetIndex, samples };
}
