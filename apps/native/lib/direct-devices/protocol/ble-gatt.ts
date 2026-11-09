/**
 * Pure Bluetooth GATT measurement parsers for the generic sensor family.
 *
 * Ported from Gadgetbridge's profile parsers at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2:
 * - `service/btle/profiles/heartrate/HeartRateProfile.java`
 * - `service/btle/profiles/bloodpressure/BloodPressureProfile.kt`
 * - `service/btle/profiles/thermometer/TemperatureProfile.java`
 *
 * The thermometer parser is deliberately NOT a port of upstream's profile:
 * that profile ignores the flags byte and hard-codes field offsets (its own
 * javadoc admits this). This implementation follows the Bluetooth SIG
 * Temperature Measurement (0x2A1C) layout, so a payload without the optional
 * timestamp/type fields parses correctly.
 *
 * The blood-pressure parser fixes an upstream gap: IEEE-11073 SFLOAT special
 * values (NaN / NRes / +INF / -INF) are rejected instead of being decoded as
 * numbers.
 *
 * Timestamps: the Heart Rate Measurement has no timestamp, so receive time is
 * used. Blood pressure and temperature payloads may carry a 7-byte
 * device-local wall-clock timestamp (year u16 LE, month, day, hour, minute,
 * second). It is interpreted with the phone's timezone offset at that instant:
 * `new Date(year, month - 1, day, hour, minute, second)` is local time, and
 * `.toISOString()` converts it to UTC. A device clock is not timezone-aware;
 * this is the best available interpretation and is documented rather than
 * silently treated as UTC.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/** Sensor-contact state decoded from the heart-rate flags. */
export type HeartRateSensorContact = "unsupported" | "detected" | "not_detected";

export type HeartRateSample = Readonly<{
  type: "heart_rate";
  /** Receive time, ISO-8601 UTC. */
  time: string;
  bpm: number;
  sensorContact: HeartRateSensorContact;
  /** Parsed but not persisted this round. */
  energyExpended: number | null;
  /** Parsed but not persisted this round; milliseconds. */
  rrIntervalsMs: readonly number[];
}>;

export type BloodPressureSample = Readonly<{
  type: "blood_pressure";
  /** Device timestamp when present, otherwise receive time. ISO-8601 UTC. */
  time: string;
  systolic: number;
  diastolic: number;
  meanArterialPressure: number;
  pulseRate: number | null;
  userId: number | null;
  /** True when the payload carried its own 7-byte timestamp. */
  deviceTimestamp: boolean;
}>;

export type BodyTemperatureSample = Readonly<{
  type: "body_temperature";
  /** Device timestamp when present, otherwise receive time. ISO-8601 UTC. */
  time: string;
  celsius: number;
  /** Raw temperature-type byte (measurement site), metadata only. */
  site: number | null;
  /** True when the payload carried its own 7-byte timestamp. */
  deviceTimestamp: boolean;
}>;

export type BleGattSample = HeartRateSample | BloodPressureSample | BodyTemperatureSample;

function uint16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

/** IEEE-11073 SFLOAT special values, checked against the raw 16-bit word. */
const SFLOAT_SPECIALS = new Set([0x07ff, 0x0800, 0x07fe, 0x0802]);

/**
 * Decodes one IEEE-11073 SFLOAT (16-bit) at `offset`, or null for a special
 * value / short payload.
 */
function readSfloat(bytes: Uint8Array, offset: number): number | null {
  if (offset + 2 > bytes.length) return null;
  const raw = uint16le(bytes, offset);
  if (SFLOAT_SPECIALS.has(raw)) return null;
  let mantissa = raw & 0x0fff;
  let exponent = raw >>> 12;
  if (exponent >= 0x8) exponent -= 0x10;
  if (mantissa >= 0x800) mantissa -= 0x1000;
  const value = mantissa * 10 ** exponent;
  return Number.isFinite(value) ? value : null;
}

/** IEEE-11073 FLOAT32 special mantissas (NaN, NRes, +INF, -INF). */
const FLOAT32_SPECIAL_MANTISSAS = new Set([0x7fffff, 0x800000, 0x7ffffe, 0x800002]);

/**
 * Decodes one IEEE-11073 FLOAT32 (24-bit signed mantissa + 8-bit signed
 * exponent, 4 bytes LE) at `offset`, or null for a special value / short
 * payload.
 */
function readFloat32(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.length) return null;
  const raw =
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0;
  const mantissaRaw = raw & 0xffffff;
  if (FLOAT32_SPECIAL_MANTISSAS.has(mantissaRaw)) return null;
  let mantissa = mantissaRaw;
  if (mantissa >= 0x800000) mantissa -= 0x1000000;
  let exponent = (raw >>> 24) & 0xff;
  if (exponent >= 0x80) exponent -= 0x100;
  // Exponent extremes are reserved/invalid for a measurement.
  if (exponent === -128 || exponent === 127) return null;
  const value = mantissa * 10 ** exponent;
  return Number.isFinite(value) ? value : null;
}

/**
 * Converts a device-local wall-clock timestamp to ISO-8601 UTC using the
 * phone's timezone offset at that instant. Returns null for invalid fields
 * (including rollover dates such as 31 February).
 */
function deviceWallTimeToIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): string | null {
  if (year < 100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const local = new Date(year, month - 1, day, hour, minute, second, 0);
  if (Number.isNaN(local.getTime())) return null;
  // Reject dates the Date constructor rolled over (e.g. 31 February).
  if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day)
    return null;
  return local.toISOString();
}

type ParsedDeviceTimestamp = Readonly<{ time: string; nextOffset: number }>;

/** Reads the optional 7-byte device timestamp at `offset`, or null. */
function readDeviceTimestamp(bytes: Uint8Array, offset: number): ParsedDeviceTimestamp | null {
  if (offset + 7 > bytes.length) return null;
  const time = deviceWallTimeToIso(
    uint16le(bytes, offset),
    bytes[offset + 2]!,
    bytes[offset + 3]!,
    bytes[offset + 4]!,
    bytes[offset + 5]!,
    bytes[offset + 6]!,
  );
  return time === null ? null : { time, nextOffset: offset + 7 };
}

/**
 * Parses a Heart Rate Measurement (0x2A37) notification.
 *
 * Flags: bit0 uint16 BPM (else uint8), bit1 contact detected, bit2 contact
 * supported, bit3 energy expended (uint16, parsed and ignored), bit4 RR
 * intervals (uint16 each, `(raw * 1000) / 1024` ms, parsed and dropped).
 * `bpm <= 0` is rejected. Timestamp is receive time.
 */
export function parseHeartRateMeasurement(
  bytes: Uint8Array,
  receivedAt: Date = new Date(),
): HeartRateSample | null {
  if (bytes.length < 2) return null;
  const flags = bytes[0]!;
  let offset = 1;
  let bpm: number;
  if ((flags & 0x01) !== 0) {
    if (offset + 2 > bytes.length) return null;
    bpm = uint16le(bytes, offset);
    offset += 2;
  } else {
    if (offset + 1 > bytes.length) return null;
    bpm = bytes[offset]!;
    offset += 1;
  }
  if (bpm <= 0) return null;

  const contactSupported = (flags & 0x04) !== 0;
  const contactDetected = (flags & 0x02) !== 0;
  const sensorContact: HeartRateSensorContact = contactSupported
    ? contactDetected
      ? "detected"
      : "not_detected"
    : "unsupported";

  let energyExpended: number | null = null;
  if ((flags & 0x08) !== 0) {
    if (offset + 2 > bytes.length) return null;
    energyExpended = uint16le(bytes, offset);
    offset += 2;
  }

  const rrIntervalsMs: number[] = [];
  if ((flags & 0x10) !== 0) {
    while (offset + 2 <= bytes.length) {
      rrIntervalsMs.push((uint16le(bytes, offset) * 1000) / 1024);
      offset += 2;
    }
  }

  return {
    type: "heart_rate",
    time: receivedAt.toISOString(),
    bpm,
    sensorContact,
    energyExpended,
    rrIntervalsMs,
  };
}

/**
 * Parses a Blood Pressure Measurement (0x2A35) notification.
 *
 * Flags: bit0 unit is kPa (converted to mmHg with ×7.50061683, rounded),
 * bit1 7-byte device timestamp, bit2 pulse rate SFLOAT, bit3 user id uint8,
 * bit4 measurement status uint16. Systolic, diastolic and MAP are SFLOATs;
 * special values reject the whole measurement.
 */
export function parseBloodPressureMeasurement(
  bytes: Uint8Array,
  receivedAt: Date = new Date(),
): BloodPressureSample | null {
  if (bytes.length < 7) return null;
  const flags = bytes[0]!;
  let offset = 1;

  const systolicRaw = readSfloat(bytes, offset);
  offset += 2;
  const diastolicRaw = readSfloat(bytes, offset);
  offset += 2;
  const mapRaw = readSfloat(bytes, offset);
  offset += 2;
  if (systolicRaw === null || diastolicRaw === null || mapRaw === null) return null;

  const toMmHg = (value: number) =>
    (flags & 0x01) !== 0 ? Math.round(value * 7.50061683) : Math.round(value);
  const systolic = toMmHg(systolicRaw);
  const diastolic = toMmHg(diastolicRaw);
  const meanArterialPressure = toMmHg(mapRaw);
  if (systolic <= 0 || diastolic <= 0 || meanArterialPressure <= 0) return null;

  let time = receivedAt.toISOString();
  let deviceTimestamp = false;
  if ((flags & 0x02) !== 0) {
    const parsed = readDeviceTimestamp(bytes, offset);
    if (!parsed) return null;
    time = parsed.time;
    deviceTimestamp = true;
    offset = parsed.nextOffset;
  }

  let pulseRate: number | null = null;
  if ((flags & 0x04) !== 0) {
    pulseRate = readSfloat(bytes, offset);
    if (pulseRate === null) return null;
    offset += 2;
  }

  let userId: number | null = null;
  if ((flags & 0x08) !== 0) {
    if (offset + 1 > bytes.length) return null;
    userId = bytes[offset]!;
    offset += 1;
  }

  if ((flags & 0x10) !== 0) {
    if (offset + 2 > bytes.length) return null;
    offset += 2;
  }

  return {
    type: "blood_pressure",
    time,
    systolic,
    diastolic,
    meanArterialPressure,
    pulseRate,
    userId,
    deviceTimestamp,
  };
}

/**
 * Parses a Temperature Measurement (0x2A1C) notification per the Bluetooth SIG
 * layout, not upstream's broken profile.
 *
 * Flags: bit0 unit (0 Celsius, 1 Fahrenheit; Fahrenheit is converted to
 * Celsius), bit1 7-byte device timestamp, bit2 temperature-type byte
 * (metadata only). The value is always an IEEE-11073 FLOAT32 in the indicated
 * unit. A payload with neither optional field parses correctly.
 */
export function parseTemperatureMeasurement(
  bytes: Uint8Array,
  receivedAt: Date = new Date(),
): BodyTemperatureSample | null {
  if (bytes.length < 5) return null;
  const flags = bytes[0]!;
  let offset = 1;

  const raw = readFloat32(bytes, offset);
  offset += 4;
  if (raw === null) return null;
  const celsius = (flags & 0x01) !== 0 ? (raw - 32) * (5 / 9) : raw;
  if (!Number.isFinite(celsius)) return null;

  let time = receivedAt.toISOString();
  let deviceTimestamp = false;
  if ((flags & 0x02) !== 0) {
    const parsed = readDeviceTimestamp(bytes, offset);
    if (!parsed) return null;
    time = parsed.time;
    deviceTimestamp = true;
    offset = parsed.nextOffset;
  }

  let site: number | null = null;
  if ((flags & 0x04) !== 0) {
    if (offset + 1 > bytes.length) return null;
    site = bytes[offset]!;
    offset += 1;
  }

  return { type: "body_temperature", time, celsius, site, deviceTimestamp };
}
