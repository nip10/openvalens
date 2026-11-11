/**
 * Protocol vectors for the Casio CONVOY codec.
 *
 * Derived from Gadgetbridge's Casio support at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * (`AbstractCasioConvoyFetchOperation`, `gbx100/FetchStepCountDataOperation`,
 * `gbd200/FetchStepCountDataOperation`, `ggb100/FetchStepCountDataOperation`).
 * AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  CASIO_CONVOY_DATATYPE_CALORIES,
  CASIO_CONVOY_DATATYPE_STEPS,
  CASIO_LIFE_LOG_LENGTH,
  CASIO_NO_DATA16,
  CASIO_NO_DATA32,
  buildConvoyAck,
  buildConvoyRequest,
  decodeConvoyPayload,
  parseCasioSteps,
  parseConvoyEcho,
  parseLifeLog,
  parseStepsPacket,
  parseStepsTlv,
  stepsBinsToRecords,
  xorPayload,
} from "./casio";

function bytes(values: Uint8Array | readonly number[]): number[] {
  return Array.from(values);
}

function u16(value: number): [number, number] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function u32(value: number): [number, number, number, number] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
}

/** Builds a plain hourly-TLV payload (pre-XOR). */
function stepsPayload(options: {
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  totalSteps?: number;
  totalCalories?: number;
  finished?: boolean;
  steps?: readonly number[];
  calories?: readonly number[];
  extra?: readonly number[];
}): Uint8Array {
  const steps = options.steps ?? [];
  const calories = options.calories ?? [];
  const tlv: number[] = [];
  if (steps.length) {
    tlv.push(CASIO_CONVOY_DATATYPE_STEPS, ...u16(steps.length * 2), ...steps.flatMap(u16));
  }
  if (calories.length) {
    tlv.push(CASIO_CONVOY_DATATYPE_CALORIES, ...u16(calories.length * 2), ...calories.flatMap(u16));
  }
  const body = [
    0x00,
    0x00, // length placeholder
    (options.year ?? 2026) - 2000,
    options.month ?? 11,
    options.day ?? 10,
    options.hour ?? 12,
    options.minute ?? 30,
    ...u32(options.totalSteps ?? 0),
    ...u16(options.totalCalories ?? 0),
    // [13..16] unknown, [17] finished flag.
    0x00,
    0x00,
    0x00,
    0x00,
    options.finished ? 0x01 : 0x00,
    ...tlv,
    ...(options.extra ?? []),
  ];
  const length = body.length - 2;
  body[0] = length & 0xff;
  body[1] = (length >> 8) & 0xff;
  return Uint8Array.from(body);
}

const NOW = new Date(2026, 10, 10, 12, 0, 0);

// ---------------------------------------------------------------------------
// CONVOY frames
// ---------------------------------------------------------------------------

test("the request frame is 00 <feature> 00 00 00", () => {
  expect(bytes(buildConvoyRequest(0x11))).toEqual([0x00, 0x11, 0x00, 0x00, 0x00]);
  expect(bytes(buildConvoyRequest(0x19))).toEqual([0x00, 0x19, 0x00, 0x00, 0x00]);
});

test("the ACK frame is 04 <feature> 00 00 00", () => {
  expect(bytes(buildConvoyAck(0x11))).toEqual([0x04, 0x11, 0x00, 0x00, 0x00]);
});

test("the length echo carries the little-endian payload length", () => {
  expect(parseConvoyEcho(Uint8Array.from([0x00, 0x11, 0x22, 0x00, 0x00, 0x00, 0x00]))).toEqual({
    feature: 0x11,
    length: 0x22,
  });
  expect(parseConvoyEcho(Uint8Array.from([0x00, 0x11, 0x00, 0x01]))).toEqual({
    feature: 0x11,
    length: 0x100,
  });
  // An ACK echo, a short frame and an empty frame are not length echoes.
  expect(parseConvoyEcho(Uint8Array.from([0x04, 0x11, 0x22, 0x00]))).toBeNull();
  expect(parseConvoyEcho(Uint8Array.from([0x00, 0x11, 0x22]))).toBeNull();
  expect(parseConvoyEcho(Uint8Array.from([]))).toBeNull();
});

test("the payload encoding is XOR 0xFF (a bitwise NOT) and round-trips", () => {
  const plain = Uint8Array.from([0x00, 0x01, 0x7f, 0x80, 0xff]);
  const encoded = xorPayload(plain);
  expect(bytes(encoded)).toEqual([0xff, 0xfe, 0x80, 0x7f, 0x00]);
  expect(bytes(xorPayload(encoded))).toEqual(bytes(plain));
  expect(bytes(decodeConvoyPayload(encoded, true))).toEqual(bytes(plain));
  // The GG-B100 life log is sent in the clear; the decode still copies.
  const copy = decodeConvoyPayload(plain, false);
  expect(bytes(copy)).toEqual(bytes(plain));
  expect(copy).not.toBe(plain);
});

// ---------------------------------------------------------------------------
// Hourly TLV steps
// ---------------------------------------------------------------------------

test("an XOR-encoded hourly payload parses into hour-start bins", () => {
  const plain = stepsPayload({
    totalSteps: 615,
    totalCalories: 30,
    steps: [100, 200, 300],
    calories: [5, 10, 15],
  });
  const packet = parseStepsPacket(xorPayload(plain), { xor: true })!;
  expect(packet.lengthMatches).toBe(true);
  expect(packet.length).toBe(plain.length - 2);
  expect(packet.timestamp).toEqual({ year: 2026, month: 11, day: 10, hour: 12, minute: 30 });
  expect(packet.totalSteps).toBe(615);
  expect(packet.totalCalories).toBe(30);
  expect(packet.finished).toBe(false);
  expect(packet.bins).toEqual([
    {
      startTime: new Date(2026, 10, 10, 11, 0).toISOString(),
      endTime: new Date(2026, 10, 10, 12, 0).toISOString(),
      count: 100,
      calories: 5,
    },
    {
      startTime: new Date(2026, 10, 10, 10, 0).toISOString(),
      endTime: new Date(2026, 10, 10, 11, 0).toISOString(),
      count: 200,
      calories: 10,
    },
    {
      startTime: new Date(2026, 10, 10, 9, 0).toISOString(),
      endTime: new Date(2026, 10, 10, 10, 0).toISOString(),
      count: 300,
      calories: 15,
    },
  ]);
  expect(packet.residualSteps).toBe(15);
  expect(packet.residualCalories).toBe(0);
});

test("the same payload without XOR is rejected as garbage by the XOR path", () => {
  const plain = stepsPayload({ steps: [100], calories: [5] });
  // The plain payload starts with a length byte; XOR-decoding it inverts the
  // length so the parsed packet no longer matches its own length field.
  const packet = parseStepsPacket(plain, { xor: true })!;
  expect(packet.lengthMatches).toBe(false);
  expect(parseStepsPacket(plain, { xor: false })!.lengthMatches).toBe(true);
});

test("the hour walk crosses midnight into the previous day", () => {
  const plain = stepsPayload({
    day: 1,
    hour: 1,
    steps: [10, 20],
    calories: [1, 2],
  });
  const packet = parseStepsPacket(plain, { xor: false })!;
  expect(packet.bins.map((bin) => bin.startTime)).toEqual([
    new Date(2026, 10, 1, 0, 0).toISOString(),
    new Date(2026, 9, 31, 23, 0).toISOString(),
  ]);
});

test("a finished packet carries no bins even when a TLV block is present", () => {
  const plain = stepsPayload({ finished: true, steps: [100], calories: [5] });
  const packet = parseStepsPacket(plain, { xor: false })!;
  expect(packet.finished).toBe(true);
  expect(packet.bins).toEqual([]);
  expect(packet.residualSteps).toBe(0);
});

test("NO_DATA sentinels normalise to zero", () => {
  const plain = stepsPayload({
    totalSteps: CASIO_NO_DATA32,
    totalCalories: CASIO_NO_DATA16,
    steps: [CASIO_NO_DATA16, 42],
    calories: [CASIO_NO_DATA16, CASIO_NO_DATA16],
  });
  const packet = parseStepsPacket(plain, { xor: false })!;
  expect(packet.totalSteps).toBe(0);
  expect(packet.totalCalories).toBe(0);
  expect(packet.bins.map((bin) => bin.count)).toEqual([0, 42]);
  expect(packet.bins.map((bin) => bin.calories)).toEqual([0, 0]);
});

test("a truncated payload still yields the bins it carried and reports the mismatch", () => {
  const plain = stepsPayload({ steps: [100, 200], calories: [5, 10] });
  // Cut inside the steps block: the first sample survives, the second does not.
  const truncated = plain.slice(0, 23);
  const packet = parseStepsPacket(truncated, { xor: false })!;
  expect(packet.lengthMatches).toBe(false);
  expect(packet.bins.map((bin) => bin.count)).toEqual([100]);
});

test("a payload shorter than the 18-byte header is rejected", () => {
  expect(parseStepsPacket(new Uint8Array(17), { xor: false })).toBeNull();
  expect(parseStepsPacket(new Uint8Array(0), { xor: false })).toBeNull();
});

test("an odd TLV block length leaves one padding byte", () => {
  // Steps block declares 5 bytes: two samples plus one pad byte.
  const data = Uint8Array.from([
    0x00,
    0x00,
    26,
    11,
    10,
    12,
    30,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0x00,
    CASIO_CONVOY_DATATYPE_STEPS,
    0x05,
    0x00,
    0x0a,
    0x00,
    0x14,
    0x00,
    0xee,
  ]);
  expect(parseStepsTlv(data)).toEqual([{ type: CASIO_CONVOY_DATATYPE_STEPS, values: [10, 20] }]);
});

test("the TLV walk stops cleanly on a truncated block header", () => {
  const data = Uint8Array.from([
    0x00,
    0x00,
    26,
    11,
    10,
    12,
    30,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0x00,
    CASIO_CONVOY_DATATYPE_STEPS,
    0x02,
    0x00,
    0x0a,
    0x00,
    CASIO_CONVOY_DATATYPE_CALORIES,
    0x02, // header cut short
  ]);
  expect(parseStepsTlv(data)).toEqual([{ type: CASIO_CONVOY_DATATYPE_STEPS, values: [10] }]);
});

test("there is no checksum: only the length field is checked", () => {
  const plain = stepsPayload({ steps: [100], calories: [5] });
  // Corrupt a step value but keep the length intact: the parser accepts it.
  const corrupted = Uint8Array.from(plain);
  corrupted[21] = 0x99;
  const packet = parseStepsPacket(corrupted, { xor: false })!;
  expect(packet.lengthMatches).toBe(true);
  expect(packet.bins[0]!.count).toBe(0x99);
});

// ---------------------------------------------------------------------------
// Life log (GG-B100)
// ---------------------------------------------------------------------------

function lifeLog(options: {
  steps?: readonly number[];
  calories?: readonly number[];
  totalSteps24h?: number;
  totalCalories24h?: number;
  days?: readonly (readonly [number, number] | null)[];
}): Uint8Array {
  const out = new Uint8Array(CASIO_LIFE_LOG_LENGTH);
  const view = new DataView(out.buffer);
  for (let index = 0; index < 24; index += 1) {
    view.setUint16(index * 2, options.steps?.[index] ?? CASIO_NO_DATA16, true);
    view.setUint16(48 + index * 2, options.calories?.[index] ?? CASIO_NO_DATA16, true);
  }
  view.setUint32(96, options.totalSteps24h ?? 0, true);
  view.setUint32(100, options.totalCalories24h ?? 0, true);
  for (let index = 0; index < 7; index += 1) {
    const day = options.days?.[index] ?? null;
    view.setUint32(104 + index * 8, day ? day[0] : CASIO_NO_DATA32, true);
    view.setUint32(104 + index * 8 + 4, day ? day[1] : CASIO_NO_DATA32, true);
  }
  return out;
}

test("the life log maps 24 bins with bin 0 as the last completed hour", () => {
  const log = parseLifeLog(
    lifeLog({
      steps: [120, CASIO_NO_DATA16, 300],
      calories: [7, CASIO_NO_DATA16, CASIO_NO_DATA16],
      totalSteps24h: 420,
      totalCalories24h: 7,
    }),
    { now: NOW },
  )!;
  expect(log.totalSteps24h).toBe(420);
  expect(log.totalCalories24h).toBe(7);
  // Bin 1 is skipped: both steps and calories are NO_DATA16.
  expect(log.bins).toEqual([
    {
      startTime: new Date(2026, 10, 10, 11, 0).toISOString(),
      endTime: new Date(2026, 10, 10, 12, 0).toISOString(),
      count: 120,
      calories: 7,
    },
    {
      startTime: new Date(2026, 10, 10, 9, 0).toISOString(),
      endTime: new Date(2026, 10, 10, 10, 0).toISOString(),
      count: 300,
      calories: 0,
    },
  ]);
});

test("the life log walks back across midnight", () => {
  const steps = Array.from({ length: 24 }, () => 1);
  const log = parseLifeLog(lifeLog({ steps, calories: steps }), {
    now: new Date(2026, 10, 10, 2, 0),
  })!;
  expect(log.bins[0]!.startTime).toBe(new Date(2026, 10, 10, 1, 0).toISOString());
  expect(log.bins[2]!.startTime).toBe(new Date(2026, 10, 9, 23, 0).toISOString());
});

test("life-log daily totals are parsed but not emitted as hourly bins", () => {
  const log = parseLifeLog(
    lifeLog({
      steps: [10],
      calories: [1],
      days: [[1000, 50], null, [2000, 90]],
    }),
    { now: NOW },
  )!;
  expect(log.dailyTotals).toEqual([
    {
      startTime: new Date(2026, 10, 9, 0, 0).toISOString(),
      endTime: new Date(2026, 10, 10, 0, 0).toISOString(),
      steps: 1000,
      calories: 50,
    },
    {
      startTime: new Date(2026, 10, 7, 0, 0).toISOString(),
      endTime: new Date(2026, 10, 8, 0, 0).toISOString(),
      steps: 2000,
      calories: 90,
    },
  ]);
  expect(log.bins).toHaveLength(1);
});

test("a life log shorter than 160 bytes is rejected", () => {
  expect(parseLifeLog(new Uint8Array(159), { now: NOW })).toBeNull();
  expect(parseLifeLog(new Uint8Array(0), { now: NOW })).toBeNull();
});

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

test("bins map one-to-one onto steps_interval records", () => {
  const records = stepsBinsToRecords([
    {
      startTime: new Date(2026, 10, 10, 11, 0).toISOString(),
      endTime: new Date(2026, 10, 10, 12, 0).toISOString(),
      count: 120,
      calories: 7,
    },
  ]);
  expect(records).toEqual([
    {
      type: "steps_interval",
      startTime: new Date(2026, 10, 10, 11, 0).toISOString(),
      endTime: new Date(2026, 10, 10, 12, 0).toISOString(),
      count: 120,
    },
  ]);
  // Calories are not part of the frozen record shape.
  expect(records[0]).not.toHaveProperty("calories");
});

test("parseCasioSteps dispatches on the model's steps source", () => {
  const tlv = xorPayload(stepsPayload({ steps: [100], calories: [5] }));
  const tlvRecords = parseCasioSteps(tlv, { source: "hourly-tlv", xor: true, now: NOW })!;
  expect(tlvRecords).toHaveLength(1);
  expect(tlvRecords[0]!.count).toBe(100);

  const log = lifeLog({ steps: [120], calories: [7] });
  const logRecords = parseCasioSteps(log, { source: "life-log", xor: false, now: NOW })!;
  expect(logRecords).toHaveLength(1);
  expect(logRecords[0]!.count).toBe(120);
  expect(logRecords[0]!.startTime).toBe(new Date(2026, 10, 10, 11, 0).toISOString());

  expect(
    parseCasioSteps(new Uint8Array(0), { source: "life-log", xor: false, now: NOW }),
  ).toBeNull();
  expect(
    parseCasioSteps(new Uint8Array(0), { source: "hourly-tlv", xor: true, now: NOW }),
  ).toBeNull();
});
