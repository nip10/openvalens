/**
 * Protocol vectors for the Moyoung / Da Fit codec.
 *
 * Derived from Gadgetbridge's Moyoung support at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  MOYOUNG_CMD_QUERY_PAST_HEART_RATE_1MIN,
  MOYOUNG_CMD_QUERY_PAST_HEART_RATE_5MIN,
  MOYOUNG_CMD_SYNC_PAST_SLEEP_AND_STEP,
  MOYOUNG_CMD_SYNC_SLEEP,
  MOYOUNG_CMD_SYNC_TIME,
  MOYOUNG_HR_1MIN_PACKET_COUNT,
  MOYOUNG_HR_5MIN_PACKET_COUNT,
  assembleSleepSessions,
  buildHeartRateHistoryPacket,
  buildPacket,
  buildPastSleepPacket,
  buildSleepTodayPacket,
  buildSyncTimePacket,
  buildTodayHeartRatePacket,
  createMoyoungReassembler,
  fragmentPacket,
  localTimeToWatchTime,
  parseHeartRateHistoryPacket,
  parsePacket,
  parsePacketLength,
  parseSleepHistory,
  parseSleepStages,
  parseTodayHeartRatePacket,
  sleepDaysAgoOffset,
  type MoyoungSleepStageStart,
} from "./moyoung";

function bytes(packet: Uint8Array): number[] {
  return Array.from(packet);
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

test("legacy framing (mtu 20) writes the constant 16 size high byte", () => {
  expect(bytes(buildPacket(20, MOYOUNG_CMD_SYNC_SLEEP))).toEqual([0xfe, 0xea, 0x10, 0x05, 0x32]);
  expect(bytes(buildPacket(20, MOYOUNG_CMD_QUERY_PAST_HEART_RATE_1MIN, [19]))).toEqual([
    0xfe, 0xea, 0x10, 0x06, 0x36, 0x13,
  ]);
});

test("MTU framing writes 32 + (length >> 8) as the size high byte", () => {
  expect(bytes(buildPacket(508, MOYOUNG_CMD_SYNC_SLEEP))).toEqual([0xfe, 0xea, 0x20, 0x05, 0x32]);
  expect(bytes(buildPacket(508, MOYOUNG_CMD_SYNC_PAST_SLEEP_AND_STEP, [3]))).toEqual([
    0xfe, 0xea, 0x20, 0x06, 0x33, 0x03,
  ]);
  // A payload long enough to carry into the high byte: 0x0100 + 5 bytes.
  const long = buildPacket(508, 0x01, new Uint8Array(0x100));
  expect(long[2]).toBe(0x21);
  expect(long[3]).toBe(0x05);
  expect(long).toHaveLength(0x105);
});

test("parsePacketLength understands both framing modes and rejects corruption", () => {
  expect(parsePacketLength(Uint8Array.from([0xfe, 0xea, 0x10, 0x05]))).toBe(5);
  expect(parsePacketLength(Uint8Array.from([0xfe, 0xea, 0x20, 0x05]))).toBe(5);
  expect(parsePacketLength(Uint8Array.from([0xfe, 0xea, 0x21, 0x00]))).toBe(0x100);
  expect(parsePacketLength(Uint8Array.from([0xfe, 0xea, 0x1f, 0x05]))).toBeNull();
  expect(parsePacketLength(Uint8Array.from([0x00, 0xea, 0x20, 0x05]))).toBeNull();
  expect(parsePacketLength(Uint8Array.from([0xfe, 0xea, 0x20]))).toBeNull();
});

test("parsePacket splits the command byte from the payload", () => {
  expect(parsePacket(buildPacket(508, 0x36, [1, 2, 3]))).toEqual({
    command: 0x36,
    payload: Uint8Array.from([1, 2, 3]),
  });
  expect(parsePacket(Uint8Array.from([0xfe, 0xea, 0x20, 0x09, 0x36]))).toBeNull();
});

test("fragmentPacket splits at the MTU and keeps the last fragment short", () => {
  const packet = Uint8Array.from({ length: 10 }, (_, index) => index);
  expect(fragmentPacket(packet, 4).map((fragment) => fragment.length)).toEqual([4, 4, 2]);
  expect(fragmentPacket(packet, 20)).toHaveLength(1);
  expect(() => fragmentPacket(packet, 0)).toThrow(RangeError);
});

test("reassembly joins a packet split across two notifications", () => {
  const packet = buildPacket(508, MOYOUNG_CMD_QUERY_PAST_HEART_RATE_5MIN, [0]);
  const reassembler = createMoyoungReassembler();
  expect(reassembler.push(packet.slice(0, 4))).toBeNull();
  expect(reassembler.push(packet.slice(4))).toEqual({
    command: MOYOUNG_CMD_QUERY_PAST_HEART_RATE_5MIN,
    payload: Uint8Array.from([0]),
  });
});

test("reassembly joins a legacy packet split into 20-byte writes", () => {
  const payload = Uint8Array.from({ length: 80 }, (_, index) => (index * 7) & 0xff);
  const packet = buildPacket(20, MOYOUNG_CMD_SYNC_SLEEP, payload);
  const reassembler = createMoyoungReassembler();
  const fragments = fragmentPacket(packet, 20);
  let parsed = reassembler.push(fragments[0]!);
  for (const fragment of fragments.slice(1)) parsed = reassembler.push(fragment) ?? parsed;
  expect(parsed).toEqual({ command: MOYOUNG_CMD_SYNC_SLEEP, payload });
});

test("reassembly ignores a notification with a bad header", () => {
  const reassembler = createMoyoungReassembler();
  expect(reassembler.push(Uint8Array.from([0x00, 0x00, 0x20, 0x05]))).toBeNull();
});

// ---------------------------------------------------------------------------
// Command builders
// ---------------------------------------------------------------------------

test("sleep and heart-rate builders match upstream byte layouts", () => {
  expect(bytes(buildSleepTodayPacket(508))).toEqual([
    0xfe,
    0xea,
    0x20,
    0x05,
    MOYOUNG_CMD_SYNC_SLEEP,
  ]);
  expect(bytes(buildPastSleepPacket(508, 3))).toEqual([
    0xfe,
    0xea,
    0x20,
    0x06,
    MOYOUNG_CMD_SYNC_PAST_SLEEP_AND_STEP,
    0x03,
  ]);
  expect(bytes(buildPastSleepPacket(508, 4))).toEqual([
    0xfe,
    0xea,
    0x20,
    0x06,
    MOYOUNG_CMD_SYNC_PAST_SLEEP_AND_STEP,
    0x04,
  ]);
  expect(bytes(buildHeartRateHistoryPacket(508, 7))).toEqual([
    0xfe,
    0xea,
    0x20,
    0x06,
    MOYOUNG_CMD_QUERY_PAST_HEART_RATE_5MIN,
    0x07,
  ]);
  expect(bytes(buildTodayHeartRatePacket(508, 19))).toEqual([
    0xfe,
    0xea,
    0x20,
    0x06,
    MOYOUNG_CMD_QUERY_PAST_HEART_RATE_1MIN,
    0x13,
  ]);
  expect(() => buildPastSleepPacket(508, 1)).toThrow(RangeError);
  expect(() => buildPastSleepPacket(508, 2)).toThrow(RangeError);
});

test("the clock packet carries GMT+8 wall-clock seconds and a literal 0x08", () => {
  const now = new Date(2026, 10, 10, 12, 34, 56);
  const expected = Math.floor(Date.UTC(2026, 10, 10, 12, 34, 56) / 1000) - 8 * 60 * 60;
  expect(localTimeToWatchTime(now)).toBe(expected);
  const packet = buildSyncTimePacket(508, now);
  expect(packet[4]).toBe(MOYOUNG_CMD_SYNC_TIME);
  expect(packet[5]).toBe((expected >>> 24) & 0xff);
  expect(packet[6]).toBe((expected >>> 16) & 0xff);
  expect(packet[7]).toBe((expected >>> 8) & 0xff);
  expect(packet[8]).toBe(expected & 0xff);
  expect(packet[9]).toBe(0x08);
  expect(packet).toHaveLength(10);
});

// ---------------------------------------------------------------------------
// Sleep stages and sessions
// ---------------------------------------------------------------------------

const REFERENCE = new Date(2026, 10, 10, 12, 0, 0);

test("sleep stages parse type/hour/minute triples and shift evening stages back a day", () => {
  const payload = Uint8Array.from([1, 23, 0, 2, 1, 30, 3, 4, 0, 0, 6, 0]);
  const stages = parseSleepStages(payload, { daysAgo: 0, reference: REFERENCE });
  expect(stages).toEqual([
    { stage: "light", startTime: new Date(2026, 10, 9, 23, 0, 0).toISOString() },
    { stage: "deep", startTime: new Date(2026, 10, 10, 1, 30, 0).toISOString() },
    { stage: "rem", startTime: new Date(2026, 10, 10, 4, 0, 0).toISOString() },
    { stage: "awake", startTime: new Date(2026, 10, 10, 6, 0, 0).toISOString() },
  ]);
});

test("the day shift moves the whole block when daysAgo is set", () => {
  const payload = Uint8Array.from([1, 23, 0, 2, 1, 30]);
  expect(parseSleepStages(payload, { daysAgo: 1, reference: REFERENCE })).toEqual([
    { stage: "light", startTime: new Date(2026, 10, 8, 23, 0, 0).toISOString() },
    { stage: "deep", startTime: new Date(2026, 10, 9, 1, 30, 0).toISOString() },
  ]);
});

test("malformed payloads and unknown stages are skipped", () => {
  expect(parseSleepStages(Uint8Array.from([1, 23]), { daysAgo: 0, reference: REFERENCE })).toEqual(
    [],
  );
  expect(
    parseSleepStages(Uint8Array.from([9, 23, 0, 1, 24, 0, 1, 23, 60]), {
      daysAgo: 0,
      reference: REFERENCE,
    }),
  ).toEqual([]);
});

test("a trailing wake record closes the session without becoming a stage", () => {
  const stages = parseSleepStages(Uint8Array.from([1, 23, 0, 0, 6, 0]), {
    daysAgo: 0,
    reference: REFERENCE,
  });
  const sessions = assembleSleepSessions(stages);
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toEqual({
    type: "sleep_session",
    startTime: new Date(2026, 10, 9, 23, 0, 0).toISOString(),
    endTime: new Date(2026, 10, 10, 6, 0, 0).toISOString(),
    stages: [
      {
        stage: "light",
        startTime: new Date(2026, 10, 9, 23, 0, 0).toISOString(),
        endTime: new Date(2026, 10, 10, 6, 0, 0).toISOString(),
      },
    ],
  });
});

test("a short wake becomes an awake stage inside the session", () => {
  const starts: MoyoungSleepStageStart[] = [
    { stage: "light", startTime: new Date(2026, 10, 9, 23, 0).toISOString() },
    { stage: "awake", startTime: new Date(2026, 10, 10, 1, 0).toISOString() },
    { stage: "light", startTime: new Date(2026, 10, 10, 1, 10).toISOString() },
    { stage: "awake", startTime: new Date(2026, 10, 10, 7, 0).toISOString() },
  ];
  const sessions = assembleSleepSessions(starts);
  expect(sessions).toHaveLength(1);
  expect(sessions[0]!.stages?.map((stage) => stage.stage)).toEqual(["light", "awake", "light"]);
  expect(sessions[0]!.endTime).toBe(new Date(2026, 10, 10, 7, 0).toISOString());
});

test("a wake run longer than an hour closes the session and starts a new one", () => {
  const starts: MoyoungSleepStageStart[] = [
    { stage: "light", startTime: new Date(2026, 10, 9, 23, 0).toISOString() },
    { stage: "awake", startTime: new Date(2026, 10, 10, 1, 0).toISOString() },
    { stage: "deep", startTime: new Date(2026, 10, 10, 3, 0).toISOString() },
    { stage: "awake", startTime: new Date(2026, 10, 10, 7, 0).toISOString() },
  ];
  const sessions = assembleSleepSessions(starts);
  expect(sessions).toHaveLength(2);
  expect(sessions[0]).toMatchObject({
    startTime: new Date(2026, 10, 9, 23, 0).toISOString(),
    endTime: new Date(2026, 10, 10, 1, 0).toISOString(),
  });
  expect(sessions[1]).toMatchObject({
    startTime: new Date(2026, 10, 10, 3, 0).toISOString(),
    endTime: new Date(2026, 10, 10, 7, 0).toISOString(),
  });
});

test("sessions of five minutes or less are discarded", () => {
  const starts: MoyoungSleepStageStart[] = [
    { stage: "light", startTime: new Date(2026, 10, 9, 23, 0).toISOString() },
    { stage: "awake", startTime: new Date(2026, 10, 9, 23, 5).toISOString() },
  ];
  expect(assembleSleepSessions(starts)).toEqual([]);
});

test("a leading wake before the first sleep stage is outside the session", () => {
  const starts: MoyoungSleepStageStart[] = [
    { stage: "awake", startTime: new Date(2026, 10, 9, 22, 0).toISOString() },
    { stage: "light", startTime: new Date(2026, 10, 9, 23, 0).toISOString() },
    { stage: "awake", startTime: new Date(2026, 10, 10, 6, 0).toISOString() },
  ];
  const sessions = assembleSleepSessions(starts);
  expect(sessions).toHaveLength(1);
  expect(sessions[0]!.startTime).toBe(new Date(2026, 10, 9, 23, 0).toISOString());
  expect(sessions[0]!.stages?.map((stage) => stage.stage)).toEqual(["light"]);
});

test("multi-day payloads produce one session per night", () => {
  const payload = Uint8Array.from([1, 23, 0, 2, 2, 0, 0, 6, 0]);
  const today = parseSleepHistory(payload, { daysAgo: 0, reference: REFERENCE });
  const yesterday = parseSleepHistory(payload, { daysAgo: 1, reference: REFERENCE });
  expect(today).toHaveLength(1);
  expect(yesterday).toHaveLength(1);
  expect(today[0]!.startTime).toBe(new Date(2026, 10, 9, 23, 0).toISOString());
  expect(yesterday[0]!.startTime).toBe(new Date(2026, 10, 8, 23, 0).toISOString());
});

test("the sleep day offset follows upstream's 20:00 boundary", () => {
  expect(sleepDaysAgoOffset(new Date(2026, 10, 10, 19, 59))).toBe(0);
  expect(sleepDaysAgoOffset(new Date(2026, 10, 10, 20, 0))).toBe(1);
  expect(sleepDaysAgoOffset(new Date(2026, 10, 10, 23, 30))).toBe(1);
});

// ---------------------------------------------------------------------------
// Heart-rate history
// ---------------------------------------------------------------------------

function fiveMinutePacket(index: number, values: readonly number[]): Uint8Array {
  const payload = new Uint8Array(1 + 72);
  payload[0] = index;
  values.forEach((value, offset) => {
    payload[offset + 1] = value;
  });
  return payload;
}

function oneMinutePacket(index: number, values: readonly number[]): Uint8Array {
  const payload = new Uint8Array(1 + 72);
  payload[0] = index;
  values.forEach((value, offset) => {
    payload[offset + 1] = value;
  });
  return payload;
}

test("CMD 53 reconstructs two-day timestamps from the packet index", () => {
  const parsed = parseHeartRateHistoryPacket(fiveMinutePacket(4, [60, 0, 70]), {
    reference: REFERENCE,
    now: REFERENCE,
  });
  expect(parsed).toMatchObject({ packetIndex: 4, daysAgo: 1, startHour: 0 });
  expect(parsed?.samples).toEqual([
    { type: "heart_rate", time: new Date(2026, 10, 9, 0, 0).toISOString(), bpm: 60 },
    { type: "heart_rate", time: new Date(2026, 10, 9, 0, 10).toISOString(), bpm: 70 },
  ]);
});

test("CMD 53 maps the packet index to the right six-hour window", () => {
  const parsed = parseHeartRateHistoryPacket(fiveMinutePacket(3, [61]), {
    reference: REFERENCE,
    now: new Date(2026, 10, 10, 23, 59),
  });
  expect(parsed).toMatchObject({ daysAgo: 0, startHour: 18 });
  expect(parsed?.samples[0]).toEqual({
    type: "heart_rate",
    time: new Date(2026, 10, 10, 18, 0).toISOString(),
    bpm: 61,
  });
});

test("CMD 53 skips invalid values and future timestamps but keeps the cursor", () => {
  const parsed = parseHeartRateHistoryPacket(fiveMinutePacket(0, [9, 251, 60]), {
    reference: new Date(2026, 10, 10, 0, 15),
    now: new Date(2026, 10, 10, 0, 15),
  });
  expect(parsed?.samples).toEqual([
    { type: "heart_rate", time: new Date(2026, 10, 10, 0, 10).toISOString(), bpm: 60 },
  ]);
});

test("CMD 54 reconstructs today's minute-of-day timestamps", () => {
  const parsed = parseTodayHeartRatePacket(oneMinutePacket(2, [55, 0, 88]), {
    reference: REFERENCE,
    now: REFERENCE,
  });
  expect(parsed?.packetIndex).toBe(2);
  expect(parsed?.samples).toEqual([
    { type: "heart_rate", time: new Date(2026, 10, 10, 2, 24).toISOString(), bpm: 55 },
    { type: "heart_rate", time: new Date(2026, 10, 10, 2, 26).toISOString(), bpm: 88 },
  ]);
});

test("CMD 54 stops at midnight and ignores missing bytes", () => {
  const parsed = parseTodayHeartRatePacket(oneMinutePacket(19, [70, 71, 72]), {
    reference: REFERENCE,
    now: new Date(2026, 10, 11, 0, 30),
  });
  expect(parsed?.samples.map((sample) => sample.time)).toEqual([
    new Date(2026, 10, 10, 22, 48).toISOString(),
    new Date(2026, 10, 10, 22, 49).toISOString(),
    new Date(2026, 10, 10, 22, 50).toISOString(),
  ]);
  expect(parseTodayHeartRatePacket(oneMinutePacket(20, [70]), { now: REFERENCE })?.samples).toEqual(
    [],
  );
  expect(parseTodayHeartRatePacket(new Uint8Array(0))).toBeNull();
});

test("the packet-count constants match upstream's fetch loops", () => {
  expect(MOYOUNG_HR_5MIN_PACKET_COUNT).toBe(8);
  expect(MOYOUNG_HR_1MIN_PACKET_COUNT).toBe(20);
});
