/**
 * Behavioural tests for the overlap-replace identity pattern and the Huami
 * stage-window conversion.
 *
 * Upstream has no direct tests for these; they cover
 * `HuamiSleepSessionProvider.kt` at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import { DAY_MS, huamiStageWindow, replaceOverlappingSessions } from "./identity";
import type { SleepStage, StoredSleepSession } from "./types";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const base = Date.UTC(2024, 2, 4);

function stored(
  id: string,
  start: number,
  end: number,
  kind: SleepStage["kind"] = "light",
): StoredSleepSession {
  return { id, start, end, stages: [{ kind, start, end }] };
}

test("overlap-replace grows a session span and keeps its id", () => {
  const existing = [stored("night-1", base + 22 * HOUR_MS, base + 30 * HOUR_MS)];
  const candidate = stored(
    "replacement",
    base + 22 * HOUR_MS + 10 * MINUTE_MS,
    base + 30 * HOUR_MS + 30 * MINUTE_MS,
    "deep",
  );

  const merged = replaceOverlappingSessions(existing, candidate);

  expect(merged).toHaveLength(1);
  expect(merged[0]!.id).toBe("night-1");
  expect(merged[0]!.start).toBe(candidate.start);
  expect(merged[0]!.end).toBe(candidate.end);
  expect(merged[0]!.stages).toEqual(candidate.stages);
});

test("an unchanged re-detection is skipped", () => {
  const existing = [stored("night-1", base + 22 * HOUR_MS, base + 30 * HOUR_MS)];
  const candidate = stored("replacement", base + 22 * HOUR_MS, base + 30 * HOUR_MS);

  const merged = replaceOverlappingSessions(existing, candidate);

  expect(merged).toEqual(existing);
});

test("a non-overlapping candidate is appended with its own id and sorted", () => {
  const existing = [
    stored("evening", base + 22 * HOUR_MS, base + 23 * HOUR_MS),
    stored("morning", base + 30 * HOUR_MS, base + 31 * HOUR_MS),
  ];
  const candidate = stored("night", base + 24 * HOUR_MS, base + 25 * HOUR_MS);

  const merged = replaceOverlappingSessions(existing, candidate);

  expect(merged.map((session) => session.id)).toEqual(["evening", "night", "morning"]);
  expect(merged.map((session) => session.start)).toEqual([
    base + 22 * HOUR_MS,
    base + 24 * HOUR_MS,
    base + 30 * HOUR_MS,
  ]);
});

test("overlapping multiple stored sessions removes all and keeps the earliest id", () => {
  const existing = [
    stored("first", base + 22 * HOUR_MS, base + 23 * HOUR_MS),
    stored("second", base + 23 * HOUR_MS + 30 * MINUTE_MS, base + 30 * HOUR_MS),
  ];
  const candidate = stored(
    "replacement",
    base + 22 * HOUR_MS + 30 * MINUTE_MS,
    base + 30 * HOUR_MS + 30 * MINUTE_MS,
  );

  const merged = replaceOverlappingSessions(existing, candidate);

  expect(merged).toHaveLength(1);
  expect(merged[0]!.id).toBe("first");
  expect(merged[0]!.start).toBe(candidate.start);
  expect(merged[0]!.end).toBe(candidate.end);
});

test("touching sessions do not overlap", () => {
  const existing = [stored("night", base + 22 * HOUR_MS, base + 30 * HOUR_MS)];
  const candidate = stored("morning", base + 30 * HOUR_MS, base + 31 * HOUR_MS);

  const merged = replaceOverlappingSessions(existing, candidate);

  expect(merged.map((session) => session.id)).toEqual(["night", "morning"]);
});

test("Huami stage windows treat the end minute as inclusive", () => {
  // Report midnight is day 2; stage minutes are relative to the previous midnight.
  const reportMidnight = base + DAY_MS;

  const window = huamiStageWindow(reportMidnight, 60, 90);

  expect(window.start).toBe(base + HOUR_MS);
  expect(window.end).toBe(base + HOUR_MS + 31 * MINUTE_MS);
});
