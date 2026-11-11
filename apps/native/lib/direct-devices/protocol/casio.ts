/**
 * Pure Casio CONVOY codecs and steps parsers.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2:
 * - `devices/casio/CasioConstants.java`
 * - `service/devices/casio/AbstractCasioConvoyFetchOperation.java`
 * - `service/devices/casio/gbx100/FetchStepCountDataOperation.java`
 * - `service/devices/casio/gbd200/FetchStepCountDataOperation.java`
 * - `service/devices/casio/ggb100/FetchStepCountDataOperation.java`
 *
 * Block transfer ("CONVOY")
 * -------------------------
 *   phone → h0011  `00 <feature> 00 00 00`                 request
 *   watch → h0011  `00 <feature> len_lo len_hi 00 00 00`   echo with total length
 *   watch → h0014  payload                                 one or more notifications
 *   phone → h0011  `04 <feature> 00 00 00`                 ACK, the watch marks it consumed
 *
 * There is no checksum anywhere in this protocol. The only integrity mechanism
 * is the length echo, so parsers report `lengthMatches` instead of rejecting a
 * payload outright: upstream logs a mismatch and parses anyway, and a truncated
 * payload still yields the bins it did carry.
 *
 * Encoding
 * --------
 * GBX-100 / GBD-100 / GBD-H1000 / GBD-200 XOR every payload byte with 0xFF
 * before parsing. The GG-B100 life log is sent in the clear. The flag lives on
 * the model (`stepPayloadXor`) and is applied here.
 *
 * Steps payloads
 * --------------
 * Hourly TLV (GBX-100 family), after XOR:
 *   `[0..1]` payload length LE16 · `[2]` year-2000 · `[3]` month · `[4]` day ·
 *   `[5]` hour · `[6]` minute · `[7..10]` total steps LE32 (`0xfffffffe` = 0) ·
 *   `[11..12]` total calories LE16 (`0xfffe` = 0) · `[17]` `0x01` finished,
 *   `0x00` more · `[18..]` TLV `type(1) len(2 LE) data`, type `0x04` steps and
 *   `0x05` calories, one uint16 per hour.
 *
 *   Upstream walks a `Calendar` seeded at the packet timestamp with minutes set
 *   to `:30` and does `add(HOUR, -1)` per entry, so every bin is stamped at
 *   `hh:30`. This codec stamps each bin at the **hour start** instead: the watch
 *   reports whole-hour totals, so `[hh:00, hh+1:00)` is the honest interval. Bin
 *   `k` therefore covers the hour `hour - 1 - k` of the packet's date.
 *
 *   Upstream also inserts the difference between the watch's running total and
 *   the sum of the bins as an artificial sample at `hour:30`. That sample is not
 *   an hourly bucket (it is "whatever is left"), so it is deliberately not
 *   emitted here; the difference is exposed as `residualSteps`/`residualCalories`
 *   for callers that want to log it.
 *
 * Life log (GG-B100), 160 bytes, no XOR:
 *   `[0..47]` 24 × uint16 steps, bin 0 = last completed hour, most recent first ·
 *   `[48..95]` 24 × uint16 kcal · `[96..99]` rolling-24 h steps LE32 ·
 *   `[100..103]` rolling-24 h kcal LE32 · `[104..159]` 7 × (uint32 steps,
 *   uint32 kcal), slot 0 = yesterday. `NO_DATA16 = 0xfffe`,
 *   `NO_DATA32 = 0xfffffffe`.
 *
 *   The 24 bins map to hourly `steps_interval` records exactly like the TLV
 *   path, anchored on the phone's current hour. The seven daily totals are
 *   day-granularity, not hourly, so they are parsed but not emitted as records.
 *
 * Timestamps are device-local wall-clock values with no timezone, interpreted
 * with the phone's timezone offset (a local `Date` is built and serialised with
 * `.toISOString()`), matching the other direct-device parsers.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { CasioRecordType, CasioStepsSource } from "../models/casio";

/** One hourly step bucket. */
export type CasioStepsBin = Readonly<{
  /** Inclusive start of the hour. */
  startTime: string;
  /** Exclusive end of the hour. */
  endTime: string;
  count: number;
  /** Upstream tracks calories alongside steps; the frozen record drops them. */
  calories: number;
}>;

/** A record this family can emit. */
export type CasioRecord = Readonly<{
  type: "steps_interval";
  startTime: string;
  endTime: string;
  count: number;
}>;

/** Failure kinds reported by the transport. */
export type CasioFailure = CasioRecordType | "init";

/** CONVOY request opcode (phone → watch). */
export const CASIO_CONVOY_OPCODE_REQUEST = 0x00;
/** CONVOY ACK opcode (phone → watch). */
export const CASIO_CONVOY_OPCODE_ACK = 0x04;
/** Steps / life-log feature id. */
export const CASIO_FEATURE_STEPS = 0x11;
/** `FEATURE_BLE_PARAM`: the watch sends `3d 01` when it enters the main menu. */
export const CASIO_FEATURE_BLE_PARAM = 0x3d;
/** TLV datatype: steps. */
export const CASIO_CONVOY_DATATYPE_STEPS = 0x04;
/** TLV datatype: calories. */
export const CASIO_CONVOY_DATATYPE_CALORIES = 0x05;

/** Minimum hourly-TLV payload length before the TLV block. */
export const CASIO_STEPS_HEADER_LENGTH = 18;
/** GG-B100 life-log payload length. */
export const CASIO_LIFE_LOG_LENGTH = 160;
/** 16-bit "no data" sentinel (`0xfffe`). */
export const CASIO_NO_DATA16 = 0xfffe;
/** 32-bit "no data" sentinel (`0xfffffffe`). */
export const CASIO_NO_DATA32 = 0xfffffffe;

const HOUR_MS = 60 * 60 * 1000;

function iso(millis: number): string {
  return new Date(millis).toISOString();
}

function le16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8)) >>> 0;
}

function le32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

// ---------------------------------------------------------------------------
// CONVOY frames
// ---------------------------------------------------------------------------

/** `00 <feature> 00 00 00` on h0011. */
export function buildConvoyRequest(feature: number): Uint8Array {
  return Uint8Array.from([CASIO_CONVOY_OPCODE_REQUEST, feature & 0xff, 0x00, 0x00, 0x00]);
}

/** `04 <feature> 00 00 00` on h0011. */
export function buildConvoyAck(feature: number): Uint8Array {
  return Uint8Array.from([CASIO_CONVOY_OPCODE_ACK, feature & 0xff, 0x00, 0x00, 0x00]);
}

export type CasioConvoyEcho = Readonly<{ feature: number; length: number }>;

/**
 * Parses the length echo `00 <feature> len_lo len_hi …` on h0011. Returns null
 * for anything that is not a request echo.
 */
export function parseConvoyEcho(bytes: Uint8Array): CasioConvoyEcho | null {
  if (bytes.length < 4) return null;
  if (bytes[0] !== CASIO_CONVOY_OPCODE_REQUEST) return null;
  return { feature: bytes[1]!, length: le16(bytes, 2) };
}

/** XOR 0xFF every byte (the Casio "encryption", identical to a bitwise NOT). */
export function xorPayload(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) out[index] = bytes[index]! ^ 0xff;
  return out;
}

/** Applies the model's payload encoding. Returns a copy either way. */
export function decodeConvoyPayload(bytes: Uint8Array, xor: boolean): Uint8Array {
  return xor ? xorPayload(bytes) : bytes.slice();
}

// ---------------------------------------------------------------------------
// Hourly TLV steps (GBX-100 / GBD-100 / GBD-H1000 / GBD-200)
// ---------------------------------------------------------------------------

export type CasioStepsTimestamp = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}>;

export type CasioStepsPacket = Readonly<{
  /** Length announced inside the payload (LE16). */
  length: number;
  /** False when the payload length and the announced length disagree. */
  lengthMatches: boolean;
  timestamp: CasioStepsTimestamp;
  /** Running total reported by the watch (`0xfffffffe` normalised to 0). */
  totalSteps: number;
  totalCalories: number;
  /** `[17] == 0x01`: the watch has nothing more to send. */
  finished: boolean;
  bins: readonly CasioStepsBin[];
  /** Watch total minus the sum of the bins, as upstream computes it. */
  residualSteps: number;
  residualCalories: number;
}>;

type TlvBlock = { type: number; values: readonly number[] };

/**
 * Walks the TLV block at `[18..]`. Each block is `type(1) len(2 LE) data`, and
 * the data is a run of uint16 samples. A block whose length is odd leaves one
 * padding byte, which is skipped.
 */
export function parseStepsTlv(data: Uint8Array): readonly TlvBlock[] {
  const blocks: TlvBlock[] = [];
  let index = CASIO_STEPS_HEADER_LENGTH;
  while (index + 3 <= data.length) {
    const type = data[index]!;
    const length = le16(data, index + 1);
    index += 3;
    const values: number[] = [];
    let consumed = 0;
    while (consumed + 2 <= length && index + 2 <= data.length) {
      const value = le16(data, index);
      index += 2;
      consumed += 2;
      values.push(value === CASIO_NO_DATA16 ? 0 : value);
    }
    const padding = length - consumed;
    if (padding > 0) index += padding;
    blocks.push({ type, values });
  }
  return blocks;
}

/**
 * Parses one hourly-TLV steps payload. `raw` is the CONVOY bytes exactly as they
 * arrived; `xor` applies the model's 0xFF encoding.
 */
export function parseStepsPacket(
  raw: Uint8Array,
  options: { xor: boolean },
): CasioStepsPacket | null {
  const data = decodeConvoyPayload(raw, options.xor);
  if (data.length < CASIO_STEPS_HEADER_LENGTH) return null;

  const length = le16(data, 0);
  const timestamp: CasioStepsTimestamp = {
    year: 2000 + data[2]!,
    month: data[3]!,
    day: data[4]!,
    hour: data[5]!,
    minute: data[6]!,
  };
  const rawSteps = le32(data, 7);
  const rawCalories = le16(data, 11);
  const totalSteps = rawSteps === CASIO_NO_DATA32 ? 0 : rawSteps;
  const totalCalories = rawCalories === CASIO_NO_DATA16 ? 0 : rawCalories;
  const finished = data[17] === 0x01;

  // Upstream only reads the TLV block when the watch says more data follows.
  const blocks = finished ? [] : parseStepsTlv(data);
  const steps = blocks.find((block) => block.type === CASIO_CONVOY_DATATYPE_STEPS)?.values ?? [];
  const calories =
    blocks.find((block) => block.type === CASIO_CONVOY_DATATYPE_CALORIES)?.values ?? [];

  const bins: CasioStepsBin[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    // Bin 0 is the hour before the packet timestamp; the hour start is used so
    // the interval is a whole hour (upstream stamps it at hh:30).
    const startMs = new Date(
      timestamp.year,
      timestamp.month - 1,
      timestamp.day,
      timestamp.hour - 1 - index,
      0,
      0,
      0,
    ).getTime();
    bins.push({
      startTime: iso(startMs),
      endTime: iso(startMs + HOUR_MS),
      count: steps[index]!,
      calories: calories[index] ?? 0,
    });
  }

  return {
    length,
    lengthMatches: data.length === length + 2,
    timestamp,
    totalSteps,
    totalCalories,
    finished,
    bins,
    residualSteps: totalSteps - bins.reduce((sum, bin) => sum + bin.count, 0),
    residualCalories: totalCalories - bins.reduce((sum, bin) => sum + bin.calories, 0),
  };
}

// ---------------------------------------------------------------------------
// Life log (GG-B100)
// ---------------------------------------------------------------------------

export type CasioLifeLogDay = Readonly<{
  startTime: string;
  endTime: string;
  steps: number;
  calories: number;
}>;

export type CasioLifeLog = Readonly<{
  /** 24 hourly bins, most recent completed hour first. */
  bins: readonly CasioStepsBin[];
  /** Rolling 24-hour totals reported by the watch. */
  totalSteps24h: number;
  totalCalories24h: number;
  /** Seven daily totals, slot 0 = yesterday. Not hourly, so not emitted. */
  dailyTotals: readonly CasioLifeLogDay[];
}>;

/**
 * Parses the 160-byte GG-B100 life log. `now` anchors the hour walk: bin 0 is
 * the last completed hour, so it starts at the current hour minus one. Bins the
 * watch marked `NO_DATA16` for both steps and calories are skipped, as upstream
 * does.
 */
export function parseLifeLog(payload: Uint8Array, options: { now: Date }): CasioLifeLog | null {
  if (payload.length < CASIO_LIFE_LOG_LENGTH) return null;
  const now = options.now;

  const bins: CasioStepsBin[] = [];
  for (let index = 0; index < 24; index += 1) {
    const steps = le16(payload, index * 2);
    const calories = le16(payload, 48 + index * 2);
    if (steps === CASIO_NO_DATA16 && calories === CASIO_NO_DATA16) continue;
    // Wall-clock hour arithmetic: `Date` normalises a negative hour into the
    // previous day, so midnight and DST boundaries stay correct.
    const startMs = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours() - (index + 1),
      0,
      0,
      0,
    ).getTime();
    bins.push({
      startTime: iso(startMs),
      endTime: iso(startMs + HOUR_MS),
      count: steps === CASIO_NO_DATA16 ? 0 : steps,
      calories: calories === CASIO_NO_DATA16 ? 0 : calories,
    });
  }

  const dailyTotals: CasioLifeLogDay[] = [];
  for (let index = 0; index < 7; index += 1) {
    const base = 104 + index * 8;
    const steps = le32(payload, base);
    const calories = le32(payload, base + 4);
    if (steps === CASIO_NO_DATA32) continue;
    const startMs = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - (index + 1),
      0,
      0,
      0,
      0,
    ).getTime();
    dailyTotals.push({
      startTime: iso(startMs),
      endTime: iso(startMs + 24 * HOUR_MS),
      steps,
      calories: calories === CASIO_NO_DATA32 ? 0 : calories,
    });
  }

  return {
    bins,
    totalSteps24h: le32(payload, 96),
    totalCalories24h: le32(payload, 100),
    dailyTotals,
  };
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** Maps hourly bins to the frozen `steps_interval` records. */
export function stepsBinsToRecords(bins: readonly CasioStepsBin[]): readonly CasioRecord[] {
  return bins.map((bin) => ({
    type: "steps_interval" as const,
    startTime: bin.startTime,
    endTime: bin.endTime,
    count: bin.count,
  }));
}

/**
 * Parses a complete CONVOY steps payload for a model's steps source and returns
 * the records to persist. Returns null when the payload cannot be parsed.
 */
export function parseCasioSteps(
  raw: Uint8Array,
  options: { source: CasioStepsSource; xor: boolean; now: Date },
): readonly CasioRecord[] | null {
  if (options.source === "life-log") {
    const lifeLog = parseLifeLog(raw, { now: options.now });
    return lifeLog ? stepsBinsToRecords(lifeLog.bins) : null;
  }
  const packet = parseStepsPacket(raw, { xor: options.xor });
  return packet ? stepsBinsToRecords(packet.bins) : null;
}
