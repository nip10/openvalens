/* Protocol facts adapted from Gadgetbridge Codeberg 8976702fc3d00e6008c91fe994668cb4027f7bc2.
 * Copyright (C) 2023-2025 José Rebelo; AGPL-3.0-or-later. */
import type { HelioCursor, HelioStepMinute } from "./types";

export const ENDPOINT_SERVICES = 0x0000;
export const ENDPOINT_AUTH = 0x0082;
export const ENDPOINT_HISTORY = 0x004b;
export const ENDPOINT_ACTIVITY = 0x0005;
export const FEE0 = "0000fee0-0000-1000-8000-00805f9b34fb";
export const CHUNK_WRITE = "00000016-0000-3512-2118-0009af100700";
export const CHUNK_READ = "00000017-0000-3512-2118-0009af100700";
export const ACTIVITY_DATA = "00000005-0000-3512-2118-0009af100700";
/** Plain activity control, used when the watch does not list endpoint 0x004b. */
export const ACTIVITY_CONTROL = "00000004-0000-3512-2118-0009af100700";

export function bytes(value: readonly number[]): Uint8Array {
  return Uint8Array.from(value);
}
export function readU16le(b: Uint8Array, i: number): number {
  if (i < 0 || i + 2 > b.length) throw new Error("TRUNCATED_PAYLOAD");
  return b[i]! | (b[i + 1]! << 8);
}
export function readU32le(b: Uint8Array, i: number): number {
  if (i < 0 || i + 4 > b.length) throw new Error("TRUNCATED_PAYLOAD");
  return (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
}

export type ServiceEncryption = ReadonlyMap<number, boolean>;
export function decodeServiceList(payload: Uint8Array): ServiceEncryption {
  // As lenient as upstream (ZeppOsServicesService): trailing bytes are
  // ignored, an unknown encryption byte keeps the default (unencrypted), and
  // a missing 0x004b is allowed (activity control then uses characteristic
  // 0004). Only a list too short for its declared count is refused.
  if (payload.length < 3 || payload[0] !== 4) throw new Error("INVALID_SERVICE_LIST");
  const count = readU16le(payload, 1);
  if (count > 256 || payload.length < 3 + count * 3) throw new Error("INVALID_SERVICE_LIST_LENGTH");
  const result = new Map<number, boolean>();
  for (let i = 0; i < count; i += 1) {
    const offset = 3 + i * 3,
      endpoint = readU16le(payload, offset),
      flag = payload[offset + 2]!;
    if (result.has(endpoint)) continue;
    result.set(endpoint, flag === 1);
  }
  return result;
}

export type DeviceDate = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  offsetQuarterHours: number;
}>;
export function decodeDeviceDate(raw: Uint8Array): DeviceDate {
  if (raw.length !== 8) throw new Error("INVALID_DEVICE_TIME");
  const year = readU16le(raw, 0),
    month = raw[2]!,
    day = raw[3]!,
    hour = raw[4]!,
    minute = raw[5]!,
    second = raw[6]!;
  const offsetQuarterHours = raw[7]! > 127 ? raw[7]! - 256 : raw[7]!;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    year < 2000 ||
    year > 2200 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    date.getUTCDate() !== day ||
    date.getUTCMonth() !== month - 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetQuarterHours < -56 ||
    offsetQuarterHours > 56
  )
    throw new Error("INVALID_DEVICE_TIME");
  return { year, month, day, hour, minute, second, offsetQuarterHours };
}

export function deviceDateToUtcMinute(value: DeviceDate): string {
  const local = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute);
  return (
    new Date(local - value.offsetQuarterHours * 15 * 60_000).toISOString().slice(0, 16) + ":00.000Z"
  );
}
/** `01 <type> yy yy MM dd hh mm ss tz`: type 0x01 is activity, 0x48 sleep sessions. */
export function historyStart(cursor: HelioCursor, type = 0x01): Uint8Array {
  const d = new Date(cursor.nextMinuteUtc);
  if (
    cursor.version !== 1 ||
    !Number.isInteger(cursor.offsetQuarterHours) ||
    cursor.offsetQuarterHours < -56 ||
    cursor.offsetQuarterHours > 56 ||
    !Number.isFinite(d.getTime()) ||
    d.toISOString() !== cursor.nextMinuteUtc ||
    d.getUTCSeconds() !== 0 ||
    d.getUTCMilliseconds() !== 0 ||
    d.getUTCFullYear() < 2000 ||
    d.getUTCFullYear() > 2200
  )
    throw new Error("INVALID_CURSOR");
  const local = new Date(d.getTime() + cursor.offsetQuarterHours * 15 * 60_000);
  const out = new Uint8Array(10);
  out[0] = 1;
  out[1] = type;
  out[2] = local.getUTCFullYear() & 255;
  out[3] = local.getUTCFullYear() >>> 8;
  out[4] = local.getUTCMonth() + 1;
  out[5] = local.getUTCDate();
  out[6] = local.getUTCHours();
  out[7] = local.getUTCMinutes();
  out[8] = 0;
  out[9] = cursor.offsetQuarterHours & 255;
  return out;
}

export function makeStepMinutes(
  raw: Uint8Array,
  firstSampleTime: string,
  _deviceId?: string,
  now = Date.now(),
): readonly HelioStepMinute[] {
  if (raw.length % 8 !== 0) throw new Error("UNSUPPORTED_ACTIVITY_FORMAT");
  const first = Date.parse(firstSampleTime);
  if (
    !Number.isFinite(first) ||
    new Date(first).toISOString() !== firstSampleTime ||
    first % 60_000 !== 0 ||
    !Number.isFinite(now)
  )
    throw new Error("INVALID_DEVICE_TIME");
  const result: HelioStepMinute[] = [];
  for (let i = 0; i < raw.length; i += 8) {
    const startTime = new Date(first + (i / 8) * 60_000).toISOString();
    const start = Date.parse(startTime);
    // The in-progress current minute is never published.
    if (start >= now - (now % 60_000)) continue;
    const count = raw[i + 2]!;
    const externalRecordId = `minute:${startTime}`;
    // Zepp OS layout: kind, intensity, steps, heart rate, … (FetchActivityOperation).
    // Kinds 115 (not worn) and 118 (charging) carry no real reading; 0 and
    // 255 are "not measured".
    const kind = raw[i]!;
    const bpm = raw[i + 3]!;
    const worn = kind !== 115 && kind !== 118;
    result.push(
      Object.freeze({
        externalRecordId,
        startTime,
        endTime: new Date(start + 60_000).toISOString(),
        count,
        ...(worn && bpm >= 25 && bpm <= 240 ? { heartRate: bpm } : {}),
      }),
    );
  }
  return Object.freeze(result);
}
