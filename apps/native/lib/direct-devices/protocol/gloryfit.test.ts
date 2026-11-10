/**
 * Protocol vectors for the GloryFit codec.
 *
 * Derived from Gadgetbridge's GloryFit support at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  GLORYFIT_FETCH_DATA,
  GLORYFIT_FETCH_END,
  GLORYFIT_FETCH_START,
  GLORYFIT_HEART_RATE_INTERVAL_MS,
  GLORYFIT_STEPS_INTERVAL_MS,
  buildBatteryCommand,
  buildHeartRateFetchCommand,
  buildSleepFetchCommand,
  buildStepsFetchCommand,
  buildVersionCommand,
  createGloryFitSleepAccumulator,
  groupGloryFitSleepStages,
  parseGloryFitBatteryResponse,
  parseGloryFitHeartRateRecord,
  parseGloryFitSleepInfo,
  parseGloryFitSleepStages,
  parseGloryFitStepsRecord,
  type GloryFitSleepStageSample,
} from "./gloryfit";

function u16be(value: number): [number, number] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function stepsRecord(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  totalSteps: number;
}): Uint8Array {
  return Uint8Array.from([
    0xb2,
    ...u16be(input.year),
    input.month,
    input.day,
    input.hour,
    ...u16be(input.totalSteps),
    1,
    2,
    0,
    ...u16be(3),
    4,
    5,
    0,
    ...u16be(6),
  ]);
}

function heartRateRecord(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  values: readonly number[];
}): Uint8Array {
  // The year's high byte (0x07 for 2025-2031) is also the fetch-data marker.
  return Uint8Array.from([
    0xf7,
    ...u16be(input.year),
    input.month,
    input.day,
    input.hour,
    ...input.values,
  ]);
}

function sleepStage(hour: number, minute: number, stage: number, duration: number): number[] {
  return [hour, minute, stage, 0, ...u16be(duration)];
}

// ---------------------------------------------------------------------------
// Command builders
// ---------------------------------------------------------------------------

test("the fetch-chain commands match upstream byte layouts", () => {
  expect([...buildStepsFetchCommand()]).toEqual([0xb2, 0xfa]);
  expect([...buildHeartRateFetchCommand()]).toEqual([0xf7, 0xfa]);
  expect([...buildSleepFetchCommand()]).toEqual([0x31, 0x01]);
  expect([...buildBatteryCommand()]).toEqual([0xa2]);
  expect([...buildVersionCommand()]).toEqual([0xa1]);
  expect(GLORYFIT_FETCH_START).toBe(0xfa);
  expect(GLORYFIT_FETCH_DATA).toBe(0x07);
  expect(GLORYFIT_FETCH_END).toBe(0xfd);
});

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

test("an hourly steps record maps to a one-hour steps_interval", () => {
  const record = parseGloryFitStepsRecord(
    stepsRecord({ year: 2026, month: 11, day: 10, hour: 10, totalSteps: 250 }),
  );
  const start = new Date(2026, 10, 10, 10, 0, 0);
  expect(record).toEqual({
    type: "steps_interval",
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + GLORYFIT_STEPS_INTERVAL_MS).toISOString(),
    count: 250,
  });
});

test("the steps count is the hourly total field, not a running total", () => {
  const first = parseGloryFitStepsRecord(
    stepsRecord({ year: 2026, month: 11, day: 10, hour: 9, totalSteps: 100 }),
  );
  const second = parseGloryFitStepsRecord(
    stepsRecord({ year: 2026, month: 11, day: 10, hour: 10, totalSteps: 40 }),
  );
  expect(first?.count).toBe(100);
  expect(second?.count).toBe(40);
});

test("malformed steps records are rejected", () => {
  const valid = stepsRecord({ year: 2026, month: 11, day: 10, hour: 10, totalSteps: 250 });
  expect(parseGloryFitStepsRecord(valid.slice(0, 17))).toBeNull();
  expect(parseGloryFitStepsRecord(Uint8Array.from([0xb3, ...valid.slice(1)]))).toBeNull();
  expect(
    parseGloryFitStepsRecord(
      stepsRecord({ year: 2026, month: 13, day: 10, hour: 10, totalSteps: 250 }),
    ),
  ).toBeNull();
  expect(
    parseGloryFitStepsRecord(
      stepsRecord({ year: 2026, month: 11, day: 10, hour: 24, totalSteps: 250 }),
    ),
  ).toBeNull();
});

// ---------------------------------------------------------------------------
// Heart rate
// ---------------------------------------------------------------------------

test("the upstream heart-rate example yields twelve 10-minute samples ending at the hour", () => {
  // f707e90703083030315c2f2f2e2f2f353331
  const record = Uint8Array.from([
    0xf7, 0x07, 0xe9, 0x07, 0x03, 0x08, 0x30, 0x30, 0x31, 0x5c, 0x2f, 0x2f, 0x2e, 0x2f, 0x2f, 0x35,
    0x33, 0x31,
  ]);
  const samples = parseGloryFitHeartRateRecord(record);
  expect(samples).toHaveLength(12);
  const first = new Date(2025, 6, 3, 8, 0, 0).getTime() - 11 * GLORYFIT_HEART_RATE_INTERVAL_MS;
  expect(samples[0]).toEqual({
    type: "heart_rate",
    time: new Date(first).toISOString(),
    bpm: 0x30,
  });
  expect(samples[samples.length - 1]).toEqual({
    type: "heart_rate",
    time: new Date(2025, 6, 3, 8, 0, 0).toISOString(),
    bpm: 0x31,
  });
  expect(samples.map((sample) => sample.bpm)).toEqual([
    0x30, 0x30, 0x31, 0x5c, 0x2f, 0x2f, 0x2e, 0x2f, 0x2f, 0x35, 0x33, 0x31,
  ]);
});

test("heart-rate placeholders 0x00 and 0xFF are skipped but still advance the cursor", () => {
  const values = [0, 0xff, 60, 0, 61, 0xff, 0, 0, 0, 0, 0, 62];
  const samples = parseGloryFitHeartRateRecord(
    heartRateRecord({ year: 2026, month: 11, day: 10, hour: 8, values }),
  );
  expect(samples.map((sample) => sample.bpm)).toEqual([60, 61, 62]);
  const last = new Date(2026, 10, 10, 8, 0, 0).toISOString();
  expect(samples[samples.length - 1]!.time).toBe(last);
  expect(samples[0]!.time).toBe(
    new Date(new Date(last).getTime() - 9 * GLORYFIT_HEART_RATE_INTERVAL_MS).toISOString(),
  );
});

test("malformed heart-rate records yield no samples", () => {
  const valid = heartRateRecord({
    year: 2026,
    month: 11,
    day: 10,
    hour: 8,
    values: Array.from({ length: 12 }, () => 60),
  });
  expect(parseGloryFitHeartRateRecord(valid.slice(0, 17))).toEqual([]);
  expect(parseGloryFitHeartRateRecord(Uint8Array.from([0xf8, ...valid.slice(1)]))).toEqual([]);
  // Upstream gates on value[1] == 0x07 (the year high byte).
  expect(parseGloryFitHeartRateRecord(Uint8Array.from([0xf7, 0x08, ...valid.slice(2)]))).toEqual(
    [],
  );
});

// ---------------------------------------------------------------------------
// Battery
// ---------------------------------------------------------------------------

test("battery response parses percent and charging flag", () => {
  expect(parseGloryFitBatteryResponse(Uint8Array.from([0xa2, 87, 1]))).toEqual({
    percent: 87,
    charging: true,
  });
  expect(parseGloryFitBatteryResponse(Uint8Array.from([0xa2, 87, 0]))).toEqual({
    percent: 87,
    charging: false,
  });
  expect(parseGloryFitBatteryResponse(Uint8Array.from([0xa2, 101]))).toBeNull();
  expect(parseGloryFitBatteryResponse(Uint8Array.from([0xa3, 87]))).toBeNull();
});

// ---------------------------------------------------------------------------
// Sleep
// ---------------------------------------------------------------------------

test("sleep info parses the session date and stage count", () => {
  const info = parseGloryFitSleepInfo(Uint8Array.from([0x31, 0x01, 0x07, 0xea, 11, 10, 3]));
  expect(info).toEqual({ kind: "date", date: new Date(2026, 10, 10), stageCount: 3 });
});

test("sleep info parses the end marker and rejects unknown subtypes", () => {
  expect(parseGloryFitSleepInfo(Uint8Array.from([0x31, 0x02]))).toEqual({ kind: "end" });
  expect(parseGloryFitSleepInfo(Uint8Array.from([0x31, 0x03]))).toBeNull();
  expect(parseGloryFitSleepInfo(Uint8Array.from([0x31, 0x01, 0x07, 0xea, 11]))).toBeNull();
  expect(parseGloryFitSleepInfo(Uint8Array.from([0x32, 0x01]))).toBeNull();
});

test("sleep stages carry the after-midnight flag and map upstream stage enums", () => {
  const payload = Uint8Array.from([
    0x32,
    ...sleepStage(23, 0, 2, 60),
    ...sleepStage(0, 0, 1, 30),
    ...sleepStage(0, 30, 3, 15),
    ...sleepStage(0, 45, 4, 45),
  ]);
  const result = parseGloryFitSleepStages(payload, new Date(2026, 10, 10), false);
  expect(result?.afterMidnight).toBe(true);
  expect(result?.samples).toEqual([
    { stage: "light", startTime: new Date(2026, 10, 9, 23, 0, 0).getTime(), durationMinutes: 60 },
    { stage: "deep", startTime: new Date(2026, 10, 10, 0, 0, 0).getTime(), durationMinutes: 30 },
    { stage: "awake", startTime: new Date(2026, 10, 10, 0, 30, 0).getTime(), durationMinutes: 15 },
    { stage: "rem", startTime: new Date(2026, 10, 10, 0, 45, 0).getTime(), durationMinutes: 45 },
  ]);
});

test("sleep stages keep the after-midnight flag across payloads", () => {
  const first = parseGloryFitSleepStages(
    Uint8Array.from([0x32, ...sleepStage(23, 0, 2, 60)]),
    new Date(2026, 10, 10),
    false,
  );
  expect(first?.afterMidnight).toBe(false);
  const second = parseGloryFitSleepStages(
    Uint8Array.from([0x32, ...sleepStage(1, 0, 1, 30)]),
    new Date(2026, 10, 10),
    first!.afterMidnight,
  );
  expect(second?.afterMidnight).toBe(true);
  expect(second?.samples[0]!.startTime).toBe(new Date(2026, 10, 10, 1, 0, 0).getTime());
});

test("unknown stage types are dropped but still advance the flag", () => {
  const result = parseGloryFitSleepStages(
    Uint8Array.from([0x32, ...sleepStage(13, 0, 9, 30), ...sleepStage(2, 0, 2, 30)]),
    new Date(2026, 10, 10),
    false,
  );
  expect(result?.afterMidnight).toBe(true);
  expect(result?.samples).toEqual([
    { stage: "light", startTime: new Date(2026, 10, 10, 2, 0, 0).getTime(), durationMinutes: 30 },
  ]);
});

test("malformed sleep-stage payloads are rejected", () => {
  expect(parseGloryFitSleepStages(Uint8Array.from([0x32, 1, 2, 3]), new Date(), false)).toBeNull();
  expect(parseGloryFitSleepStages(Uint8Array.from([0x33]), new Date(), false)).toBeNull();
});

test("grouping merges adjacent equal stages into one session", () => {
  const samples: GloryFitSleepStageSample[] = [
    { stage: "light", startTime: new Date(2026, 10, 9, 23, 0, 0).getTime(), durationMinutes: 30 },
    { stage: "light", startTime: new Date(2026, 10, 9, 23, 30, 0).getTime(), durationMinutes: 30 },
    { stage: "deep", startTime: new Date(2026, 10, 10, 0, 0, 0).getTime(), durationMinutes: 30 },
  ];
  expect(groupGloryFitSleepStages(samples)).toEqual([
    {
      type: "sleep_session",
      startTime: new Date(2026, 10, 9, 23, 0, 0).toISOString(),
      endTime: new Date(2026, 10, 10, 0, 30, 0).toISOString(),
      stages: [
        {
          stage: "light",
          startTime: new Date(2026, 10, 9, 23, 0, 0).toISOString(),
          endTime: new Date(2026, 10, 10, 0, 0, 0).toISOString(),
        },
        {
          stage: "deep",
          startTime: new Date(2026, 10, 10, 0, 0, 0).toISOString(),
          endTime: new Date(2026, 10, 10, 0, 30, 0).toISOString(),
        },
      ],
    },
  ]);
});

test("grouping starts a new session at a gap", () => {
  const samples: GloryFitSleepStageSample[] = [
    { stage: "light", startTime: new Date(2026, 10, 9, 23, 0, 0).getTime(), durationMinutes: 60 },
    { stage: "deep", startTime: new Date(2026, 10, 10, 1, 0, 0).getTime(), durationMinutes: 30 },
  ];
  const sessions = groupGloryFitSleepStages(samples);
  expect(sessions).toHaveLength(2);
  expect(sessions[0]!.startTime).toBe(new Date(2026, 10, 9, 23, 0, 0).toISOString());
  expect(sessions[1]!.startTime).toBe(new Date(2026, 10, 10, 1, 0, 0).toISOString());
});

test("the two-phase accumulator emits one grouped session at end", () => {
  const accumulator = createGloryFitSleepAccumulator();
  accumulator.begin(new Date(2026, 10, 10));
  accumulator.pushStages(
    Uint8Array.from([0x32, ...sleepStage(23, 0, 2, 60), ...sleepStage(0, 0, 1, 30)]),
  );
  accumulator.pushStages(Uint8Array.from([0x32, ...sleepStage(0, 30, 3, 15)]));
  const sessions = accumulator.end();
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toEqual({
    type: "sleep_session",
    startTime: new Date(2026, 10, 9, 23, 0, 0).toISOString(),
    endTime: new Date(2026, 10, 10, 0, 45, 0).toISOString(),
    stages: [
      {
        stage: "light",
        startTime: new Date(2026, 10, 9, 23, 0, 0).toISOString(),
        endTime: new Date(2026, 10, 10, 0, 0, 0).toISOString(),
      },
      {
        stage: "deep",
        startTime: new Date(2026, 10, 10, 0, 0, 0).toISOString(),
        endTime: new Date(2026, 10, 10, 0, 30, 0).toISOString(),
      },
      {
        stage: "awake",
        startTime: new Date(2026, 10, 10, 0, 30, 0).toISOString(),
        endTime: new Date(2026, 10, 10, 0, 45, 0).toISOString(),
      },
    ],
  });
  // Ending twice yields nothing more.
  expect(accumulator.end()).toEqual([]);
});
