/**
 * Pure Colmi / Yawell smart-ring protocol codecs and parsers.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2:
 * - `service/devices/yawell/ring/YawellRingDeviceSupport.java`
 * - `service/devices/yawell/ring/YawellRingConstants.java`
 *
 * Normal commands
 * ---------------
 * Fixed 16 bytes: byte 0 is the command, the payload starts at byte 1, the
 * packet is zero-padded to 15 bytes, and byte 15 is the 8-bit additive
 * checksum of bytes 0..14 (`buildPacket`). Maximum payload is 15 bytes.
 *
 * Big-data V2 commands
 * --------------------
 * `BC <type> <payload length LE16> <CRC-16/MODBUS of payload LE16> <payload>`.
 * CRC-16/MODBUS is reflected polynomial 0xA001, init 0xFFFF, no final XOR. The
 * upstream sleep request `BC 27 01 00 FF 00 FF` is itself a check vector:
 * CRC-16/MODBUS of `FF` is `0x00FF`, stored little-endian as `FF 00`. Incoming
 * V2 frames shorter than `length + 6` are buffered and concatenated with the
 * following notifications until complete.
 *
 * Timestamps
 * ----------
 * Activity and sleep payloads carry device-local wall-clock values with no
 * timezone. They are interpreted with the phone's timezone offset at that
 * instant, exactly like the existing GATT and scale parsers: a local `Date` is
 * constructed and converted with `.toISOString()`. Heart-rate history carries
 * Unix seconds and is timezone-free.
 *
 * The `73 0C` notification also carries battery state upstream; its payload
 * layout is not pinned in the reference notes, so only the `03` battery
 * response is decoded here.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { ColmiRingRecordType } from "../models/colmi-ring";

/** Sleep stage labels, mapped from the upstream stage type bytes. */
export type ColmiRingStage = "awake" | "light" | "deep" | "rem";

/** One 15-minute activity bucket. */
export type RingStepsInterval = Readonly<{
  type: "steps_interval";
  startTime: string;
  endTime: string;
  count: number;
}>;

export type RingSleepStage = Readonly<{
  stage: ColmiRingStage;
  startTime: string;
  endTime: string;
}>;

export type RingSleepSession = Readonly<{
  type: "sleep_session";
  startTime: string;
  endTime: string;
  stages?: readonly RingSleepStage[];
}>;

export type RingHeartRateSample = Readonly<{
  type: "heart_rate";
  time: string;
  bpm: number;
}>;

/** Any record a ring session can emit. */
export type ColmiRingRecord = RingStepsInterval | RingSleepSession | RingHeartRateSample;

/** Battery state from the `03` response. */
export type RingBatteryState = Readonly<{ percent: number; charging: boolean }>;

/** Failure kinds reported by the transport. */
export type ColmiRingFailure = ColmiRingRecordType | "init";

const PACKET_LENGTH = 16;
const MAX_PAYLOAD_LENGTH = PACKET_LENGTH - 1;
const BIG_DATA_HEADER_LENGTH = 6;
const HEART_RATE_SAMPLE_INTERVAL_MS = 5 * 60_000;
const STEPS_INTERVAL_MS = 15 * 60_000;

/** Upstream stage type bytes (YawellRingConstants). */
const STAGE_BY_TYPE: Readonly<Record<number, ColmiRingStage>> = {
  0x02: "light",
  0x03: "deep",
  0x04: "rem",
  0x05: "awake",
};

function uint16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function uint32le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

// ---------------------------------------------------------------------------
// Packet building
// ---------------------------------------------------------------------------

/** 8-bit additive checksum over bytes 0..14. */
export function checksum8(bytes: Uint8Array, length = PACKET_LENGTH - 1): number {
  let sum = 0;
  for (let index = 0; index < length; index += 1) sum = (sum + bytes[index]!) & 0xff;
  return sum;
}

/**
 * Builds a normal 16-byte command packet: command byte, payload, zero padding,
 * additive checksum in byte 15. Throws when the payload exceeds 15 bytes.
 */
export function buildPacket(command: number, payload: readonly number[] = []): Uint8Array {
  if (payload.length > MAX_PAYLOAD_LENGTH) throw new RangeError("COLMI_PAYLOAD_TOO_LONG");
  const packet = new Uint8Array(PACKET_LENGTH);
  packet[0] = command & 0xff;
  for (let index = 0; index < payload.length; index += 1)
    packet[index + 1] = payload[index]! & 0xff;
  packet[PACKET_LENGTH - 1] = checksum8(packet);
  return packet;
}

/** CRC-16/MODBUS: reflected 0xA001, init 0xFFFF, no final XOR. */
export function crc16Modbus(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc & 0x01) !== 0 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

/**
 * Builds a big-data V2 frame: `BC <type> <length LE16> <crc LE16> <payload>`.
 */
export function buildBigDataV2Packet(type: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(BIG_DATA_HEADER_LENGTH + payload.length);
  frame[0] = 0xbc;
  frame[1] = type & 0xff;
  frame[2] = payload.length & 0xff;
  frame[3] = (payload.length >>> 8) & 0xff;
  const crc = crc16Modbus(payload);
  frame[4] = crc & 0xff;
  frame[5] = (crc >>> 8) & 0xff;
  frame.set(payload, BIG_DATA_HEADER_LENGTH);
  return frame;
}

// ---------------------------------------------------------------------------
// V2 reassembly
// ---------------------------------------------------------------------------

export type ColmiV2Frame = Readonly<{ type: number; payload: Uint8Array }>;

export type ColmiV2Reassembler = Readonly<{ push(bytes: Uint8Array): readonly ColmiV2Frame[] }>;

/**
 * Buffers V2 notifications until each announced payload is complete, then
 * yields frames whose CRC matches. Bytes that do not start with `0xBC` are
 * discarded one at a time so a truncated stream resynchronises.
 */
export function createColmiV2Reassembler(): ColmiV2Reassembler {
  let buffer: number[] = [];
  return {
    push(bytes) {
      buffer.push(...bytes);
      const frames: ColmiV2Frame[] = [];
      while (buffer.length >= BIG_DATA_HEADER_LENGTH) {
        if (buffer[0] !== 0xbc) {
          buffer.shift();
          continue;
        }
        const type = buffer[1]!;
        const length = buffer[2]! | (buffer[3]! << 8);
        const total = length + BIG_DATA_HEADER_LENGTH;
        if (buffer.length < total) break;
        const payload = Uint8Array.from(buffer.slice(BIG_DATA_HEADER_LENGTH, total));
        const expected = buffer[4]! | (buffer[5]! << 8);
        buffer = buffer.slice(total);
        if (crc16Modbus(payload) !== expected) continue;
        frames.push({ type, payload });
      }
      return frames;
    },
  };
}

// ---------------------------------------------------------------------------
// Decimal-as-hex helpers
// ---------------------------------------------------------------------------

/**
 * Encodes a decimal value the way upstream writes date fields: the decimal
 * digits are stored as a hexadecimal byte. 2026 % 2000 = 26 decimal → 0x26;
 * November (11) → 0x11.
 */
export function encodeDecimalAsHex(value: number): number {
  const digits = String(Math.trunc(value)).padStart(2, "0");
  if (!/^[0-9]{2}$/.test(digits)) throw new RangeError("COLMI_DECIMAL_AS_HEX_INVALID");
  return Number.parseInt(digits, 16) & 0xff;
}

/** Decodes a decimal-as-hex byte; returns null when the nibbles are not digits. */
export function decodeDecimalAsHex(byte: number): number | null {
  const digits = (byte & 0xff).toString(16).padStart(2, "0");
  if (!/^[0-9]{2}$/.test(digits)) return null;
  return Number.parseInt(digits, 10);
}

// ---------------------------------------------------------------------------
// Init commands
// ---------------------------------------------------------------------------

/** `04 02 0A 47 42`: phone name ("GB"). */
export function buildPhoneNamePacket(): Uint8Array {
  return buildPacket(0x04, [0x02, 0x0a, 0x47, 0x42]);
}

/** `01 <year%2000> <month> <day> <hour> <minute> <second>` in decimal-as-hex. */
export function buildDateTimePacket(now: Date): Uint8Array {
  return buildPacket(0x01, [
    encodeDecimalAsHex(now.getFullYear() % 2000),
    encodeDecimalAsHex(now.getMonth() + 1),
    encodeDecimalAsHex(now.getDate()),
    encodeDecimalAsHex(now.getHours()),
    encodeDecimalAsHex(now.getMinutes()),
    encodeDecimalAsHex(now.getSeconds()),
  ]);
}

export type ColmiRingUserPreferences = Readonly<{
  /** 0 = metric, 1 = imperial (upstream distance unit byte). */
  distanceUnit: number;
  /** 0 = female, 1 = male (upstream gender byte). */
  gender: number;
  age: number;
  heightCm: number;
  weightKg: number;
}>;

export const DEFAULT_COLMI_RING_USER_PREFERENCES: ColmiRingUserPreferences = Object.freeze({
  distanceUnit: 0,
  gender: 1,
  age: 30,
  heightCm: 175,
  weightKg: 70,
});

/** `0A 02 00 <distanceUnit> <gender> <age> <heightCm> <weightKg> 00 00 00`. */
export function buildUserPreferencesPacket(prefs: ColmiRingUserPreferences): Uint8Array {
  return buildPacket(0x0a, [
    0x02,
    0x00,
    prefs.distanceUnit,
    prefs.gender,
    prefs.age,
    prefs.heightCm,
    prefs.weightKg,
    0x00,
    0x00,
    0x00,
  ]);
}

/** `03`: battery request. */
export function buildBatteryRequestPacket(): Uint8Array {
  return buildPacket(0x03);
}

/** `43 <daysAgo> 0F 00 5F 01`: activity history for one day. */
export function buildActivityHistoryRequestPacket(daysAgo: number): Uint8Array {
  return buildPacket(0x43, [daysAgo & 0xff, 0x0f, 0x00, 0x5f, 0x01]);
}

/** `15 <timestamp LE32 seconds>`: heart-rate history from local midnight. */
export function buildHeartRateHistoryRequestPacket(dayStart: Date): Uint8Array {
  const seconds = Math.floor(dayStart.getTime() / 1000) >>> 0;
  return buildPacket(0x15, [
    seconds & 0xff,
    (seconds >>> 8) & 0xff,
    (seconds >>> 16) & 0xff,
    (seconds >>> 24) & 0xff,
  ]);
}

/** Raw 7-byte V2 sleep-history request, exactly as upstream sends it. */
export const SLEEP_HISTORY_REQUEST: Uint8Array = Uint8Array.of(
  0xbc,
  0x27,
  0x01,
  0x00,
  0xff,
  0x00,
  0xff,
);

/** `1E 01` enable / `1E 02` disable realtime heart rate. */
export function buildRealtimeHeartRatePacket(enabled: boolean): Uint8Array {
  return buildPacket(0x1e, [enabled ? 0x01 : 0x02]);
}

/** `1E 03`: realtime heart-rate keepalive, sent every 30 notifications. */
export const REALTIME_HEART_RATE_KEEPALIVE: Uint8Array = buildPacket(0x1e, [0x03]);

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/** Parses a realtime heart-rate notification (`1E <bpm>`). */
export function parseRealtimeHeartRate(bytes: Uint8Array): number | null {
  if (bytes.length < 2 || bytes[0] !== 0x1e) return null;
  const bpm = bytes[1]!;
  return bpm > 0 ? bpm : null;
}

/** Parses the `03 <percent> <charging>` battery response. */
export function parseBatteryResponse(bytes: Uint8Array): RingBatteryState | null {
  if (bytes.length < 2 || bytes[0] !== 0x03) return null;
  const percent = bytes[1]!;
  if (percent > 100) return null;
  return { percent, charging: bytes[2] === 0x01 };
}

export type ActivityHistoryPacket =
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "no_data" }>
  | Readonly<{
      kind: "interval";
      packetNumber: number;
      totalPackets: number;
      done: boolean;
      interval: RingStepsInterval;
      calories: number;
      distanceMeters: number;
    }>;

/**
 * Parses one `43` activity-history packet. Each packet covers one quarter-hour
 * of one day: `value[1..3]` is the date in decimal-as-hex, `value[4]` is the
 * quarter index (hour = value[4] / 4), `value[5]` the packet number and
 * `value[6]` the packet count. Steps are `value[9..10]` LE16.
 */
export function parseActivityHistoryPacket(bytes: Uint8Array): ActivityHistoryPacket | null {
  if (bytes.length < 13 || bytes[0] !== 0x43) return null;
  if (bytes[1] === 0xff) return { kind: "empty" };
  if (bytes[1] === 0xf0) return { kind: "no_data" };

  const year = decodeDecimalAsHex(bytes[1]!);
  const month = decodeDecimalAsHex(bytes[2]!);
  const day = decodeDecimalAsHex(bytes[3]!);
  if (year === null || month === null || day === null) return null;
  const fullYear = 2000 + year;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const quarter = bytes[4]!;
  if (quarter > 95) return null;
  const hour = Math.floor(quarter / 4);
  const minute = (quarter % 4) * 15;

  const start = new Date(fullYear, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(start.getTime())) return null;
  if (start.getFullYear() !== fullYear || start.getMonth() !== month - 1) return null;
  if (start.getDate() !== day || start.getHours() !== hour) return null;

  const packetNumber = bytes[5]!;
  const totalPackets = bytes[6]!;
  if (totalPackets === 0) return null;

  return {
    kind: "interval",
    packetNumber,
    totalPackets,
    done: packetNumber === totalPackets - 1,
    interval: {
      type: "steps_interval",
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + STEPS_INTERVAL_MS).toISOString(),
      count: uint16le(bytes, 9),
    },
    calories: uint16le(bytes, 7),
    distanceMeters: uint16le(bytes, 11),
  };
}

export type HeartRateHistoryResult = Readonly<{
  packetNumber: number;
  totalPackets: number | null;
  samples: readonly RingHeartRateSample[];
  done: boolean;
  empty: boolean;
}>;

export type HeartRateHistoryAccumulator = Readonly<{
  push(bytes: Uint8Array): HeartRateHistoryResult | null;
}>;

/**
 * Stateful `15` heart-rate history parser.
 *
 * Packet 0 is the header (total packet count in `value[2]`). Packet 1 carries
 * the sync-from Unix timestamp in `value[2..5]` followed by nine five-minute
 * values from `value[6]`; later packets carry thirteen values from `value[2]`.
 * Zero values are skipped, and values timestamped in the future are skipped,
 * but the five-minute cursor advances for every slot either way.
 */
export function createHeartRateHistoryAccumulator(
  options: {
    now?: () => Date;
  } = {},
): HeartRateHistoryAccumulator {
  const now = options.now ?? (() => new Date());
  let totalPackets: number | null = null;
  let cursorMs: number | null = null;

  return {
    push(bytes) {
      if (bytes.length < 2 || bytes[0] !== 0x15) return null;
      const packetNumber = bytes[1]!;
      if (packetNumber === 0xff)
        return { packetNumber, totalPackets, samples: [], done: true, empty: true };
      if (packetNumber === 0) {
        totalPackets = bytes.length >= 3 ? bytes[2]! : null;
        return {
          packetNumber,
          totalPackets,
          samples: [],
          done: totalPackets === 0,
          empty: totalPackets === 0,
        };
      }

      let offset: number;
      if (packetNumber === 1) {
        if (bytes.length < 6) return null;
        cursorMs = uint32le(bytes, 2) * 1000;
        offset = 6;
      } else {
        if (cursorMs === null) return null;
        offset = 2;
      }

      const limit = now().getTime();
      const samples: RingHeartRateSample[] = [];
      while (offset < bytes.length && cursorMs !== null) {
        const bpm = bytes[offset]!;
        const time = cursorMs;
        cursorMs += HEART_RATE_SAMPLE_INTERVAL_MS;
        offset += 1;
        if (bpm <= 0 || time > limit) continue;
        samples.push({ type: "heart_rate", time: new Date(time).toISOString(), bpm });
      }

      return {
        packetNumber,
        totalPackets,
        samples,
        done: totalPackets !== null && packetNumber >= totalPackets,
        empty: false,
      };
    },
  };
}

/** Local midnight for `daysAgo` days before `reference`. */
function localMidnight(reference: Date, daysAgo: number): Date {
  return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() - daysAgo);
}

/**
 * Parses a complete `27` sleep big-data payload (the bytes after the V2
 * header/CRC).
 *
 * Layout: `daysInPacket` (1), then per day `daysAgo` (1), `dayBytes` (1, the
 * total length of the day entry), `sleepStart` (LE16 minutes after midnight),
 * `sleepEnd` (LE16), then `[stageType][durationMinutes]` pairs. Stage pairs
 * start six bytes into the day entry (four bytes after the two count bytes).
 * When `sleepStart > sleepEnd` the session began on the previous day, so 1440
 * minutes are subtracted from the start.
 */
export function parseSleepBigData(
  payload: Uint8Array,
  options: { today?: Date; now?: () => Date } = {},
): readonly RingSleepSession[] {
  if (payload.length < 1) return [];
  const today = options.today ?? (options.now ?? (() => new Date()))();
  const days = payload[0]!;
  const sessions: RingSleepSession[] = [];
  let offset = 1;

  for (let index = 0; index < days; index += 1) {
    if (offset + 2 > payload.length) break;
    const daysAgo = payload[offset]!;
    const dayBytes = payload[offset + 1]!;
    if (dayBytes < 2) break;
    const dayEnd = offset + dayBytes;
    if (dayEnd > payload.length) break;
    if (dayBytes < 6) {
      offset = dayEnd;
      continue;
    }

    const sleepStart = uint16le(payload, offset + 2);
    const sleepEnd = uint16le(payload, offset + 4);
    const day = localMidnight(today, daysAgo);
    const startMinutes = sleepStart > sleepEnd ? sleepStart - 1440 : sleepStart;
    const startMs = day.getTime() + startMinutes * 60_000;
    const endMs = day.getTime() + sleepEnd * 60_000;

    if (endMs > startMs) {
      const stages: RingSleepStage[] = [];
      let cursor = startMs;
      for (let pair = offset + 6; pair + 1 < dayEnd; pair += 2) {
        const stage = STAGE_BY_TYPE[payload[pair]!];
        const durationMinutes = payload[pair + 1]!;
        const stageStart = cursor;
        cursor += durationMinutes * 60_000;
        if (!stage || durationMinutes <= 0) continue;
        const stageEnd = Math.min(cursor, endMs);
        if (stageEnd <= stageStart) continue;
        stages.push({
          stage,
          startTime: new Date(stageStart).toISOString(),
          endTime: new Date(stageEnd).toISOString(),
        });
      }
      sessions.push({
        type: "sleep_session",
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString(),
        ...(stages.length ? { stages } : {}),
      });
    }

    offset = dayEnd;
  }

  return sessions;
}
