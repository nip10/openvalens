/**
 * Protocol vectors for the Bangle.js / Espruino codec.
 *
 * Derived from Gadgetbridge's Bangle.js support at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  BANGLE_JS_BUCKET_MS,
  BANGLE_JS_DLE,
  BANGLE_JS_MTU_REQUEST,
  BangleJsLineAssembler,
  actSampleToRecords,
  buildActFetch,
  buildGbFrame,
  buildRealtimeDisable,
  buildRealtimeEnable,
  buildTimeSet,
  chunk,
  parseActFetchCount,
  parseActFetchState,
  parseActPacket,
  parseBangleJsLine,
  realtimeSampleToHeartRate,
} from "./bangle-js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function text(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Feeds a UTF-8 string through the assembler in one notification. */
function linesOf(input: string): string[] {
  return new BangleJsLineAssembler().push(encoder.encode(input));
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

test("buildGbFrame wraps JSON in DLE + GB( … ) + LF", () => {
  const frame = buildGbFrame('{"t":"actfetch","ts":1}');
  expect(frame[0]).toBe(BANGLE_JS_DLE);
  expect(text(frame)).toBe('\u0010GB({"t":"actfetch","ts":1})\n');
  expect(frame).toHaveLength('{"t":"actfetch","ts":1}'.length + 6);
  expect(frame[frame.length - 1]).toBe(0x0a);
});

test("buildActFetch serializes the millisecond cursor", () => {
  expect(text(buildActFetch(1_700_000_000_000))).toBe(
    '\u0010GB({"t":"actfetch","ts":1700000000000})\n',
  );
  // Fractional milliseconds are truncated, not rounded.
  expect(text(buildActFetch(1_700_000_000_999.7))).toBe(
    '\u0010GB({"t":"actfetch","ts":1700000000999})\n',
  );
  expect(() => buildActFetch(Number.NaN)).toThrow("BANGLE_JS_INVALID_TIMESTAMP");
});

test("realtime enable and disable frames match upstream", () => {
  expect(text(buildRealtimeEnable())).toBe(
    '\u0010GB({"t":"act","hrm":true,"stp":false,"int":10})\n',
  );
  expect(text(buildRealtimeDisable())).toBe(
    '\u0010GB({"t":"act","hrm":false,"stp":false,"int":0})\n',
  );
  expect(text(buildRealtimeEnable(30))).toBe(
    '\u0010GB({"t":"act","hrm":true,"stp":false,"int":30})\n',
  );
});

test("buildTimeSet emits raw Espruino JavaScript, not JSON", () => {
  const frame = buildTimeSet(1_700_000_000, -5);
  expect(frame[0]).toBe(BANGLE_JS_DLE);
  expect(text(frame)).toBe("\u0010setTime(1700000000);E.setTimeZone(-5);\n");
  expect(text(buildTimeSet(1, 5.5))).toBe("\u0010setTime(1);E.setTimeZone(5.5);\n");
  expect(text(buildTimeSet(1, 0))).toBe("\u0010setTime(1);E.setTimeZone(0);\n");
  expect(() => buildTimeSet(Number.NaN, 0)).toThrow("BANGLE_JS_INVALID_TIME");
});

test("chunk splits at the MTU and keeps the frame intact", () => {
  const frame = buildGbFrame('{"t":"actfetch","ts":1}');
  const chunks = chunk(frame, 20);
  expect(chunks.length).toBe(Math.ceil(frame.length / 20));
  expect(chunks.every((part) => part.length <= 20)).toBe(true);
  const joined = new Uint8Array(chunks.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of chunks) {
    joined.set(part, offset);
    offset += part.length;
  }
  expect([...joined]).toEqual([...frame]);

  expect(chunk(frame, 1)).toHaveLength(frame.length);
  expect(chunk(new Uint8Array(0), 20)).toEqual([]);
  expect(() => chunk(frame, 0)).toThrow("BANGLE_JS_INVALID_MTU");
  expect(() => chunk(frame, 1.5)).toThrow("BANGLE_JS_INVALID_MTU");
  // The upstream MTU request is a constant, not the write chunk size.
  expect(BANGLE_JS_MTU_REQUEST).toBe(131);
});

// ---------------------------------------------------------------------------
// Line reassembly
// ---------------------------------------------------------------------------

test("the assembler splits lines, strips CR, and drops XON/XOFF", () => {
  const assembler = new BangleJsLineAssembler();
  expect(assembler.push(encoder.encode('{"t":"act","ts":1}\r\n'))).toEqual(['{"t":"act","ts":1}']);
  // Flow control bytes may appear anywhere, including inside a line.
  expect(assembler.push(encoder.encode('\u0011{"t":"act",\u0013"ts":2}\r\n'))).toEqual([
    '{"t":"act","ts":2}',
  ]);
  // Empty lines are ignored.
  expect(assembler.push(encoder.encode("\r\n\n"))).toEqual([]);
});

test("a line split across notifications is reassembled", () => {
  const assembler = new BangleJsLineAssembler();
  const line = '{"t":"act","ts":1700000000000,"stp":12,"hrm":61,"mov":3,"rt":0}\r\n';
  const bytes = encoder.encode(line);
  const cut = 17;
  expect(assembler.push(bytes.slice(0, cut))).toEqual([]);
  expect(assembler.push(bytes.slice(cut, cut + 5))).toEqual([]);
  expect(assembler.push(bytes.slice(cut + 5))).toEqual([line.slice(0, -2)]);
});

test("several lines in one notification are all returned", () => {
  expect(linesOf('{"t":"act","ts":1}\r\n{"t":"act","ts":2}\r\n')).toEqual([
    '{"t":"act","ts":1}',
    '{"t":"act","ts":2}',
  ]);
});

test("a partial line is retained until its newline arrives", () => {
  const assembler = new BangleJsLineAssembler();
  expect(assembler.push(encoder.encode('{"t":"act"'))).toEqual([]);
  expect(assembler.push(encoder.encode(',"ts":1}\n'))).toEqual(['{"t":"act","ts":1}']);
  assembler.reset();
  expect(assembler.push(encoder.encode('"ts":2}\n'))).toEqual(['"ts":2}']);
});

// ---------------------------------------------------------------------------
// Line parsing
// ---------------------------------------------------------------------------

test("only JSON objects with a string t key are accepted", () => {
  expect(parseBangleJsLine('{"t":"act","ts":1}')).toEqual({ t: "act", ts: 1 });
  // Espruino log output and non-JSON lines are ignored.
  expect(parseBangleJsLine("Bangle.js 2 ready")).toBeNull();
  expect(parseBangleJsLine("")).toBeNull();
  expect(parseBangleJsLine("{not json}")).toBeNull();
  expect(parseBangleJsLine("[1,2,3]")).toBeNull();
  expect(parseBangleJsLine('"string"')).toBeNull();
  // JSON without a `t` key is rejected.
  expect(parseBangleJsLine('{"ts":1}')).toBeNull();
  expect(parseBangleJsLine('{"t":5}')).toBeNull();
  expect(parseBangleJsLine('{"t":""}')).toBeNull();
});

// ---------------------------------------------------------------------------
// act parsing
// ---------------------------------------------------------------------------

test("parseActPacket reads ts, stp, hrm, mov, act and rt", () => {
  expect(
    parseActPacket({
      t: "act",
      ts: 1_700_000_000_000,
      stp: 12,
      hrm: 61,
      mov: 3,
      act: "walking",
      rt: 0,
    }),
  ).toEqual({
    timestamp: 1_700_000_000_000,
    steps: 12,
    heartRate: 61,
    intensity: 3,
    activity: "walking",
    realtime: false,
  });
});

test("parseActPacket treats missing and zero fields as absent", () => {
  expect(parseActPacket({ t: "act", ts: 1_700_000_000_000, stp: 0, hrm: 0, rt: 0 })).toEqual({
    timestamp: 1_700_000_000_000,
    steps: 0,
    heartRate: null,
    intensity: null,
    activity: null,
    realtime: false,
  });
  expect(parseActPacket({ t: "act", ts: 1_700_000_000_000, stp: -1, rt: 0 })).toMatchObject({
    steps: null,
    heartRate: null,
  });
  // Realtime samples are flagged, not filtered, by the parser.
  expect(parseActPacket({ t: "act", ts: 1_700_000_000_000, hrm: 70, rt: 1 })).toMatchObject({
    realtime: true,
    heartRate: 70,
  });
});

test("parseActPacket rejects other packets and unusable timestamps", () => {
  expect(parseActPacket({ t: "actfetch", ts: 1 })).toBeNull();
  expect(parseActPacket({ t: "act", ts: 0 })).toBeNull();
  expect(parseActPacket({ t: "act", ts: -5 })).toBeNull();
  expect(parseActPacket({ t: "act" })).toBeNull();
  expect(parseActPacket({ t: "act", ts: "1700" })).toBeNull();
});

test("actfetch state and count are read from the reply", () => {
  expect(parseActFetchState({ t: "actfetch", state: "end", count: 3 })).toBe("end");
  expect(parseActFetchState({ t: "actfetch", state: "start" })).toBe("start");
  expect(parseActFetchState({ t: "actfetch" })).toBeNull();
  expect(parseActFetchState({ t: "act" })).toBeNull();
  expect(parseActFetchCount({ t: "actfetch", state: "end", count: 3 })).toBe(3);
  expect(parseActFetchCount({ t: "actfetch", state: "end" })).toBeNull();
  expect(parseActFetchCount({ t: "actfetch", state: "end", count: -1 })).toBeNull();
});

// ---------------------------------------------------------------------------
// Record conversion
// ---------------------------------------------------------------------------

test("a stored sample becomes a 10-minute bucket ending at ts", () => {
  const ts = Date.parse("2026-02-01T10:10:00.000Z");
  const records = actSampleToRecords({
    timestamp: ts,
    steps: 42,
    heartRate: 61,
    intensity: 4,
    activity: null,
    realtime: false,
  });
  expect(records).toEqual([
    {
      type: "steps_interval",
      startTime: new Date(ts - BANGLE_JS_BUCKET_MS).toISOString(),
      endTime: new Date(ts).toISOString(),
      count: 42,
    },
    { type: "heart_rate", time: new Date(ts).toISOString(), bpm: 61 },
  ]);
  // The bucket is exactly ten minutes wide and ends at the device timestamp.
  const steps = records[0]!;
  if (steps.type === "steps_interval")
    expect(Date.parse(steps.endTime) - Date.parse(steps.startTime)).toBe(600_000);
});

test("a stored sample with only steps yields only a steps interval", () => {
  const ts = Date.parse("2026-02-01T10:10:00.000Z");
  expect(
    actSampleToRecords({
      timestamp: ts,
      steps: 0,
      heartRate: null,
      intensity: null,
      activity: null,
      realtime: false,
    }),
  ).toEqual([
    {
      type: "steps_interval",
      startTime: new Date(ts - BANGLE_JS_BUCKET_MS).toISOString(),
      endTime: new Date(ts).toISOString(),
      count: 0,
    },
  ]);
});

test("realtime samples never become stored records", () => {
  const sample = {
    timestamp: Date.parse("2026-02-01T10:10:00.000Z"),
    steps: 5,
    heartRate: 72,
    intensity: null,
    activity: null,
    realtime: true,
  };
  expect(actSampleToRecords(sample)).toEqual([]);
  expect(realtimeSampleToHeartRate(sample)).toEqual({
    type: "heart_rate",
    time: new Date(sample.timestamp).toISOString(),
    bpm: 72,
  });
  expect(realtimeSampleToHeartRate({ ...sample, realtime: false })).toBeNull();
  expect(realtimeSampleToHeartRate({ ...sample, heartRate: null })).toBeNull();
});
