/**
 * Tests for Xiaomi activity file ids and daily step parsers.
 *
 * The synthetic files mirror the upstream `DailyDetailsParser` and
 * `DailySummaryParser` layouts. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import { crc32 } from "./chunked";
import {
  decodeXiaomiActivityFileId,
  decodeXiaomiActivityFileIds,
  encodeXiaomiActivityFileId,
  parseXiaomiDailyDetails,
  parseXiaomiDailySummary,
  XIAOMI_ACTIVITY_DAILY,
  XIAOMI_ACTIVITY_TYPE,
  XIAOMI_DETAIL_DETAILS,
  XIAOMI_DETAIL_SUMMARY,
  type XiaomiActivityFileId,
} from "./xiaomi-activity";

function withCrc(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 4);
  out.set(body);
  const checksum = crc32(body);
  out[body.length] = checksum & 0xff;
  out[body.length + 1] = (checksum >>> 8) & 0xff;
  out[body.length + 2] = (checksum >>> 16) & 0xff;
  out[body.length + 3] = (checksum >>> 24) & 0xff;
  return out;
}

function fileId(overrides: Partial<XiaomiActivityFileId> = {}): XiaomiActivityFileId {
  return {
    timestamp: 1_700_000_000,
    timezone: 8,
    type: XIAOMI_ACTIVITY_TYPE,
    subtype: XIAOMI_ACTIVITY_DAILY,
    detailType: XIAOMI_DETAIL_DETAILS,
    version: 3,
    ...overrides,
  };
}

function detailsFile(id: XiaomiActivityFileId, records: Array<{ steps: number }>): Uint8Array {
  // Header: group 0 exists with only field 2 (steps) valid; all other groups absent.
  const header = Uint8Array.of(0x90, 0, 0, 0, 0);
  const body = new Uint8Array(7 + 1 + header.length + records.length * 2);
  body.set(encodeXiaomiActivityFileId(id), 0);
  body[7] = 0;
  body.set(header, 8);
  let offset = 8 + header.length;
  for (const record of records) {
    body[offset] = record.steps & 0xff;
    body[offset + 1] = (record.steps >>> 8) & 0xff;
    offset += 2;
  }
  return withCrc(body);
}

function summaryFile(id: XiaomiActivityFileId, steps: number): Uint8Array {
  const header = Uint8Array.of(0x80, 0, 0, 0);
  const slotBytesAfterSteps = 53;
  const body = new Uint8Array(7 + 1 + header.length + 4 + slotBytesAfterSteps);
  body.set(encodeXiaomiActivityFileId(id), 0);
  body[7] = 0;
  body.set(header, 8);
  const view = new DataView(body.buffer, body.byteOffset + 12, 4);
  view.setUint32(0, steps, true);
  return withCrc(body);
}

test("activity file ids round-trip the 7-byte layout", () => {
  const id = fileId({ version: 5, detailType: XIAOMI_DETAIL_SUMMARY });
  const bytes = encodeXiaomiActivityFileId(id);

  expect(bytes).toHaveLength(7);
  expect(decodeXiaomiActivityFileId(bytes)).toEqual(id);
  expect(decodeXiaomiActivityFileIds(new Uint8Array([...bytes, ...bytes]))).toEqual([id, id]);
});

test("activity file ids reject malformed lengths and fields", () => {
  expect(() => decodeXiaomiActivityFileIds(Uint8Array.of(1, 2, 3))).toThrow(
    "XIAOMI_FILE_ID_LENGTH",
  );
  expect(() => encodeXiaomiActivityFileId(fileId({ type: 2 }))).toThrow("XIAOMI_FILE_ID_TYPE");
  expect(() => encodeXiaomiActivityFileId(fileId({ subtype: 64 }))).toThrow(
    "XIAOMI_FILE_ID_SUBTYPE",
  );
});

test("DailyDetails yields one step record per minute", () => {
  const id = fileId();
  const parsed = parseXiaomiDailyDetails(detailsFile(id, [{ steps: 42 }, { steps: 7 }]), id);

  expect(parsed.granularity).toBe("minute");
  expect(parsed.minutes).toEqual([
    { timestamp: id.timestamp * 1000, steps: 42 },
    { timestamp: id.timestamp * 1000 + 60_000, steps: 7 },
  ]);
});

test("DailyDetails rejects a bad CRC, file id mismatch and unsupported version", () => {
  const id = fileId();
  const bytes = detailsFile(id, [{ steps: 1 }]);
  const corrupted = bytes.slice();
  corrupted[corrupted.length - 5] ^= 0xff;
  expect(() => parseXiaomiDailyDetails(corrupted, id)).toThrow("XIAOMI_ACTIVITY_CRC");

  expect(() => parseXiaomiDailyDetails(bytes, fileId({ timestamp: id.timestamp + 60 }))).toThrow(
    "XIAOMI_ACTIVITY_FILE_ID_MISMATCH",
  );
  const unsupported = detailsFile(fileId({ version: 9 }), [{ steps: 1 }]);
  expect(() => parseXiaomiDailyDetails(unsupported, fileId({ version: 9 }))).toThrow(
    "XIAOMI_ACTIVITY_VERSION",
  );
});

test("DailySummary yields the day's total steps", () => {
  const id = fileId({ version: 5, detailType: XIAOMI_DETAIL_SUMMARY });
  const parsed = parseXiaomiDailySummary(summaryFile(id, 1234), id);

  expect(parsed).toEqual({
    granularity: "daily",
    timestamp: id.timestamp * 1000,
    steps: 1234,
  });
});

test("DailySummary rejects a truncated record", () => {
  const id = fileId({ version: 5, detailType: XIAOMI_DETAIL_SUMMARY });
  const bytes = summaryFile(id, 1234);
  expect(() => parseXiaomiDailySummary(bytes.slice(0, 20), id)).toThrow("XIAOMI_ACTIVITY_CRC");
});
