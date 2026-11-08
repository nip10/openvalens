/*  Copyright (C) 2023-2026 José Rebelo, Dany Mestas

    This file is part of Gadgetbridge.

    Gadgetbridge is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Gadgetbridge is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>. */

/**
 * Xiaomi activity file ids and daily step parsers.
 *
 * Upstream:
 * - `service/devices/xiaomi/activity/XiaomiActivityFileId.java`
 * - `service/devices/xiaomi/activity/impl/DailyDetailsParser.java`
 * - `service/devices/xiaomi/activity/impl/DailySummaryParser.java`
 * - `service/devices/xiaomi/activity/impl/XiaomiComplexActivityParser.java`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/xiaomi/activity/
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * Granularity:
 * - Daily **details** files (`ACTIVITY_DAILY` + `DETAILS`) carry one record per
 *   minute, starting at the file id timestamp. This is the preferred step
 *   source and yields minute-level records.
 * - Daily **summary** files (`ACTIVITY_DAILY` + `SUMMARY`) carry one record per
 *   day with the day's total steps. This port only uses them as a fallback
 *   when no details file exists for a day.
 */

import { crc32 } from "./chunked";

export const XIAOMI_ACTIVITY_TYPE = 0;
export const XIAOMI_SPORTS_TYPE = 1;

export const XIAOMI_ACTIVITY_DAILY = 0x00;
export const XIAOMI_ACTIVITY_SLEEP_STAGES = 0x03;
export const XIAOMI_ACTIVITY_MANUAL_SAMPLES = 0x06;
export const XIAOMI_ACTIVITY_SLEEP = 0x08;

export const XIAOMI_DETAIL_DETAILS = 0;
export const XIAOMI_DETAIL_SUMMARY = 1;
export const XIAOMI_DETAIL_GPS_TRACK = 2;

export type XiaomiActivityFileId = Readonly<{
  /** File id timestamp, epoch seconds. */
  timestamp: number;
  /** Local UTC offset in 15-minute blocks. */
  timezone: number;
  type: number;
  subtype: number;
  detailType: number;
  version: number;
}>;

const MAX_FILE_ID_BYTES = 7;

export function encodeXiaomiActivityFileId(fileId: XiaomiActivityFileId): Uint8Array {
  if (!Number.isSafeInteger(fileId.timestamp) || fileId.timestamp < 0) {
    throw new Error("XIAOMI_FILE_ID_TIMESTAMP");
  }
  if (!Number.isInteger(fileId.timezone) || fileId.timezone < 0 || fileId.timezone > 0xff) {
    throw new Error("XIAOMI_FILE_ID_TIMEZONE");
  }
  if (!Number.isInteger(fileId.version) || fileId.version < 0 || fileId.version > 0xff) {
    throw new Error("XIAOMI_FILE_ID_VERSION");
  }
  if (!Number.isInteger(fileId.type) || fileId.type < 0 || fileId.type > 1) {
    throw new Error("XIAOMI_FILE_ID_TYPE");
  }
  if (!Number.isInteger(fileId.subtype) || fileId.subtype < 0 || fileId.subtype > 0x3f) {
    throw new Error("XIAOMI_FILE_ID_SUBTYPE");
  }
  if (!Number.isInteger(fileId.detailType) || fileId.detailType < 0 || fileId.detailType > 3) {
    throw new Error("XIAOMI_FILE_ID_DETAIL");
  }
  const out = new Uint8Array(MAX_FILE_ID_BYTES);
  const view = new DataView(out.buffer);
  view.setUint32(0, fileId.timestamp, true);
  out[4] = fileId.timezone;
  out[5] = fileId.version;
  out[6] = (fileId.type << 7) | (fileId.subtype << 2) | fileId.detailType;
  return out;
}

export function decodeXiaomiActivityFileId(bytes: Uint8Array, offset = 0): XiaomiActivityFileId {
  if (offset < 0 || offset + MAX_FILE_ID_BYTES > bytes.length) {
    throw new Error("XIAOMI_FILE_ID_TRUNCATED");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, MAX_FILE_ID_BYTES);
  const flags = bytes[offset + 6]!;
  return {
    timestamp: view.getUint32(0, true),
    timezone: bytes[offset + 4]!,
    version: bytes[offset + 5]!,
    type: (flags >> 7) & 1,
    subtype: (flags >> 2) & 0x3f,
    detailType: flags & 3,
  };
}

export function decodeXiaomiActivityFileIds(bytes: Uint8Array): XiaomiActivityFileId[] {
  if (bytes.length % MAX_FILE_ID_BYTES !== 0) {
    throw new Error("XIAOMI_FILE_ID_LENGTH");
  }
  const ids: XiaomiActivityFileId[] = [];
  for (let offset = 0; offset < bytes.length; offset += MAX_FILE_ID_BYTES) {
    ids.push(decodeXiaomiActivityFileId(bytes, offset));
  }
  return ids;
}

export function xiaomiActivityFileIdEquals(
  left: XiaomiActivityFileId,
  right: XiaomiActivityFileId,
): boolean {
  return (
    left.timestamp === right.timestamp &&
    left.timezone === right.timezone &&
    left.type === right.type &&
    left.subtype === right.subtype &&
    left.detailType === right.detailType &&
    left.version === right.version
  );
}

class ByteReader {
  private offset: number;

  constructor(
    private readonly bytes: Uint8Array,
    offset = 0,
  ) {
    if (offset < 0 || offset > bytes.length) throw new Error("XIAOMI_ACTIVITY_TRUNCATED");
    this.offset = offset;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  get position(): number {
    return this.offset;
  }

  getU8(): number {
    if (this.remaining < 1) throw new Error("XIAOMI_ACTIVITY_TRUNCATED");
    return this.bytes[this.offset++]!;
  }

  getU16(): number {
    if (this.remaining < 2) throw new Error("XIAOMI_ACTIVITY_TRUNCATED");
    const value = this.bytes[this.offset]! | (this.bytes[this.offset + 1]! << 8);
    this.offset += 2;
    return value;
  }

  getU32(): number {
    if (this.remaining < 4) throw new Error("XIAOMI_ACTIVITY_TRUNCATED");
    const value =
      (this.bytes[this.offset]! |
        (this.bytes[this.offset + 1]! << 8) |
        (this.bytes[this.offset + 2]! << 16) |
        (this.bytes[this.offset + 3]! << 24)) >>>
      0;
    this.offset += 4;
    return value;
  }

  skip(count: number): void {
    if (!Number.isInteger(count) || count < 0 || count > this.remaining) {
      throw new Error("XIAOMI_ACTIVITY_TRUNCATED");
    }
    this.offset += count;
  }

  take(count: number): Uint8Array {
    if (!Number.isInteger(count) || count < 0 || count > this.remaining) {
      throw new Error("XIAOMI_ACTIVITY_TRUNCATED");
    }
    const value = this.bytes.slice(this.offset, this.offset + count);
    this.offset += count;
    return value;
  }
}

function verifyFileCrc(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12) throw new Error("XIAOMI_ACTIVITY_TRUNCATED");
  const expected =
    (bytes[bytes.length - 4]! |
      (bytes[bytes.length - 3]! << 8) |
      (bytes[bytes.length - 2]! << 16) |
      (bytes[bytes.length - 1]! << 24)) >>>
    0;
  const body = bytes.slice(0, -4);
  if (crc32(body) !== expected) throw new Error("XIAOMI_ACTIVITY_CRC");
  return body;
}

function verifyFileId(body: Uint8Array, fileId: XiaomiActivityFileId): void {
  if (body.length < 8) throw new Error("XIAOMI_ACTIVITY_TRUNCATED");
  const actual = decodeXiaomiActivityFileId(body, 0);
  if (!xiaomiActivityFileIdEquals(actual, fileId)) {
    throw new Error("XIAOMI_ACTIVITY_FILE_ID_MISMATCH");
  }
  if (body[7] !== 0) throw new Error("XIAOMI_ACTIVITY_PADDING");
}

export type XiaomiStepMinute = Readonly<{
  /** Minute start, epoch milliseconds. */
  timestamp: number;
  steps: number;
}>;

export type XiaomiDailyDetails = Readonly<{
  granularity: "minute";
  minutes: readonly XiaomiStepMinute[];
}>;

export type XiaomiDailySummary = Readonly<{
  granularity: "daily";
  /** Day start, epoch milliseconds. */
  timestamp: number;
  steps: number;
}>;

/**
 * Bit-packed reader for `DailyDetails` records. Mirrors upstream
 * `XiaomiComplexActivityParser`: each header nibble describes one group; bit 3
 * means the group exists, bits 2..0 mean fields 0..2 exist.
 */
class ComplexActivityReader {
  private currentGroup = -1;
  private currentGroupBits = 0;
  private currentValue = 0;

  constructor(
    private readonly header: Uint8Array,
    private readonly reader: ByteReader,
  ) {}

  nextGroup(nBits: number): boolean {
    this.currentGroup += 1;
    if (this.currentGroup >= this.header.length * 2) {
      this.consume(nBits);
      return false;
    }
    const nibble = this.currentNibble();
    if ((nibble & 8) === 0) return false;
    this.currentGroupBits = nBits;
    this.currentValue = this.consume(nBits);
    return (nibble & 8) !== 0;
  }

  hasFirst(): boolean {
    return this.isValid(0);
  }

  hasSecond(): boolean {
    return this.isValid(1);
  }

  hasThird(): boolean {
    return this.isValid(2);
  }

  get(index: number, nBits: number): number {
    const shift = this.currentGroupBits - index - nBits;
    if (shift < 0) throw new Error("XIAOMI_ACTIVITY_BIT_RANGE");
    return (this.currentValue & (((1 << nBits) - 1) << shift)) >>> shift;
  }

  private isValid(index: number): boolean {
    return (this.currentNibble() & (1 << (2 - index))) !== 0;
  }

  private currentNibble(): number {
    const byte = this.header[Math.floor(this.currentGroup / 2)] ?? 0;
    return this.currentGroup % 2 === 0 ? (byte & 0xf0) >> 4 : byte & 0x0f;
  }

  private consume(nBits: number): number {
    switch (nBits) {
      case 8:
        return this.reader.getU8();
      case 16:
        return this.reader.getU16();
      case 32:
        return this.reader.getU32();
      default:
        throw new Error("XIAOMI_ACTIVITY_GROUP_BITS");
    }
  }
}

/** Parses a `DailyDetails` file into one step record per minute. */
export function parseXiaomiDailyDetails(
  bytes: Uint8Array,
  fileId: XiaomiActivityFileId,
): XiaomiDailyDetails {
  const body = verifyFileCrc(bytes);
  verifyFileId(body, fileId);

  const headerSize =
    fileId.version === 1 || fileId.version === 2
      ? 4
      : fileId.version === 3
        ? 5
        : fileId.version === 4
          ? 6
          : null;
  if (headerSize === null) throw new Error("XIAOMI_ACTIVITY_VERSION");

  const reader = new ByteReader(body, 8);
  const header = reader.take(headerSize);
  const minutes: XiaomiStepMinute[] = [];
  let timestamp = fileId.timestamp * 1000;
  while (reader.remaining > 0) {
    const complex = new ComplexActivityReader(header, reader);
    let steps = 0;
    let includeExtraEntry = 0;

    if (complex.nextGroup(16)) {
      if (complex.hasSecond()) includeExtraEntry = complex.get(1, 1);
      if (complex.hasThird()) steps = complex.get(2, 14);
    }
    if (complex.nextGroup(8)) {
      // active calories, not needed for steps
    }
    complex.nextGroup(8);
    if (complex.nextGroup(16)) {
      // distance, not needed for steps
    }
    if (complex.nextGroup(8)) {
      // heart rate, not needed for steps
    }
    if (complex.nextGroup(8)) {
      // energy, not needed for steps
    }
    complex.nextGroup(16);
    if (fileId.version >= 3) {
      complex.nextGroup(8);
      complex.nextGroup(8);
    }
    if (includeExtraEntry === 1) reader.skip(1);
    if (fileId.version >= 4) {
      complex.nextGroup(16);
      complex.nextGroup(16);
    }

    minutes.push({ timestamp, steps });
    timestamp += 60_000;
  }
  return { granularity: "minute", minutes };
}

const SUMMARY_SLOT_SIZES: readonly number[] = [
  4, 2, 1, 1, 1, 4, 1, 4, 1, 1, 1, 1, 3, 2, 2, 1, 1, 4, 1, 4, 1, 2, 2, 1, 1, 1, 1, 2, 1, 1, 2, 2,
];

/** Parses a `DailySummary` file into the day's total steps. */
export function parseXiaomiDailySummary(
  bytes: Uint8Array,
  fileId: XiaomiActivityFileId,
): XiaomiDailySummary {
  const body = verifyFileCrc(bytes);
  verifyFileId(body, fileId);

  const headerSize =
    fileId.version === 3 || fileId.version === 4 ? 3 : fileId.version === 5 ? 4 : null;
  if (headerSize === null) throw new Error("XIAOMI_ACTIVITY_VERSION");
  const slotCount = fileId.version === 5 ? 32 : 21;

  const reader = new ByteReader(body, 8);
  const header = reader.take(headerSize);
  let steps = 0;
  for (let slot = 0; slot < slotCount; slot += 1) {
    const size = SUMMARY_SLOT_SIZES[slot]!;
    if (slot === 0) {
      const value = reader.getU32();
      if ((header[0]! & 0x80) !== 0) steps = value;
    } else {
      reader.skip(size);
    }
  }
  return { granularity: "daily", timestamp: fileId.timestamp * 1000, steps };
}
