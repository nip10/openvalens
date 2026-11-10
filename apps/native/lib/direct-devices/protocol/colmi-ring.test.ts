/**
 * Protocol vectors for the Colmi / Yawell ring codec.
 *
 * Derived from Gadgetbridge's Yawell ring support at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  SLEEP_HISTORY_REQUEST,
  buildActivityHistoryRequestPacket,
  buildBatteryRequestPacket,
  buildBigDataV2Packet,
  buildDateTimePacket,
  buildHeartRateHistoryRequestPacket,
  buildPacket,
  buildPhoneNamePacket,
  buildRealtimeHeartRatePacket,
  buildUserPreferencesPacket,
  checksum8,
  createColmiV2Reassembler,
  createHeartRateHistoryAccumulator,
  crc16Modbus,
  decodeDecimalAsHex,
  encodeDecimalAsHex,
  parseActivityHistoryPacket,
  parseBatteryResponse,
  parseRealtimeHeartRate,
  parseSleepBigData,
} from "./colmi-ring";

function u16le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

// ---------------------------------------------------------------------------
// Packet building
// ---------------------------------------------------------------------------

test("buildPacket pads to 16 bytes and appends the additive checksum", () => {
  const battery = buildPacket(0x03);
  expect(battery).toHaveLength(16);
  expect(Array.from(battery.slice(0, 2))).toEqual([0x03, 0x00]);
  expect(battery[15]).toBe(0x03);
  expect(battery[15]).toBe(checksum8(battery));

  const realtime = buildPacket(0x1e, [0x01]);
  expect(Array.from(realtime.slice(0, 3))).toEqual([0x1e, 0x01, 0x00]);
  expect(realtime[15]).toBe(0x1f);

  // 0xFF * 15 wraps at 8 bits: 15 * 255 = 3825 & 0xFF = 0xF1.
  const full = buildPacket(
    0xff,
    Array.from({ length: 15 }, () => 0xff),
  );
  expect(full[15]).toBe(0xf1);
});

test("buildPacket rejects payloads longer than 15 bytes", () => {
  expect(() =>
    buildPacket(
      0x01,
      Array.from({ length: 16 }, () => 0),
    ),
  ).toThrow(RangeError);
});

test("CRC-16/MODBUS matches independent check values", () => {
  // Standard check value for "123456789".
  expect(crc16Modbus(Uint8Array.from(Buffer.from("123456789")))).toBe(0x4b37);
  // Independent value for the bytes 0x31..0x34 ("1234").
  expect(crc16Modbus(Uint8Array.from([0x31, 0x32, 0x33, 0x34]))).toBe(0x30ba);
  expect(crc16Modbus(Uint8Array.from([0xff]))).toBe(0x00ff);
});

test("the upstream sleep request is a big-data frame with a valid CRC", () => {
  expect([...SLEEP_HISTORY_REQUEST]).toEqual([0xbc, 0x27, 0x01, 0x00, 0xff, 0x00, 0xff]);
  expect([...buildBigDataV2Packet(0x27, Uint8Array.of(0xff))]).toEqual([...SLEEP_HISTORY_REQUEST]);
});

test("V2 reassembly buffers a frame split across two notifications", () => {
  const payload = Uint8Array.from([2, 1, 12, 0x64, 0x05, 0xa4, 0x01, 0x02, 0x78, 0x03]);
  const frame = buildBigDataV2Packet(0x27, payload);
  const reassembler = createColmiV2Reassembler();

  expect(reassembler.push(frame.slice(0, 4))).toEqual([]);
  const frames = reassembler.push(frame.slice(4));
  expect(frames).toHaveLength(1);
  expect(frames[0]!.type).toBe(0x27);
  expect([...frames[0]!.payload]).toEqual([...payload]);
});

test("V2 reassembly drops frames with a bad CRC and resynchronises", () => {
  const payload = Uint8Array.from([1, 0, 6, 0x3c, 0x00, 0x3c, 0x00]);
  const good = buildBigDataV2Packet(0x27, payload);
  const bad = Uint8Array.from(good);
  bad[4] = bad[4]! ^ 0xff;
  const reassembler = createColmiV2Reassembler();
  expect(reassembler.push(bad)).toEqual([]);
  const frames = reassembler.push(good);
  expect(frames).toHaveLength(1);
  expect([...frames[0]!.payload]).toEqual([...payload]);
});

// ---------------------------------------------------------------------------
// Init commands
// ---------------------------------------------------------------------------

test("decimal-as-hex encoding stores decimal digits in a hex byte", () => {
  expect(encodeDecimalAsHex(26)).toBe(0x26);
  expect(encodeDecimalAsHex(11)).toBe(0x11);
  expect(encodeDecimalAsHex(10)).toBe(0x10);
  expect(encodeDecimalAsHex(5)).toBe(0x05);
  expect(encodeDecimalAsHex(23)).toBe(0x23);
  expect(decodeDecimalAsHex(0x26)).toBe(26);
  expect(decodeDecimalAsHex(0x11)).toBe(11);
  expect(decodeDecimalAsHex(0x0a)).toBeNull();
  expect(decodeDecimalAsHex(0x1a)).toBeNull();
});

test("the date/time packet encodes 2026-11-10 23:04:05 as decimal-as-hex", () => {
  const packet = buildDateTimePacket(new Date(2026, 10, 10, 23, 4, 5));
  expect(Array.from(packet.slice(0, 7))).toEqual([0x01, 0x26, 0x11, 0x10, 0x23, 0x04, 0x05]);
  expect(packet[15]).toBe(checksum8(packet));
});

test("phone name, user preferences and battery packets match upstream layouts", () => {
  expect(Array.from(buildPhoneNamePacket().slice(0, 5))).toEqual([0x04, 0x02, 0x0a, 0x47, 0x42]);
  expect(
    Array.from(
      buildUserPreferencesPacket({
        distanceUnit: 0,
        gender: 1,
        age: 30,
        heightCm: 175,
        weightKg: 70,
      }).slice(0, 10),
    ),
  ).toEqual([0x0a, 0x02, 0x00, 0x00, 0x01, 30, 175, 70, 0x00, 0x00]);
  expect(Array.from(buildBatteryRequestPacket().slice(0, 2))).toEqual([0x03, 0x00]);
});

test("history requests match upstream byte layouts", () => {
  expect(Array.from(buildActivityHistoryRequestPacket(3).slice(0, 6))).toEqual([
    0x43, 0x03, 0x0f, 0x00, 0x5f, 0x01,
  ]);
  const dayStart = new Date(Date.UTC(2026, 0, 1));
  expect(Array.from(buildHeartRateHistoryRequestPacket(dayStart).slice(0, 6))).toEqual([
    0x15, 0x00, 0xb9, 0x55, 0x69, 0x00,
  ]);
  expect(Array.from(buildRealtimeHeartRatePacket(true).slice(0, 2))).toEqual([0x1e, 0x01]);
  expect(Array.from(buildRealtimeHeartRatePacket(false).slice(0, 2))).toEqual([0x1e, 0x02]);
});

// ---------------------------------------------------------------------------
// Realtime heart rate and battery
// ---------------------------------------------------------------------------

test("realtime heart rate parses 1E <bpm> and rejects zero", () => {
  expect(parseRealtimeHeartRate(Uint8Array.from([0x1e, 72]))).toBe(72);
  expect(parseRealtimeHeartRate(Uint8Array.from([0x1e, 0]))).toBeNull();
  expect(parseRealtimeHeartRate(Uint8Array.from([0x1f, 72]))).toBeNull();
  expect(parseRealtimeHeartRate(Uint8Array.from([0x1e]))).toBeNull();
});

test("battery response parses percent and charging flag", () => {
  expect(parseBatteryResponse(Uint8Array.from([0x03, 87, 1]))).toEqual({
    percent: 87,
    charging: true,
  });
  expect(parseBatteryResponse(Uint8Array.from([0x03, 87, 0]))).toEqual({
    percent: 87,
    charging: false,
  });
  expect(parseBatteryResponse(Uint8Array.from([0x03, 101]))).toBeNull();
  expect(parseBatteryResponse(Uint8Array.from([0x04, 87]))).toBeNull();
});

// ---------------------------------------------------------------------------
// Activity history
// ---------------------------------------------------------------------------

function activityPacket(input: {
  year: number;
  month: number;
  day: number;
  quarter: number;
  packetNumber: number;
  totalPackets: number;
  calories: number;
  steps: number;
  distance: number;
}): Uint8Array {
  return Uint8Array.from([
    0x43,
    encodeDecimalAsHex(input.year % 2000),
    encodeDecimalAsHex(input.month),
    encodeDecimalAsHex(input.day),
    input.quarter,
    input.packetNumber,
    input.totalPackets,
    ...u16le(input.calories),
    ...u16le(input.steps),
    ...u16le(input.distance),
  ]);
}

test("activity history maps one quarter-hour packet to a steps_interval", () => {
  const packet = parseActivityHistoryPacket(
    activityPacket({
      year: 2026,
      month: 11,
      day: 10,
      quarter: 40,
      packetNumber: 0,
      totalPackets: 1,
      calories: 100,
      steps: 250,
      distance: 180,
    }),
  );
  expect(packet?.kind).toBe("interval");
  if (packet?.kind !== "interval") return;
  expect(packet.done).toBe(true);
  expect(packet.calories).toBe(100);
  expect(packet.distanceMeters).toBe(180);
  expect(packet.interval).toEqual({
    type: "steps_interval",
    startTime: new Date(2026, 10, 10, 10, 0, 0).toISOString(),
    endTime: new Date(2026, 10, 10, 10, 15, 0).toISOString(),
    count: 250,
  });
});

test("activity quarter index maps to the correct hour and minute", () => {
  const packet = parseActivityHistoryPacket(
    activityPacket({
      year: 2026,
      month: 11,
      day: 10,
      quarter: 41,
      packetNumber: 1,
      totalPackets: 3,
      calories: 0,
      steps: 12,
      distance: 9,
    }),
  );
  expect(packet?.kind).toBe("interval");
  if (packet?.kind !== "interval") return;
  expect(packet.done).toBe(false);
  expect(packet.interval.startTime).toBe(new Date(2026, 10, 10, 10, 15, 0).toISOString());
});

test("activity history reports empty and no-data markers", () => {
  expect(parseActivityHistoryPacket(Uint8Array.from([0x43, 0xff, ...Array(11).fill(0)]))).toEqual({
    kind: "empty",
  });
  expect(parseActivityHistoryPacket(Uint8Array.from([0x43, 0xf0, ...Array(11).fill(0)]))).toEqual({
    kind: "no_data",
  });
  expect(
    parseActivityHistoryPacket(
      Uint8Array.from([0x43, 0x0a, 0x11, 0x10, 0, 0, 1, ...Array(6).fill(0)]),
    ),
  ).toBeNull();
  expect(parseActivityHistoryPacket(Uint8Array.from([0x44, 0, 0]))).toBeNull();
});

// ---------------------------------------------------------------------------
// Heart-rate history
// ---------------------------------------------------------------------------

const SYNC_FROM = Date.UTC(2026, 0, 1) / 1000;

function heartRatePacket(packetNumber: number, values: readonly number[]): Uint8Array {
  if (packetNumber === 0) return Uint8Array.from([0x15, 0x00, values[0] ?? 0]);
  if (packetNumber === 1) return Uint8Array.from([0x15, 0x01, ...u32le(SYNC_FROM), ...values]);
  return Uint8Array.from([0x15, packetNumber, ...values]);
}

test("heart-rate history header and packet 1 establish the five-minute cursor", () => {
  const accumulator = createHeartRateHistoryAccumulator({
    now: () => new Date((SYNC_FROM + 3600) * 1000),
  });
  const header = accumulator.push(heartRatePacket(0, [3]));
  expect(header).toMatchObject({ packetNumber: 0, totalPackets: 3, done: false, empty: false });

  const first = accumulator.push(heartRatePacket(1, [60, 0, 62, 0, 0, 0, 0, 0, 0]));
  expect(first?.samples).toEqual([
    { type: "heart_rate", time: new Date(SYNC_FROM * 1000).toISOString(), bpm: 60 },
    {
      type: "heart_rate",
      time: new Date((SYNC_FROM + 10 * 60) * 1000).toISOString(),
      bpm: 62,
    },
  ]);
  expect(first?.done).toBe(false);
});

test("heart-rate history later packets continue the cursor from packet 1", () => {
  const accumulator = createHeartRateHistoryAccumulator({
    now: () => new Date((SYNC_FROM + 3600) * 1000),
  });
  accumulator.push(heartRatePacket(0, [3]));
  accumulator.push(heartRatePacket(1, [60, 0, 0, 0, 0, 0, 0, 0, 0]));
  const second = accumulator.push(heartRatePacket(2, [63, 64]));
  expect(second?.samples).toEqual([
    {
      type: "heart_rate",
      time: new Date((SYNC_FROM + 9 * 5 * 60) * 1000).toISOString(),
      bpm: 63,
    },
    {
      type: "heart_rate",
      time: new Date((SYNC_FROM + 10 * 5 * 60) * 1000).toISOString(),
      bpm: 64,
    },
  ]);
  expect(second?.done).toBe(false);
  const third = accumulator.push(heartRatePacket(3, [65]));
  expect(third?.done).toBe(true);
});

test("heart-rate history skips future-timestamped values", () => {
  const accumulator = createHeartRateHistoryAccumulator({
    now: () => new Date((SYNC_FROM + 6 * 60) * 1000),
  });
  const first = accumulator.push(heartRatePacket(1, [60, 61, 62]));
  // +0 and +5 min are in the past; +10 min is in the future.
  expect(first?.samples.map((sample) => sample.bpm)).toEqual([60, 61]);
});

test("heart-rate history reports the empty marker", () => {
  const accumulator = createHeartRateHistoryAccumulator();
  expect(accumulator.push(Uint8Array.from([0x15, 0xff]))).toMatchObject({
    empty: true,
    done: true,
    samples: [],
  });
});

// ---------------------------------------------------------------------------
// Sleep big data
// ---------------------------------------------------------------------------

function sleepDay(input: {
  daysAgo: number;
  sleepStart: number;
  sleepEnd: number;
  stages: readonly (readonly [number, number])[];
}): number[] {
  const stageBytes = input.stages.flatMap(([type, duration]) => [type, duration]);
  return [
    input.daysAgo,
    6 + stageBytes.length,
    ...u16le(input.sleepStart),
    ...u16le(input.sleepEnd),
    ...stageBytes,
  ];
}

test("sleep big data parses multi-day sessions with stage intervals", () => {
  const payload = Uint8Array.from([
    2,
    ...sleepDay({
      daysAgo: 1,
      sleepStart: 1380,
      sleepEnd: 420,
      stages: [
        [0x02, 120],
        [0x03, 90],
        [0x04, 60],
      ],
    }),
    ...sleepDay({ daysAgo: 0, sleepStart: 60, sleepEnd: 120, stages: [[0x05, 30]] }),
  ]);
  const sessions = parseSleepBigData(payload, { today: new Date(2026, 10, 10, 12, 0, 0) });

  expect(sessions).toHaveLength(2);
  // sleepStart (23:00) > sleepEnd (07:00): the session began the previous day.
  expect(sessions[0]).toEqual({
    type: "sleep_session",
    startTime: new Date(2026, 10, 8, 23, 0, 0).toISOString(),
    endTime: new Date(2026, 10, 9, 7, 0, 0).toISOString(),
    stages: [
      {
        stage: "light",
        startTime: new Date(2026, 10, 8, 23, 0, 0).toISOString(),
        endTime: new Date(2026, 10, 9, 1, 0, 0).toISOString(),
      },
      {
        stage: "deep",
        startTime: new Date(2026, 10, 9, 1, 0, 0).toISOString(),
        endTime: new Date(2026, 10, 9, 2, 30, 0).toISOString(),
      },
      {
        stage: "rem",
        startTime: new Date(2026, 10, 9, 2, 30, 0).toISOString(),
        endTime: new Date(2026, 10, 9, 3, 30, 0).toISOString(),
      },
    ],
  });
  expect(sessions[1]).toEqual({
    type: "sleep_session",
    startTime: new Date(2026, 10, 10, 1, 0, 0).toISOString(),
    endTime: new Date(2026, 10, 10, 2, 0, 0).toISOString(),
    stages: [
      {
        stage: "awake",
        startTime: new Date(2026, 10, 10, 1, 0, 0).toISOString(),
        endTime: new Date(2026, 10, 10, 1, 30, 0).toISOString(),
      },
    ],
  });
});

test("sleep big data clips stages to the session end and skips unknown types", () => {
  const payload = Uint8Array.from([
    1,
    ...sleepDay({
      daysAgo: 0,
      sleepStart: 60,
      sleepEnd: 90,
      stages: [
        [0x02, 20],
        [0x09, 5],
        [0x03, 40],
      ],
    }),
  ]);
  const sessions = parseSleepBigData(payload, { today: new Date(2026, 10, 10, 12, 0, 0) });
  expect(sessions).toHaveLength(1);
  // Unknown stage type advances the cursor but emits nothing; the deep stage
  // is clipped at the 90-minute session end.
  expect(sessions[0]!.stages).toEqual([
    {
      stage: "light",
      startTime: new Date(2026, 10, 10, 1, 0, 0).toISOString(),
      endTime: new Date(2026, 10, 10, 1, 20, 0).toISOString(),
    },
    {
      stage: "deep",
      startTime: new Date(2026, 10, 10, 1, 25, 0).toISOString(),
      endTime: new Date(2026, 10, 10, 1, 30, 0).toISOString(),
    },
  ]);
});

test("sleep big data tolerates a truncated day record", () => {
  const payload = Uint8Array.from([1, 0, 40, 0x3c, 0x00, 0x5a, 0x00]);
  expect(parseSleepBigData(payload, { today: new Date(2026, 10, 10) })).toEqual([]);
  expect(parseSleepBigData(Uint8Array.from([]), {})).toEqual([]);
});
