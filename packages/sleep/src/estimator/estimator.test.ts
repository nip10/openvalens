/**
 * Behavioural tests ported from Gadgetbridge's `SleepStageEstimatorTest`.
 *
 * Upstream: `app/src/test/java/nodomain/freeyourgadget/gadgetbridge/util/sleep/SleepStageEstimatorTest.kt`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/test/java/nodomain/freeyourgadget/gadgetbridge/util/sleep/SleepStageEstimatorTest.kt
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * The fixture `__fixtures__/venu_sq_minutes.json` is the upstream test
 * resource `app/src/test/resources/garmin/sleep/venu_sq_minutes.json` at the
 * same revision. Upstream SHA-256
 * 5286d56bb6ad11007806e9e1fac79a1a22d7d6de3c230fc5f5faeda964ab8495; the copy
 * here is only oxfmt-reformatted (identical data).
 */

import { readFileSync } from "node:fs";

import { expect, test } from "bun:test";

import { estimate, estimateAll, estimateSettled, LABEL_REACH_MINUTES } from "./estimator";
import { SleepMinuteKind } from "./types";
import type { EstimatedSleepSession, EstimatedStage, SleepMinute } from "./types";

const MS_PER_MINUTE = 60_000;
const DAY_MS = 86_400_000;

const zone = 2 * 60 * 60;
const bedtime = Date.UTC(2024, 2, 4, 20, 30); // 22:30 at UTC+2

type MinuteFactory = (at: number) => SleepMinute;

// Generators. Each yields minutes in order; `sequence` stitches them from a start.

function still(count: number, heartRate: (index: number) => number = () => 52): MinuteFactory[] {
  return Array.from({ length: count }, (_, index) => (at: number) => ({
    time: at,
    kind: SleepMinuteKind.RAW,
    movement: 0,
    heartRate: heartRate(index),
  }));
}

function restless(count: number, heartRate = 64): MinuteFactory[] {
  return Array.from({ length: count }, (_, index) => (at: number) => ({
    time: at,
    kind: SleepMinuteKind.RAW,
    movement: 8 + ((index * 5) % 8),
    heartRate,
  }));
}

function awakeCodes(count: number): MinuteFactory[] {
  return Array.from({ length: count }, () => (at: number) => ({
    time: at,
    kind: SleepMinuteKind.AWAKE,
  }));
}

function gap(count: number): MinuteFactory[] {
  return Array.from({ length: count }, () => (at: number) => ({
    time: at,
    kind: SleepMinuteKind.UNMEASURABLE,
  }));
}

function sequence(start: number, ...parts: MinuteFactory[][]): SleepMinute[] {
  return parts.flat().map((make, index) => make(start + index * MS_PER_MINUTE));
}

/** A night's heart rate: settles over the first hour, then dips every 90 minutes. */
function nightHeartRate(index: number): number {
  const settling = index < 60 ? (60 - index) / 8 : 0;
  const cycle = 4 * Math.sin((2 * Math.PI * index) / 90);
  const jitter = (((index * 7) % 3) - 1) * 0.5;
  return 52 + settling + cycle + jitter;
}

/** Thirty restless minutes, the sleep, then an hour of restlessness so the night can end. */
function night(sleepMinutes = 450): MinuteFactory[] {
  return [...restless(30), ...still(sleepMinutes, nightHeartRate), ...restless(60)];
}

/** The night a minute belongs to: 18:00 to 14:00, counted toward the morning's date. */
function nightDateOf(time: number, offsetSeconds: number): number | null {
  const local = time + offsetSeconds * 1000;
  const day = Math.floor(local / DAY_MS);
  const hour = new Date(local).getUTCHours();
  if (hour >= 18) return day + 1;
  if (hour < 14) return day;
  return null;
}

function localMinutesOfDay(time: number, offsetSeconds: number): number {
  const local = new Date(time + offsetSeconds * 1000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

function localDayOf(time: number, offsetSeconds: number): number {
  return Math.floor((time + offsetSeconds * 1000) / DAY_MS);
}

function formatDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function minutesBetween(a: number, b: number): number {
  return (b - a) / MS_PER_MINUTE;
}

/** Onset trails the first still minute by the smoothing window and the Webster carry-over, up to 15 minutes. */
function assertWithin(expected: number, actual: number, minutes: number): void {
  const delta = minutesBetween(expected, actual);
  expect(
    Math.abs(delta),
    `expected ${new Date(expected).toISOString()} within ${minutes} min, was ${new Date(actual).toISOString()}`,
  ).toBeLessThanOrEqual(minutes);
}

function share(session: EstimatedSleepSession, stage: EstimatedStage): number {
  const minutes = session.stages
    .filter((span) => span.stage === stage)
    .reduce((sum, span) => sum + minutesBetween(span.start, span.end), 0);
  return minutes / session.sleepMinutes;
}

/** Deterministic Fisher-Yates, standing in for Kotlin's `shuffled(Random(7))`. */
function shuffled<T>(values: readonly T[], seed: number): T[] {
  const out = [...values];
  let state = seed >>> 0;
  for (let index = out.length - 1; index > 0; index -= 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    const swap = state % (index + 1);
    const current = out[index]!;
    out[index] = out[swap]!;
    out[swap] = current;
  }
  return out;
}

test("a pure night is one session with plausible stages", () => {
  const session = estimate(sequence(bedtime, night()))!;

  expect(session).not.toBeNull();
  assertWithin(bedtime + 30 * MS_PER_MINUTE, session.onset, 20);
  assertWithin(bedtime + 480 * MS_PER_MINUTE, session.end, 5);
  expect(session.awakeMinutes).toBe(0);
  expect(session.sleepMinutes).toBeGreaterThanOrEqual(425);
  expect(session.sleepMinutes).toBeLessThanOrEqual(450);
  expect(session.inProgress).toBe(false);
  expect(share(session, "deep")).toBeGreaterThanOrEqual(0.1);
  expect(share(session, "deep")).toBeLessThanOrEqual(0.25);
  expect(share(session, "rem")).toBeGreaterThanOrEqual(0.15);
  expect(share(session, "rem")).toBeLessThanOrEqual(0.3);
  expect(
    session.stages.some(
      (span) => span.stage === "rem" && minutesBetween(session.onset, span.start) < 60,
    ),
  ).toBe(false);
  expect(
    session.stages
      .filter((span) => span.stage === "deep" || span.stage === "rem")
      .every((span) => minutesBetween(span.start, span.end) >= 5),
  ).toBe(true);
  // Spans tile the window without gaps.
  for (let index = 1; index < session.stages.length; index += 1) {
    expect(session.stages[index]!.start).toBe(session.stages[index - 1]!.end);
  }
});

test("an awakening stays awake and reenters through light sleep", () => {
  const minutes = sequence(
    bedtime,
    restless(30),
    still(200, nightHeartRate),
    awakeCodes(20),
    still(250, nightHeartRate),
    restless(30),
  );

  const session = estimate(minutes)!;

  expect(session.awakeMinutes).toBeGreaterThanOrEqual(20);
  expect(session.awakeMinutes).toBeLessThanOrEqual(40);
  const awake = session.stages.find((span) => span.stage === "awake")!;
  const afterWake = session.stages.filter(
    (span) => span.start >= awake.end && minutesBetween(awake.end, span.start) < 10,
  );
  expect(afterWake.some((span) => span.stage === "deep")).toBe(false);
  for (let index = 1; index < session.stages.length; index += 1) {
    expect(session.stages[index]!.start).toBe(session.stages[index - 1]!.end);
  }
});

test("a daytime sedentary run is not a night", () => {
  const parts = Array.from({ length: 8 }, () => [...still(8, () => 58), ...restless(4)]).flat();

  expect(estimate(sequence(bedtime, parts))).toBeNull();
});

test("an evening couch pocket does not pull the onset forward", () => {
  // The pocket, ninety restless minutes, then a night whose stillness starts at bedtime.
  const minutes = sequence(
    bedtime - 160 * MS_PER_MINUTE,
    still(40, () => 60),
    restless(90),
    night(),
  );

  const session = estimate(minutes)!;

  assertWithin(bedtime, session.onset, 20);
});

test("a long not-worn gap splits the night and the longer half wins", () => {
  const minutes = sequence(
    bedtime,
    restless(30),
    still(240, nightHeartRate),
    gap(60),
    still(300, nightHeartRate),
    restless(30),
  );

  const session = estimate(minutes)!;

  assertWithin(bedtime + (30 + 240 + 60) * MS_PER_MINUTE, session.onset, 20);
  expect(session.sleepMinutes).toBeGreaterThanOrEqual(280);
  expect(session.sleepMinutes).toBeLessThanOrEqual(300);
  expect(session.unknownMinutes).toBe(0);
});

test("a short not-worn gap stays inside the night as unknown", () => {
  const minutes = sequence(
    bedtime,
    restless(30),
    still(240, nightHeartRate),
    gap(20),
    still(200, nightHeartRate),
    restless(30),
  );

  const session = estimate(minutes)!;

  assertWithin(bedtime + 30 * MS_PER_MINUTE, session.onset, 20);
  expect(session.unknownMinutes).toBe(20);
  const unknown = session.stages.filter((span) => span.stage === "unknown");
  expect(unknown).toHaveLength(1);
  expect(minutesBetween(unknown[0]!.start, unknown[0]!.end)).toBe(20);
});

test("a night still being recorded is in progress until 45 minutes of not sleeping", () => {
  const partial = sequence(bedtime, restless(30), still(200, nightHeartRate));
  const session = estimate(partial)!;
  expect(session.inProgress).toBe(true);

  const finished = [...partial, ...sequence(bedtime + 230 * MS_PER_MINUTE, awakeCodes(45))];
  const later = estimate(finished)!;
  expect(later.inProgress).toBe(false);
  expect(later.onset).toBe(session.onset);
});

test("too little sleep is no night", () => {
  expect(estimate(sequence(bedtime, still(150, nightHeartRate)))).toBeNull();
});

test("order and duplicates do not change the result", () => {
  const minutes = sequence(bedtime, night());
  const reference = estimate(minutes);

  const scrambled = estimate(shuffled(minutes, 7));
  const duplicated = estimate([...minutes.slice(0, 100), ...minutes]);

  expect(scrambled).toEqual(reference);
  expect(duplicated).toEqual(reference);
});

test("a night slice gives the same answer as the whole stream", () => {
  const eveningBefore = bedtime - 24 * 60 * MS_PER_MINUTE;
  // Two nights: one the evening before, one whose stillness starts at bedtime.
  const stream = [
    ...sequence(eveningBefore, night(), awakeCodes(60)),
    ...sequence(bedtime - 150 * MS_PER_MINUTE, restless(120), night(), awakeCodes(60)),
  ];
  const nightDate = nightDateOf(bedtime, zone)!;
  const slice = stream.filter((minute) => nightDateOf(minute.time, zone) === nightDate);

  const fromSlice = estimate(slice)!;
  const fromStream = estimate(stream)!;
  assertWithin(bedtime, fromSlice.onset, 20);
  // The whole stream holds two equal nights; the slice isolates the second one.
  expect(fromSlice.sleepMinutes).toBe(fromStream.sleepMinutes);
  expect(fromSlice.sleepMinutes).toBeGreaterThanOrEqual(425);
  expect(fromSlice.sleepMinutes).toBeLessThanOrEqual(450);
});

test("a flat heart rate still lands in range through the sanity loop", () => {
  const session = estimate(
    sequence(
      bedtime,
      restless(30),
      still(450, () => 55),
      restless(30),
    ),
  )!;

  expect(session.deepThreshold).not.toBe(0.6);
  expect(session.remThreshold).not.toBe(0.6);
  expect(share(session, "deep")).toBeGreaterThanOrEqual(0.1);
  expect(share(session, "deep")).toBeLessThanOrEqual(0.25);
  expect(share(session, "rem")).toBeGreaterThanOrEqual(0.15);
  expect(share(session, "rem")).toBeLessThanOrEqual(0.3);
});

// Settling a stretch of a longer stream.

test("a stretch continuing on both sides settles only inside the label reach", () => {
  const first = bedtime - 200 * MS_PER_MINUTE;
  const minutes = sequence(first, restless(200), night(), restless(200));
  const last = minutes[minutes.length - 1]!.time;

  const settled = estimateSettled(minutes, 0, 0)!;

  expect(settled.zoneStart).toBe(first + LABEL_REACH_MINUTES * MS_PER_MINUTE);
  expect(settled.zoneEnd).toBe(last + MS_PER_MINUTE - LABEL_REACH_MINUTES * MS_PER_MINUTE);
  expect(settled.sessions).toHaveLength(1);
  expect(settled.sessions[0]).toEqual(estimate(minutes)!);
});

test("a stretch with nothing beyond it settles whole", () => {
  const minutes = sequence(bedtime, night());

  const settled = estimateSettled(minutes, null, null)!;

  expect(settled.zoneStart).toBeLessThanOrEqual(bedtime);
  expect(settled.zoneEnd).toBeGreaterThan(minutes[minutes.length - 1]!.time);
  expect(settled.sessions).toHaveLength(1);
  expect(settled.sessions[0]).toEqual(estimate(minutes)!);
});

test("a short hole before the stretch does not settle its first sleep", () => {
  // The second half of a night: alone it is a session, but not when ten minutes before it are missing
  const secondHalf = sequence(bedtime, still(250, nightHeartRate), restless(60));

  const adjoining = estimateSettled(secondHalf, 10, null)!;
  const afterABreak = estimateSettled(secondHalf, 60, null)!;

  expect(adjoining.sessions).toHaveLength(0);
  expect(adjoining.zoneStart).toBeGreaterThanOrEqual(bedtime + 250 * MS_PER_MINUTE);
  expect(afterABreak.sessions).toHaveLength(1);
});

test("a stretch without a settled break is not settled", () => {
  const minutes = sequence(bedtime, still(100, nightHeartRate));

  expect(estimateSettled(minutes, 0, 0)).toBeNull();
});

// The Venu SQ fixture: four days of real-shaped data, values rounded and dates shifted.

type FixtureRow = {
  t: number;
  k: string;
  z: number;
  hr?: number | null;
  mv?: number;
};

type Fixture = {
  originEpochSeconds: number;
  minuteSeconds: number;
  minutes: FixtureRow[];
};

const FIXTURE = JSON.parse(
  readFileSync(new URL("./__fixtures__/venu_sq_minutes.json", import.meta.url), "utf8"),
) as Fixture;

function fixtureMinutes(): { minutes: SleepMinute[]; offsetSeconds: number } {
  let offsetSeconds = 0;
  const minutes = FIXTURE.minutes.map((row) => {
    offsetSeconds = row.z;
    const time = (FIXTURE.originEpochSeconds + FIXTURE.minuteSeconds * row.t) * 1000;
    if (row.k === "R") {
      return {
        time,
        kind: SleepMinuteKind.RAW,
        movement: row.mv ?? 0,
        heartRate: row.hr ?? null,
      } satisfies SleepMinute;
    }
    if (row.k === "A") return { time, kind: SleepMinuteKind.AWAKE } satisfies SleepMinute;
    return { time, kind: SleepMinuteKind.UNMEASURABLE } satisfies SleepMinute;
  });
  return { minutes, offsetSeconds };
}

test("the Venu SQ fixture yields exactly its three nights", () => {
  const { minutes, offsetSeconds } = fixtureMinutes();
  const byNight = new Map<number, SleepMinute[]>();
  for (const minute of minutes) {
    const nightDate = nightDateOf(minute.time, offsetSeconds);
    if (nightDate === null) continue;
    const slice = byNight.get(nightDate);
    if (slice) slice.push(minute);
    else byNight.set(nightDate, [minute]);
  }

  const sessions: Array<{ night: number; session: EstimatedSleepSession }> = [];
  for (const [night, slice] of byNight) {
    const session = estimate(slice);
    if (session) sessions.push({ night, session });
  }
  sessions.sort((a, b) => a.night - b.night);

  expect(
    sessions.length,
    sessions
      .map(
        ({ night, session }) =>
          `${formatDay(night)}: ${new Date(session.onset).toISOString()}→${new Date(session.end).toISOString()}`,
      )
      .join(", "),
  ).toBe(3);
  for (const { night, session } of sessions) {
    const onset = localMinutesOfDay(session.onset, offsetSeconds);
    const end = localMinutesOfDay(session.end, offsetSeconds);
    expect(onset >= 21 * 60 || onset <= 30, `${formatDay(night)} onset ${onset}`).toBe(true);
    expect(localDayOf(session.end, offsetSeconds)).toBe(night);
    expect(end >= 5 * 60 && end <= 9 * 60, `${formatDay(night)} end ${end}`).toBe(true);
    expect(session.sleepMinutes, `${formatDay(night)} sleep`).toBeGreaterThanOrEqual(360);
    expect(share(session, "deep"), `${formatDay(night)} deep`).toBeGreaterThanOrEqual(0.1);
    expect(share(session, "deep"), `${formatDay(night)} deep`).toBeLessThanOrEqual(0.25);
    expect(share(session, "rem"), `${formatDay(night)} rem`).toBeGreaterThanOrEqual(0.15);
    expect(share(session, "rem"), `${formatDay(night)} rem`).toBeLessThanOrEqual(0.3);
    expect(session.inProgress).toBe(false);
  }
});

test("the whole fixture yields exactly its three nights", () => {
  const { minutes, offsetSeconds } = fixtureMinutes();

  const sessions = estimateAll(minutes);

  expect(
    sessions.length,
    sessions
      .map(
        (session) =>
          `${new Date(session.onset).toISOString()}→${new Date(session.end).toISOString()}`,
      )
      .join(", "),
  ).toBe(3);
  for (const session of sessions) {
    const onset = localMinutesOfDay(session.onset, offsetSeconds);
    const end = localMinutesOfDay(session.end, offsetSeconds);
    expect(onset >= 21 * 60 || onset <= 30, `onset ${onset}`).toBe(true);
    expect(end >= 5 * 60 && end <= 9 * 60, `end ${end}`).toBe(true);
    expect(session.sleepMinutes, `sleep ${session.sleepMinutes}`).toBeGreaterThanOrEqual(360);
  }
  expect(sessions).toEqual([...sessions].sort((a, b) => a.onset - b.onset));
  const mostSleep = sessions.reduce((best, session) =>
    session.sleepMinutes > best.sleepMinutes ? session : best,
  );
  expect(estimate(minutes)).toEqual(mostSleep);
});

test("the fixture's daytime hours hold no night", () => {
  const { minutes, offsetSeconds } = fixtureMinutes();
  const daytime = minutes.filter((minute) => {
    const hour = new Date(minute.time + offsetSeconds * 1000).getUTCHours();
    return hour >= 7 && hour < 18;
  });
  const byDay = new Map<number, SleepMinute[]>();
  for (const minute of daytime) {
    const day = localDayOf(minute.time, offsetSeconds);
    const slice = byDay.get(day);
    if (slice) slice.push(minute);
    else byDay.set(day, [minute]);
  }

  for (const [day, slice] of byDay) {
    expect(estimate(slice), formatDay(day)).toBeNull();
  }
});
