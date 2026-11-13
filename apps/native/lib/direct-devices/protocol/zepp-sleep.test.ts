import { expect, test } from "bun:test";

import { ZEPP_SLEEP_RECORD_BYTES, parseZeppSleepSessions } from "./zepp-sleep";

/** One 594-byte record: report time, midnight boundary, and stages (start, end, type). */
function record(reportTime: number, midnight: number, stages: readonly [number, number, number][]) {
  const bytes = new Uint8Array(ZEPP_SLEEP_RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint32(0x00, reportTime, true);
  view.setUint32(0x04, midnight, true);
  bytes[0x08] = 1;
  bytes[0x09] = 1;
  bytes[0x54] = stages.length;
  stages.forEach(([start, end, type], index) => {
    view.setUint16(0x56 + 5 * index, start, true);
    view.setUint16(0x56 + 5 * index + 2, end, true);
    bytes[0x56 + 5 * index + 4] = type;
  });
  return bytes;
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const MIDNIGHT = Date.UTC(2026, 10, 6) / 1000; // 2026-11-06T00:00Z

test("stages are offsets from midnight − 24 h with inclusive end minutes", () => {
  // base = 2026-11-05T00:00Z; 1380 min = 23:00. Light, deep, REM, then awake.
  const { sessions, lastReportTime } = parseZeppSleepSessions(
    record(MIDNIGHT + 8 * 3600, MIDNIGHT, [
      [1380, 1439, 4],
      [1440, 1499, 5],
      [1500, 1529, 8],
      [1530, 1534, 7],
    ]),
  );
  expect(lastReportTime).toBe(MIDNIGHT + 8 * 3600);
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({
    midnight: MIDNIGHT,
    startTime: "2026-11-05T23:00:00.000Z",
    endTime: "2026-11-06T01:35:00.000Z",
  });
  expect(sessions[0]!.stages).toEqual([
    { stage: "light", startTime: "2026-11-05T23:00:00.000Z", endTime: "2026-11-06T00:00:00.000Z" },
    { stage: "deep", startTime: "2026-11-06T00:00:00.000Z", endTime: "2026-11-06T01:00:00.000Z" },
    { stage: "rem", startTime: "2026-11-06T01:00:00.000Z", endTime: "2026-11-06T01:30:00.000Z" },
    { stage: "awake", startTime: "2026-11-06T01:30:00.000Z", endTime: "2026-11-06T01:35:00.000Z" },
  ]);
});

test("a later report of the same night replaces the earlier one; stageless records are skipped", () => {
  const { sessions, lastReportTime } = parseZeppSleepSessions(
    concat(
      record(MIDNIGHT + 7 * 3600, MIDNIGHT, [[1380, 1439, 4]]),
      record(MIDNIGHT + 9 * 3600, MIDNIGHT, [[1370, 1480, 9]]), // revised bounds, unknown type
      record(MIDNIGHT + 10 * 3600, MIDNIGHT + 86_400, []), // no stages
    ),
  );
  expect(lastReportTime).toBe(MIDNIGHT + 10 * 3600);
  expect(sessions).toHaveLength(1);
  expect(sessions[0]!.reportTime).toBe(MIDNIGHT + 9 * 3600);
  // An unknown stage type has no contract stage: it bounds the session but is not listed.
  expect(sessions[0]).toMatchObject({
    startTime: "2026-11-05T22:50:00.000Z",
    endTime: "2026-11-06T00:41:00.000Z",
    stages: [],
  });
});

test("a nap and the night of the same day stay separate; only overlapping reports replace", () => {
  const { sessions } = parseZeppSleepSessions(
    concat(
      record(MIDNIGHT + 8 * 3600, MIDNIGHT, [[1380, 1439, 4]]), // night 23:00–24:00
      record(MIDNIGHT + 15 * 3600, MIDNIGHT, [[1440 + 780, 1440 + 819, 4]]), // nap 13:00–13:40
    ),
  );
  expect(sessions.map((session) => [session.startTime, session.endTime])).toEqual([
    ["2026-11-05T23:00:00.000Z", "2026-11-06T00:00:00.000Z"],
    ["2026-11-06T13:00:00.000Z", "2026-11-06T13:40:00.000Z"],
  ]);
});

test("touching stages are clipped so the listed stages never overlap", () => {
  const { sessions } = parseZeppSleepSessions(
    record(MIDNIGHT + 8 * 3600, MIDNIGHT, [
      [1380, 1400, 4],
      [1400, 1420, 5], // shares minute 1400 with the previous stage
    ]),
  );
  expect(sessions[0]!.stages).toEqual([
    { stage: "light", startTime: "2026-11-05T23:00:00.000Z", endTime: "2026-11-05T23:20:00.000Z" },
    { stage: "deep", startTime: "2026-11-05T23:20:00.000Z", endTime: "2026-11-05T23:41:00.000Z" },
  ]);
});

test("a transfer that is not a whole number of records is refused", () => {
  expect(() => parseZeppSleepSessions(new Uint8Array(ZEPP_SLEEP_RECORD_BYTES + 1))).toThrow(
    "ZEPP_SLEEP_LENGTH_INVALID",
  );
  expect(parseZeppSleepSessions(new Uint8Array(0))).toEqual({ sessions: [], lastReportTime: null });
});

test("a stage enclosing a shorter one keeps its remainder after it", () => {
  const { sessions } = parseZeppSleepSessions(
    record(MIDNIGHT + 8 * 3600, MIDNIGHT, [
      [1380, 1439, 4], // light 23:00–24:00
      [1400, 1409, 5], // deep 23:20–23:30 inside it
    ]),
  );
  expect(sessions[0]!.stages).toEqual([
    { stage: "light", startTime: "2026-11-05T23:00:00.000Z", endTime: "2026-11-05T23:20:00.000Z" },
    { stage: "deep", startTime: "2026-11-05T23:20:00.000Z", endTime: "2026-11-05T23:30:00.000Z" },
    { stage: "light", startTime: "2026-11-05T23:30:00.000Z", endTime: "2026-11-06T00:00:00.000Z" },
  ]);
});
