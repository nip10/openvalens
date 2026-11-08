/**
 * Behavioural tests for the ported sleep-stage sanitizing and grouping.
 *
 * Upstream has no direct tests for `sanitizeStages` / `groupIntoSessions` /
 * `getSleepSessionsEndingIn`; these cover the rules documented in
 * `SleepSessionProvider.kt` at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import { DAY_MS } from "./identity";
import { getSleepSessionsEndingIn, groupIntoSessions, sanitizeStages } from "./sanitize";
import { makeSleepSession } from "./types";
import type { SleepSession, SleepStage, SleepStageKind } from "./types";

function stage(kind: SleepStageKind, startSeconds: number, endSeconds: number): SleepStage {
  return { kind, start: startSeconds * 1000, end: endSeconds * 1000 };
}

const SECOND_MS = 1000;

function assertStages(session: SleepSession, ...expected: SleepStage[]): void {
  expect(session.stages).toEqual(expected);
}

// sanitizeStages

test("sanitizeStages returns null when the session end is not after its start", () => {
  expect(sanitizeStages([stage("light", 0, 100)], 1000 * SECOND_MS, 1000 * SECOND_MS)).toBeNull();
  expect(sanitizeStages([stage("light", 0, 100)], 2000 * SECOND_MS, 1000 * SECOND_MS)).toBeNull();
});

test("sanitizeStages pads a pre-onset gap with light sleep", () => {
  const session = sanitizeStages([stage("deep", 1000, 2000)], 0, 3000 * SECOND_MS)!;

  assertStages(session, stage("light", 0, 1000), stage("deep", 1000, 3000));
});

test("sanitizeStages clips each stage to the next stage's start", () => {
  const session = sanitizeStages(
    [stage("light", 0, 9999), stage("deep", 600, 9999)],
    0,
    1200 * SECOND_MS,
  )!;

  assertStages(session, stage("light", 0, 600), stage("deep", 600, 1200));
});

test("sanitizeStages drops stages that fully overlap the previous one", () => {
  const session = sanitizeStages(
    [stage("light", 0, 1000), stage("deep", 0, 500), stage("rem", 600, 900)],
    0,
    1200 * SECOND_MS,
  )!;

  assertStages(session, stage("deep", 0, 600), stage("rem", 600, 1200));
});

test("sanitizeStages merges touching stages of the same kind", () => {
  const session = sanitizeStages(
    [stage("light", 0, 500), stage("light", 500, 1000)],
    0,
    1000 * SECOND_MS,
  )!;

  assertStages(session, stage("light", 0, 1000));
});

test("sanitizeStages falls back to one light stage for the whole span", () => {
  const session = sanitizeStages([], 0, 1000 * SECOND_MS)!;

  assertStages(session, stage("light", 0, 1000));
});

test("sanitizeStages clips a stage that runs past the session end", () => {
  const session = sanitizeStages([stage("deep", 0, 9999)], 0, 1000 * SECOND_MS)!;

  assertStages(session, stage("deep", 0, 1000));
});

// groupIntoSessions

test("groupIntoSessions splits on a time gap", () => {
  const sessions = groupIntoSessions([stage("light", 0, 600), stage("deep", 700, 1000)]);

  expect(sessions).toHaveLength(2);
  assertStages(sessions[0]!, stage("light", 0, 600));
  assertStages(sessions[1]!, stage("deep", 700, 1000));
});

test("groupIntoSessions merges touching stages of the same kind", () => {
  const sessions = groupIntoSessions([stage("light", 0, 500), stage("light", 500, 1000)]);

  expect(sessions).toHaveLength(1);
  assertStages(sessions[0]!, stage("light", 0, 1000));
});

test("groupIntoSessions drops fully overlapping stages", () => {
  const sessions = groupIntoSessions([
    stage("light", 0, 1000),
    stage("deep", 0, 500),
    stage("rem", 600, 900),
  ]);

  expect(sessions).toHaveLength(1);
  assertStages(sessions[0]!, stage("light", 0, 1000));
});

test("groupIntoSessions sorts unordered stages before grouping", () => {
  const sessions = groupIntoSessions([stage("deep", 700, 1000), stage("light", 0, 600)]);

  expect(sessions).toHaveLength(2);
  assertStages(sessions[0]!, stage("light", 0, 600));
  assertStages(sessions[1]!, stage("deep", 700, 1000));
});

test("groupIntoSessions clips an overlapping stage start to the previous end", () => {
  const sessions = groupIntoSessions([stage("light", 0, 600), stage("deep", 500, 1000)]);

  expect(sessions).toHaveLength(1);
  assertStages(sessions[0]!, stage("light", 0, 600), stage("deep", 600, 1000));
});

test("groupIntoSessions returns no sessions for empty input", () => {
  expect(groupIntoSessions([])).toHaveLength(0);
});

// getSleepSessionsEndingIn: a night belongs to the day it ends (the wake day).

test("getSleepSessionsEndingIn attributes a night to its wake day, not its start day", () => {
  const day1 = Date.UTC(2024, 2, 4);
  const day2 = day1 + DAY_MS;
  const night = makeSleepSession([
    { kind: "light", start: day1 + 23 * 3_600_000, end: day2 + 7 * 3_600_000 },
  ]);
  const nap = makeSleepSession([
    { kind: "light", start: day2 + 13 * 3_600_000, end: day2 + 14 * 3_600_000 },
  ]);
  const previousNight = makeSleepSession([{ kind: "light", start: day1 - 3_600_000, end: day1 }]);
  const stored = [previousNight, night, nap];

  let requestedFrom = 0;
  let requestedTo = 0;
  const fetch = (fromMs: number, toMs: number): readonly SleepSession[] => {
    requestedFrom = fromMs;
    requestedTo = toMs;
    return stored;
  };

  // The night starting on day 1 is not attributed to day 1.
  expect(getSleepSessionsEndingIn(fetch, day1, day1 + DAY_MS - 1)).toHaveLength(0);

  // It is attributed to day 2, the day it ends.
  const wakeDay = getSleepSessionsEndingIn(fetch, day2, day2 + DAY_MS - 1);
  expect(wakeDay).toEqual([night, nap]);
  expect(requestedFrom).toBe(day2 - DAY_MS);
  expect(requestedTo).toBe(day2 + DAY_MS - 1);
});

test("getSleepSessionsEndingIn uses an exclusive start and inclusive end", () => {
  const day = Date.UTC(2024, 2, 4);
  const endsAtStart = makeSleepSession([{ kind: "light", start: day - 3_600_000, end: day }]);
  const endsAtEnd = makeSleepSession([
    { kind: "light", start: day + 3_600_000, end: day + DAY_MS - 1 },
  ]);

  const sessions = getSleepSessionsEndingIn(() => [endsAtStart, endsAtEnd], day, day + DAY_MS - 1);

  expect(sessions).toEqual([endsAtEnd]);
});
