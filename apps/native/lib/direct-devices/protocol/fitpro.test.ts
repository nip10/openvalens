/**
 * Codec tests for the FitPro protocol.
 *
 * Vectors are taken from the packet comments in Gadgetbridge's
 * `FitProConstants.java` / `FitProDeviceSupport.java` at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  FITPRO_CMD_FETCH_TRIGGER,
  FITPRO_GROUP_GENERAL,
  FITPRO_GROUP_RECEIVE_SPORTS_DATA,
  FITPRO_HEADER,
  FITPRO_HEADER_LENGTH,
  FITPRO_MAX_PAYLOAD_LENGTH,
  FITPRO_STEPS_INTERVAL_MS,
  announcedLength,
  assembleSleepSessions,
  buildAck,
  buildFetchTriggerPacket,
  buildFrame,
  buildHeartRateMeasurementPacket,
  buildInitPackets,
  buildSetTimePacket,
  createFitProReassembler,
  decodeFitProDate,
  frameLength,
  parseAck,
  parseFrame,
  parseHeartRatePacket,
  parseSleepHistory,
  parseSleepPacket,
  parseStepsPacket,
} from "./fitpro";

function bytes(values: readonly number[]): Uint8Array {
  return Uint8Array.from(values);
}

function hex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

/** Packs the 2-byte date the per-day packets start with. */
function packDate(year: number, month: number, day: number): number[] {
  const packed = ((year - 2000) << 9) | (month << 5) | day;
  return [(packed >> 8) & 0xff, packed & 0xff];
}

/** Builds one 8-byte step record from its decoded fields. */
function stepRecord(fields: {
  steps: number;
  durationUnits: number;
  distanceMeters: number;
  calories: number;
  activityKind: number;
  timeUnits: number;
}): number[] {
  const high =
    ((fields.steps & 0xfff) << 20) |
    ((fields.durationUnits & 0xf) << 16) |
    (fields.distanceMeters & 0xffff);
  const low =
    ((fields.timeUnits & 0x7ff) << 21) |
    ((fields.activityKind & 0x1) << 19) |
    (fields.calories & 0x7ffff);
  return [
    (high >>> 24) & 0xff,
    (high >>> 16) & 0xff,
    (high >>> 8) & 0xff,
    high & 0xff,
    (low >>> 24) & 0xff,
    (low >>> 16) & 0xff,
    (low >>> 8) & 0xff,
    low & 0xff,
  ];
}

/** Builds one 4-byte sleep record: stage kind plus minutes of day. */
function sleepRecord(kind: number, minutesOfDay: number): number[] {
  const data = ((minutesOfDay & 0xffff) << 16) | (kind & 0xff);
  return [(data >>> 24) & 0xff, (data >>> 16) & 0xff, (data >>> 8) & 0xff, data & 0xff];
}

const DAY = packDate(2026, 11, 10);
/** The two bytes upstream never reads between the date and the first record. */
const GAP = [0x00, 0x00];

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

test("frames carry the 0xCD header and a fullLen of total-3", () => {
  // Upstream's own fetch trigger: cd 00 06 15 01 06 00 01 01
  expect(hex(buildFetchTriggerPacket())).toBe("cd 00 06 15 01 06 00 01 01");
  // Upstream init: cd 00 06 12 01 0a 00 01 02
  expect(hex(buildFrame(FITPRO_GROUP_GENERAL, 0x0a, [0x02]))).toBe("cd 00 06 12 01 0a 00 01 02");
  // Upstream init query with no payload: cd 00 05 1a 01 0a 00 00
  expect(hex(buildFrame(0x1a, 0x0a))).toBe("cd 00 05 1a 01 0a 00 00");
  // Upstream clock set: cd 00 09 12 01 01 00 04 a5 83 73 db
  expect(hex(buildFrame(0x12, 0x01, [0xa5, 0x83, 0x73, 0xdb]))).toBe(
    "cd 00 09 12 01 01 00 04 a5 83 73 db",
  );

  const frame = buildFrame(
    0x15,
    0x08,
    Array.from({ length: 300 }, () => 0x41),
  );
  expect(frame[0]).toBe(FITPRO_HEADER);
  expect((frame[1]! << 8) | frame[2]!).toBe(frame.length - 3);
  expect((frame[6]! << 8) | frame[7]!).toBe(300);
  expect(frame[4]).toBe(0x01);
  expect(frame.length).toBe(FITPRO_HEADER_LENGTH + 300);
});

test("buildFrame rejects a payload that cannot fit the 16-bit length field", () => {
  expect(() => buildFrame(0x15, 0x02, new Uint8Array(FITPRO_MAX_PAYLOAD_LENGTH + 1))).toThrow(
    RangeError,
  );
  expect(() => buildFrame(0x15, 0x02, new Uint8Array(FITPRO_MAX_PAYLOAD_LENGTH))).not.toThrow();
});

test("parseFrame round-trips group, command and payload", () => {
  const frame = buildFrame(0x15, 0x02, [1, 2, 3, 4]);
  expect(parseFrame(frame)).toEqual({
    group: 0x15,
    command: 0x02,
    payload: bytes([1, 2, 3, 4]),
  });
  expect(frameLength(parseFrame(frame)!)).toBe(frame.length);
});

test("parseFrame rejects a bad header, a bad delimiter and a lying length", () => {
  const frame = buildFrame(0x15, 0x02, [1, 2]);
  const badHeader = frame.slice();
  badHeader[0] = 0xfe;
  expect(parseFrame(badHeader)).toBeNull();

  const badDelimiter = frame.slice();
  badDelimiter[4] = 0x02;
  expect(parseFrame(badDelimiter)).toBeNull();

  const badFullLength = frame.slice();
  badFullLength[2] = (badFullLength[2]! + 1) & 0xff;
  expect(parseFrame(badFullLength)).toBeNull();

  const badPayloadLength = frame.slice();
  badPayloadLength[7] = (badPayloadLength[7]! + 1) & 0xff;
  expect(parseFrame(badPayloadLength)).toBeNull();

  expect(parseFrame(frame.subarray(0, frame.length - 1))).toBeNull();
  expect(parseFrame(bytes([0xcd, 0x00]))).toBeNull();
});

test("announcedLength reads fullLen+3 and rejects foreign headers", () => {
  const frame = buildFrame(0x15, 0x02, [1, 2, 3]);
  expect(announcedLength(frame)).toBe(frame.length);
  expect(announcedLength(frame.subarray(0, 3))).toBe(frame.length);
  expect(announcedLength(bytes([0xdc, 0x00, 0x05]))).toBeNull();
  expect(announcedLength(bytes([0xcd, 0x00]))).toBeNull();
});

test("the reassembler joins fragments and splits several frames from one notification", () => {
  const reassembler = createFitProReassembler();
  const payload = Array.from({ length: 40 }, () => 0x11);
  const frame = buildFrame(0x15, 0x08, payload);

  expect(reassembler.push(frame.subarray(0, 20))).toEqual([]);
  expect(reassembler.push(frame.subarray(20, 40))).toEqual([]);
  const frames = reassembler.push(frame.subarray(40));
  expect(frames).toHaveLength(1);
  expect(frames[0]).toMatchObject({ group: 0x15, command: 0x08 });
  expect([...frames[0]!.payload]).toEqual(payload);

  const first = buildFrame(0x15, 0x07, [0x01]);
  const second = buildFrame(0x15, 0x10, [0x01]);
  const merged = new Uint8Array(first.length + second.length);
  merged.set(first, 0);
  merged.set(second, first.length);
  expect(reassembler.push(merged).map((item) => item.command)).toEqual([0x07, 0x10]);

  // A notification that does not start with the header resets the buffer.
  expect(reassembler.push(bytes([0x00, 0x01, 0x02]))).toEqual([]);
  expect(reassembler.push(frame)).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Acknowledgements
// ---------------------------------------------------------------------------

test("acks are DC 00 05 group 01 lenHi lenLo 01 with the incoming total length", () => {
  // Upstream ack for a 12-byte frame: dc 00 05 1a 01 00 0c 01
  expect(hex(buildAck(0x1a, 0x0c))).toBe("dc 00 05 1a 01 00 0c 01");
  expect(hex(buildAck(0x15, 20))).toBe("dc 00 05 15 01 00 14 01");

  const frame = buildFrame(
    0x15,
    0x0e,
    Array.from({ length: 12 }, () => 0x00),
  );
  expect(frame.length).toBe(20);
  const ack = buildAck(parseFrame(frame)!.group, frameLength(parseFrame(frame)!));
  expect(parseAck(ack)).toEqual({ group: 0x15, length: 20 });
  // The ack length field is the incoming fullLen + 3.
  expect((ack[5]! << 8) | ack[6]!).toBe(((frame[1]! << 8) | frame[2]!) + 3);
});

test("parseAck rejects malformed acknowledgements", () => {
  const ack = buildAck(0x1a, 12);
  const badHeader = ack.slice();
  badHeader[0] = 0xcd;
  expect(parseAck(badHeader)).toBeNull();
  const badFixed = ack.slice();
  badFixed[2] = 0x06;
  expect(parseAck(badFixed)).toBeNull();
  const badDelimiter = ack.slice();
  badDelimiter[7] = 0x00;
  expect(parseAck(badDelimiter)).toBeNull();
  expect(parseAck(ack.subarray(0, 7))).toBeNull();
  expect(() => buildAck(0x15, 2)).toThrow(RangeError);
});

// ---------------------------------------------------------------------------
// Command builders
// ---------------------------------------------------------------------------

test("the fetch trigger is 0x15/0x06 with payload 01", () => {
  const packet = buildFetchTriggerPacket();
  expect(parseFrame(packet)).toMatchObject({
    group: FITPRO_GROUP_RECEIVE_SPORTS_DATA,
    command: FITPRO_CMD_FETCH_TRIGGER,
  });
  expect([...parseFrame(packet)!.payload]).toEqual([0x01]);
});

test("the clock packet packs the local calendar into four bytes", () => {
  const now = new Date(2026, 10, 10, 15, 42, 7);
  const packet = buildSetTimePacket(now);
  expect(parseFrame(packet)).toMatchObject({ group: 0x12, command: 0x01 });
  const payload = parseFrame(packet)!.payload;
  const packed =
    ((payload[0]! << 24) | (payload[1]! << 16) | (payload[2]! << 8) | payload[3]!) >>> 0;
  expect(packed & 0x3f).toBe(7); // second
  expect((packed >>> 6) & 0x3f).toBe(42); // minute
  expect((packed >>> 12) & 0x1f).toBe(15); // hour
  expect((packed >>> 17) & 0x1f).toBe(10); // day
  expect((packed >>> 22) & 0x0f).toBe(11); // month
  expect((packed >>> 26) & 0x3f).toBe(26); // year - 2000
});

test("the init sequence primes the band without writing user settings", () => {
  const packets = buildInitPackets(new Date(2026, 10, 10, 12, 0, 0));
  expect(packets.map((packet) => [packet[3], packet[5]])).toEqual([
    [0x12, 0x0a],
    [0x12, 0x01],
    [0x1a, 0x0a],
    [0x1a, 0x0c],
    [0x12, 0xff],
    [0x1a, 0x01],
    [0x1a, 0x0f],
    [0x1a, 0x10],
    [0x20, 0x02],
  ]);
  // Language (0x12/0x15), user data (0x12/0x04) and step goal (0x12/0x03) are
  // write-only settings and are deliberately absent.
  const general = packets.filter((packet) => packet[3] === 0x12).map((packet) => packet[5]);
  expect(general).not.toContain(0x15);
  expect(general).not.toContain(0x04);
  expect(general).not.toContain(0x03);
});

test("realtime heart rate is enabled with 0x12/0x18", () => {
  const on = buildHeartRateMeasurementPacket(true);
  expect(hex(on)).toBe("cd 00 06 12 01 18 00 01 01");
  expect(parseFrame(buildHeartRateMeasurementPacket(false))!.payload[0]).toBe(0);
});

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

test("the packed date decodes day, month and year", () => {
  expect(decodeFitProDate(Uint8Array.from(DAY))).toEqual({ year: 2026, month: 11, day: 10 });
  expect(decodeFitProDate(Uint8Array.from([0x00, 0x00]))).toBeNull(); // month 0
  expect(decodeFitProDate(Uint8Array.from([0x00, 0x01]))).toBeNull(); // day 0
  expect(decodeFitProDate(Uint8Array.from([0x00]))).toBeNull();
});

// ---------------------------------------------------------------------------
// Step packets
// ---------------------------------------------------------------------------

test("a step record decodes the 64-bit bitfield exactly", () => {
  const record = stepRecord({
    steps: 120,
    durationUnits: 1,
    distanceMeters: 90,
    calories: 5,
    activityKind: 1,
    timeUnits: 40,
  });
  // Hand-computed: steps 0x078, duration 0x1, distance 0x005A, time 0x028,
  // activity bit 19, calories 0x00005.
  expect(hex(Uint8Array.from(record))).toBe("07 81 00 5a 05 08 00 05");

  const packet = parseStepsPacket(Uint8Array.from([...DAY, ...GAP, ...record]));
  expect(packet?.date).toEqual({ year: 2026, month: 11, day: 10 });
  expect(packet?.buckets).toHaveLength(1);
  const bucket = packet!.buckets[0]!;
  expect(bucket).toMatchObject({
    timeUnits: 40,
    durationUnits: 1,
    distanceMeters: 90,
    calories: 5,
    activityKind: 1,
  });
  const start = new Date(2026, 10, 10, 10, 0, 0);
  expect(bucket.record).toEqual({
    type: "steps_interval",
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + FITPRO_STEPS_INTERVAL_MS).toISOString(),
    count: 120,
  });
});

test("a step packet yields one 15-minute bucket per record and skips padding", () => {
  const first = stepRecord({
    steps: 12,
    durationUnits: 1,
    distanceMeters: 8,
    calories: 1,
    activityKind: 0,
    timeUnits: 0,
  });
  const second = stepRecord({
    steps: 300,
    durationUnits: 2,
    distanceMeters: 240,
    calories: 15,
    activityKind: 1,
    timeUnits: 95, // 23:45
  });
  const padding = Array.from({ length: 8 }, () => 0);
  const payload = Uint8Array.from([...DAY, ...GAP, ...first, ...padding, ...second]);
  const packet = parseStepsPacket(payload);
  expect(packet?.buckets).toHaveLength(2);
  expect(packet?.buckets.map((bucket) => bucket.record.count)).toEqual([12, 300]);
  expect(packet?.buckets[1]!.record.startTime).toBe(
    new Date(2026, 10, 10, 23, 45, 0).toISOString(),
  );
  expect(packet?.buckets[1]!.record.endTime).toBe(new Date(2026, 10, 11, 0, 0, 0).toISOString());
  expect(packet?.buckets[1]!.durationUnits).toBe(2);
});

test("a truncated step record is ignored and a bad date rejects the packet", () => {
  const record = stepRecord({
    steps: 5,
    durationUnits: 1,
    distanceMeters: 4,
    calories: 1,
    activityKind: 0,
    timeUnits: 1,
  });
  const packet = parseStepsPacket(Uint8Array.from([...DAY, ...GAP, ...record, 0x01, 0x02, 0x03]));
  expect(packet?.buckets).toHaveLength(1);
  expect(parseStepsPacket(Uint8Array.from([0x00, 0x00, ...GAP, ...record]))).toBeNull();
  expect(parseStepsPacket(Uint8Array.from([0x35]))).toBeNull();
});

// ---------------------------------------------------------------------------
// Sleep packets
// ---------------------------------------------------------------------------

test("sleep records decode stage starts and shift past midnight", () => {
  const payload = Uint8Array.from([
    ...DAY,
    ...GAP,
    ...sleepRecord(2, 23 * 60), // light 23:00
    ...sleepRecord(1, 23 * 60 + 15), // deep 23:15
    ...sleepRecord(2, 15), // light 00:15 the next day
    ...sleepRecord(1, 30), // deep 00:30
  ]);
  const packet = parseSleepPacket(payload);
  expect(packet?.date).toEqual({ year: 2026, month: 11, day: 10 });
  expect(packet?.starts).toEqual([
    { stage: "light", startTime: new Date(2026, 10, 10, 23, 0).toISOString() },
    { stage: "deep", startTime: new Date(2026, 10, 10, 23, 15).toISOString() },
    { stage: "light", startTime: new Date(2026, 10, 11, 0, 15).toISOString() },
    { stage: "deep", startTime: new Date(2026, 10, 11, 0, 30).toISOString() },
  ]);
});

test("sleep stage kinds map like upstream's sample provider", () => {
  const payload = Uint8Array.from([
    ...DAY,
    ...GAP,
    ...sleepRecord(1, 60),
    ...sleepRecord(2, 75),
    ...sleepRecord(0, 90),
    ...sleepRecord(7, 105),
  ]);
  expect(parseSleepPacket(payload)?.starts.map((start) => start.stage)).toEqual([
    "deep",
    "light",
    "awake",
    "awake",
  ]);
});

test("sleep records with an impossible minutes-of-day are skipped", () => {
  const payload = Uint8Array.from([...DAY, ...GAP, ...sleepRecord(1, 1500), ...sleepRecord(1, 60)]);
  expect(parseSleepPacket(payload)?.starts).toHaveLength(1);
  expect(parseSleepPacket(Uint8Array.from([0x00, 0x00, ...GAP, ...sleepRecord(1, 60)]))).toBeNull();
});

test("sleep starts assemble into a session with stages", () => {
  const starts = [
    { stage: "light" as const, startTime: new Date(2026, 10, 10, 23, 0).toISOString() },
    { stage: "deep" as const, startTime: new Date(2026, 10, 11, 0, 0).toISOString() },
    { stage: "light" as const, startTime: new Date(2026, 10, 11, 1, 0).toISOString() },
    { stage: "awake" as const, startTime: new Date(2026, 10, 11, 2, 0).toISOString() },
    { stage: "light" as const, startTime: new Date(2026, 10, 11, 2, 15).toISOString() },
    { stage: "deep" as const, startTime: new Date(2026, 10, 11, 6, 0).toISOString() },
    { stage: "awake" as const, startTime: new Date(2026, 10, 11, 7, 0).toISOString() },
  ];
  const sessions = assembleSleepSessions(starts);
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({
    type: "sleep_session",
    startTime: new Date(2026, 10, 10, 23, 0).toISOString(),
    endTime: new Date(2026, 10, 11, 7, 0).toISOString(),
  });
  expect(sessions[0]!.stages?.map((stage) => stage.stage)).toEqual([
    "light",
    "deep",
    "light",
    "awake",
    "light",
    "deep",
  ]);
  expect(sessions[0]!.stages?.[3]).toMatchObject({
    startTime: new Date(2026, 10, 11, 2, 0).toISOString(),
    endTime: new Date(2026, 10, 11, 2, 15).toISOString(),
  });
});

test("a wake phase longer than an hour splits the night into two sessions", () => {
  const starts = [
    { stage: "light" as const, startTime: new Date(2026, 10, 10, 23, 0).toISOString() },
    { stage: "awake" as const, startTime: new Date(2026, 10, 11, 0, 0).toISOString() },
    { stage: "light" as const, startTime: new Date(2026, 10, 11, 2, 0).toISOString() },
  ];
  const sessions = assembleSleepSessions(starts);
  expect(sessions).toHaveLength(2);
  expect(sessions[0]).toMatchObject({
    startTime: new Date(2026, 10, 10, 23, 0).toISOString(),
    endTime: new Date(2026, 10, 11, 0, 0).toISOString(),
  });
  expect(sessions[1]).toMatchObject({
    startTime: new Date(2026, 10, 11, 2, 0).toISOString(),
    endTime: new Date(2026, 10, 11, 2, 15).toISOString(),
  });
});

test("sessions of five minutes or less are discarded and the last record keeps its 15-minute window", () => {
  const short = assembleSleepSessions([
    { stage: "light", startTime: new Date(2026, 10, 10, 23, 0).toISOString() },
    { stage: "awake", startTime: new Date(2026, 10, 10, 23, 3).toISOString() },
  ]);
  expect(short).toEqual([]);

  const single = assembleSleepSessions([
    { stage: "deep", startTime: new Date(2026, 10, 10, 23, 0).toISOString() },
  ]);
  // A lone record still gets its fixed 15-minute window, which is longer than
  // the five-minute floor.
  expect(single).toHaveLength(1);
  expect(single[0]).toMatchObject({
    startTime: new Date(2026, 10, 10, 23, 0).toISOString(),
    endTime: new Date(2026, 10, 10, 23, 15).toISOString(),
  });

  const two = assembleSleepSessions([
    { stage: "deep", startTime: new Date(2026, 10, 10, 23, 0).toISOString() },
    { stage: "light", startTime: new Date(2026, 10, 10, 23, 15).toISOString() },
  ]);
  expect(two).toHaveLength(1);
  expect(two[0]).toMatchObject({
    startTime: new Date(2026, 10, 10, 23, 0).toISOString(),
    endTime: new Date(2026, 10, 10, 23, 30).toISOString(),
  });
});

test("parseSleepHistory returns sessions from a raw packet", () => {
  const payload = Uint8Array.from([
    ...DAY,
    ...GAP,
    ...sleepRecord(2, 23 * 60),
    ...sleepRecord(1, 23 * 60 + 30),
    ...sleepRecord(2, 60),
    ...sleepRecord(1, 5 * 60),
  ]);
  const sessions = parseSleepHistory(payload);
  expect(sessions).toHaveLength(1);
  expect(sessions[0]!.stages?.length).toBeGreaterThan(1);
  expect(parseSleepHistory(Uint8Array.from([0x00, 0x00]))).toEqual([]);
});

// ---------------------------------------------------------------------------
// Heart rate
// ---------------------------------------------------------------------------

test("realtime heart rate reads hr from value[19] and seconds from value[12..15]", () => {
  // Upstream comment: 0xcd 0x00 0x11 0x15 0x01 0x0e 0x00 0x0c 0x2a 0xf8 0x00
  // 0x01 0x00 0x00 0x31 0x2c 0x62 0x75 0x54 0x47
  const frame = Uint8Array.from([
    0xcd, 0x00, 0x11, 0x15, 0x01, 0x0e, 0x00, 0x0c, 0x2a, 0xf8, 0x00, 0x01, 0x00, 0x00, 0x31, 0x2c,
    0x62, 0x75, 0x54, 0x47,
  ]);
  const parsed = parseFrame(frame)!;
  expect(parsed.group).toBe(0x15);
  expect(parsed.command).toBe(0x0e);
  const reference = new Date(2026, 10, 10, 9, 0, 0);
  const heartRate = parseHeartRatePacket(parsed.payload, { reference });
  expect(heartRate).toEqual({
    seconds: 0x312c,
    bpm: 0x47,
    time: new Date(2026, 10, 10, 3, 29, 48).toISOString(),
  });
  // spo2 upstream reads from value[13] — inside the seconds field — so it is
  // not part of the parsed result at all.
  expect(heartRate).not.toHaveProperty("spo2");

  // Second upstream sample: seconds 0x00014394, hr 0x53.
  const second = Uint8Array.from([
    0xcd, 0x00, 0x11, 0x15, 0x01, 0x0e, 0x00, 0x0c, 0x2b, 0x04, 0x00, 0x01, 0x00, 0x01, 0x43, 0x94,
    0x62, 0x5c, 0x48, 0x53,
  ]);
  expect(parseHeartRatePacket(parseFrame(second)!.payload, { reference })).toEqual({
    seconds: 0x00014394,
    bpm: 0x53,
    time: new Date(2026, 10, 10, 23, 0, 36).toISOString(),
  });
});

test("heart-rate packets that are short, out of range or zero are rejected", () => {
  const reference = new Date(2026, 10, 10, 9, 0, 0);
  expect(parseHeartRatePacket(new Uint8Array(11), { reference })).toBeNull();

  const zero = new Uint8Array(12);
  zero[11] = 0;
  expect(parseHeartRatePacket(zero, { reference })).toBeNull();

  const outOfRange = new Uint8Array(12);
  outOfRange[4] = 0x00;
  outOfRange[5] = 0x02;
  outOfRange[11] = 70; // 0x00020000 = 131072 s > one day
  expect(parseHeartRatePacket(outOfRange, { reference })).toBeNull();
});
