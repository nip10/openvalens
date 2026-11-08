/**
 * Behavioural tests ported from Gadgetbridge's `SleepSessionSegmenterTest`.
 *
 * Upstream: `app/src/test/java/nodomain/freeyourgadget/gadgetbridge/devices/SleepSessionSegmenterTest.java`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/test/java/nodomain/freeyourgadget/gadgetbridge/devices/SleepSessionSegmenterTest.java
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * Upstream samples carry epoch seconds; these helpers convert them to the
 * module's epoch-millisecond convention so the test bodies stay comparable
 * to the originals.
 */

import { expect, test } from "bun:test";

import { segment } from "./segmenter";
import { sessionDurationSeconds, totalSleepDurationSeconds } from "./types";
import type { SleepActivitySample, SleepSession, SleepStage, SleepStageKind } from "./types";

function sleep(timestampSeconds: number, kind: SleepStageKind): SleepActivitySample {
  return { time: timestampSeconds * 1000, kind, steps: 0 };
}

function idle(timestampSeconds: number): SleepActivitySample {
  return { time: timestampSeconds * 1000, kind: "activity", steps: 0 };
}

function activity(timestampSeconds: number, steps: number): SleepActivitySample {
  return { time: timestampSeconds * 1000, kind: "activity", steps };
}

function stage(kind: SleepStageKind, startSeconds: number, endSeconds: number): SleepStage {
  return { kind, start: startSeconds * 1000, end: endSeconds * 1000 };
}

function assertStages(session: SleepSession, ...expected: SleepStage[]): void {
  expect(session.stages).toEqual(expected);
}

test("empty samples, no sessions", () => {
  expect(segment([])).toHaveLength(0);
});

test("single sleep type is one stage with a fixed trailing pad", () => {
  const samples = [sleep(0, "light"), sleep(300, "light"), sleep(600, "light")];

  const sessions = segment(samples);

  expect(sessions).toHaveLength(1);
  const session = sessions[0]!;
  expect(session.stages).toHaveLength(1);
  // Trailing pad is a fixed 60s, not derived from the 300s sampling interval used here.
  expect(session.start).toBe(0);
  expect(session.end).toBe(660_000);
  expect(sessionDurationSeconds(session, "light")).toBe(660);
});

test("mixed sleep types produce three stages", () => {
  const samples = [sleep(0, "light"), sleep(300, "deep"), sleep(600, "rem"), sleep(900, "light")];

  const sessions = segment(samples);

  expect(sessions).toHaveLength(1);
  const session = sessions[0]!;
  // The first sample's own kind (light) never becomes a stage; only the delta *into* a kind
  // change is attributed, so the session opens directly on deep.
  assertStages(session, stage("deep", 0, 300), stage("rem", 300, 600), stage("light", 600, 960));
  expect(sessionDurationSeconds(session, "deep")).toBe(300);
  expect(sessionDurationSeconds(session, "rem")).toBe(300);
  expect(sessionDurationSeconds(session, "light")).toBe(360);
});

test("a session that is too short produces no session", () => {
  const tooShort = [sleep(0, "light"), sleep(240, "light")];
  expect(segment(tooShort)).toHaveLength(0);

  // One second longer clears the (span + trailing pad) > MIN_SESSION_LENGTH_SECONDS threshold.
  const justLongEnough = [sleep(0, "light"), sleep(241, "light")];
  expect(segment(justLongEnough)).toHaveLength(1);
});

test("a gap bridged by resuming sleep folds into an awake stage", () => {
  const samples = [
    sleep(0, "light"),
    sleep(60, "deep"),
    idle(120),
    idle(180),
    sleep(240, "light"),
    sleep(300, "deep"),
  ];

  const sessions = segment(samples);

  expect(sessions).toHaveLength(1);
  const session = sessions[0]!;
  assertStages(
    session,
    stage("deep", 0, 60),
    stage("awake", 60, 180),
    stage("light", 180, 240),
    stage("deep", 240, 360),
  );
  expect(sessionDurationSeconds(session, "deep")).toBe(180);
  expect(sessionDurationSeconds(session, "awake")).toBe(120);
  expect(sessionDurationSeconds(session, "light")).toBe(60);
});

test("a gap closed by activity excludes the active sample", () => {
  const samples = [sleep(0, "deep"), sleep(600, "deep"), idle(1200), activity(1800, 100)];

  const sessions = segment(samples);

  expect(sessions).toHaveLength(1);
  const session = sessions[0]!;
  assertStages(session, stage("deep", 0, 660));
  expect(sessionDurationSeconds(session, "deep")).toBe(660);
});

test("a gap closed by timeout needs no steps", () => {
  const samples = [
    sleep(0, "deep"),
    sleep(1800, "deep"),
    // 3660s after the last sleep sample - past the 1h wake-phase limit on its own.
    idle(5460),
  ];

  const sessions = segment(samples);

  expect(sessions).toHaveLength(1);
  assertStages(sessions[0]!, stage("deep", 0, 1860));
});

test("device-reported awake sleep is attributed like any sleep stage", () => {
  const samples = [
    sleep(0, "deep"),
    sleep(600, "deep"),
    sleep(1200, "awake"),
    sleep(1800, "awake"),
    sleep(2400, "light"),
  ];

  const sessions = segment(samples);

  expect(sessions).toHaveLength(1);
  const session = sessions[0]!;
  assertStages(
    session,
    stage("deep", 0, 600),
    stage("awake", 600, 1800),
    stage("light", 1800, 2460),
  );
  expect(sessionDurationSeconds(session, "deep")).toBe(600);
  expect(sessionDurationSeconds(session, "awake")).toBe(1200);
});

test("sleep-any counts toward total but not light, deep or REM", () => {
  const samples = [sleep(0, "light"), sleep(600, "any"), sleep(1200, "light")];

  const sessions = segment(samples);

  expect(sessions).toHaveLength(1);
  const session = sessions[0]!;
  assertStages(session, stage("any", 0, 600), stage("light", 600, 1260));
  expect(sessionDurationSeconds(session, "light")).toBe(660);
  expect(sessionDurationSeconds(session, "deep")).toBe(0);
  expect(totalSleepDurationSeconds(session)).toBe(1260);
});

test("multiple sessions separated by activity produce two sessions", () => {
  const samples = [
    sleep(0, "light"),
    sleep(600, "deep"),
    activity(601, 200),
    sleep(602, "light"),
    sleep(1202, "rem"),
  ];

  const sessions = segment(samples);

  expect(sessions).toHaveLength(2);
  assertStages(sessions[0]!, stage("deep", 0, 660));
  assertStages(sessions[1]!, stage("rem", 602, 1262));
});

test("stages are contiguous", () => {
  const samples = [sleep(0, "light"), sleep(300, "deep"), sleep(600, "rem"), sleep(900, "light")];
  const stages = segment(samples)[0]!.stages;

  for (let index = 1; index < stages.length; index += 1) {
    expect(stages[index - 1]!.end, `stage ${index - 1} end must equal stage ${index} start`).toBe(
      stages[index]!.start,
    );
  }
  // ... and every session's own bounds are never null/degenerate - start strictly precedes end.
  expect(stages[0]!.start).toBeLessThan(stages[stages.length - 1]!.end);
});
