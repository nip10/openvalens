import { expect, test } from "bun:test";

import type { ActivitySession } from "./load";
import { summarizeWorkoutDays } from "./queries";

/** activity#7 — the chart's workout days. Synthetic sessions only. */
const session = (date: string, durationMinutes: number | null, ref: string): ActivitySession => ({
  ref,
  date,
  source: "manual",
  durationMinutes,
  intensity: null,
  intensityMethod: "none",
  effortRating: null,
  strengthVolumeKg: null,
});

test("counts each day's sessions and adds up the minutes it knows", () => {
  expect(
    summarizeWorkoutDays([
      session("2026-10-02", 30, "workout:1"),
      session("2026-10-01", 45, "workout:2"),
      session("2026-10-02", null, "health_event:3"),
      session("2026-10-02", 19.6, "health_event:4"),
    ]),
  ).toEqual([
    { date: "2026-10-01", count: 1, minutes: 45 },
    { date: "2026-10-02", count: 3, minutes: 50 },
  ]);
});

test("a day whose sessions have no duration has a count but no minutes", () => {
  expect(summarizeWorkoutDays([session("2026-10-03", null, "health_event:5")])).toEqual([
    { date: "2026-10-03", count: 1, minutes: null },
  ]);
  expect(summarizeWorkoutDays([])).toEqual([]);
});
