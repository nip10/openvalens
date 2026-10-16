import { describe, expect, test } from "bun:test";

import {
  activityWindow,
  compareEffort,
  computeActiveMinutes,
  computeWeeklyActivityLoad,
  sessionEffortPoints,
  type ActivitySession,
} from "./load";

/** Issue #99 — pure activity-load calculation. All data is synthetic. */

const AS_OF = "2026-10-16";

function daysBefore(offset: number): string {
  return new Date(Date.parse(`${AS_OF}T00:00:00.000Z`) - offset * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

let counter = 0;
function session(overrides: Partial<ActivitySession> & { daysAgo?: number }): ActivitySession {
  const { daysAgo = 0, ...rest } = overrides;
  counter += 1;
  return {
    ref: `workout:${counter}`,
    date: daysBefore(daysAgo),
    source: "manual",
    durationMinutes: 30,
    intensity: "moderate",
    intensityMethod: "self_reported_talk_test",
    effortRating: 5,
    strengthVolumeKg: null,
    ...rest,
  };
}

/** One rated session in each of the given 7-day windows (0 = this week). */
function weekly(windows: number[], rating = 5, minutes = 30, source = "manual"): ActivitySession[] {
  return windows.map((index) =>
    session({ daysAgo: index * 7 + 1, effortRating: rating, durationMinutes: minutes, source }),
  );
}

describe("windows", () => {
  test("the current window is the 7 days ending asOf; earlier windows do not overlap", () => {
    expect(activityWindow(AS_OF, 0)).toEqual({ start: "2026-10-10", end: "2026-10-16" });
    expect(activityWindow(AS_OF, 1)).toEqual({ start: "2026-10-03", end: "2026-10-09" });
  });
});

describe("active minutes (WHO)", () => {
  test("vigorous minutes count double; light minutes are not counted", () => {
    const result = computeActiveMinutes([
      session({ intensity: "moderate", durationMinutes: 60 }),
      session({ intensity: "vigorous", durationMinutes: 30 }),
      session({ intensity: "light", durationMinutes: 45 }),
    ]);
    expect(result).toMatchObject({
      status: "available",
      activeMinutes: 120,
      moderateMinutes: 60,
      vigorousMinutes: 30,
      lightMinutes: 45,
      whoRange: { lower: 150, upper: 300 },
      whoPosition: "below_range",
    });
  });

  test("positions against the 150–300 range, inclusive", () => {
    const at = (minutes: number) =>
      computeActiveMinutes([session({ durationMinutes: minutes })]).whoPosition;
    expect(at(149)).toBe("below_range");
    expect(at(150)).toBe("within_range");
    expect(at(300)).toBe("within_range");
    expect(at(301)).toBe("above_range");
    // 75 vigorous minutes reach the lower bound on their own.
    expect(
      computeActiveMinutes([session({ intensity: "vigorous", durationMinutes: 75 })]).whoPosition,
    ).toBe("within_range");
  });

  test("sessions without an intensity are reported as missing, never counted", () => {
    const result = computeActiveMinutes([
      session({ intensity: "moderate", durationMinutes: 40 }),
      session({ intensity: null, intensityMethod: "none", durationMinutes: 50 }),
      session({ intensity: "vigorous", durationMinutes: null }),
    ]);
    expect(result.activeMinutes).toBe(40);
    expect(result.coverage).toEqual({
      sessions: 3,
      sessionsWithIntensity: 2,
      sessionsMissingIntensity: 1,
      minutesMissingIntensity: 50,
      sessionsMissingDuration: 1,
      intensityMethods: ["self_reported_talk_test"],
    });
  });

  test("no sessions and no intensities are unavailable, not zero", () => {
    expect(computeActiveMinutes([])).toMatchObject({
      status: "no_sessions",
      activeMinutes: null,
      whoPosition: null,
    });
    const wearableOnly = computeActiveMinutes([
      session({ source: "device:4", intensity: null, intensityMethod: "none", effortRating: null }),
    ]);
    expect(wearableOnly).toMatchObject({ status: "no_intensity", activeMinutes: null });
    expect(wearableOnly.coverage.minutesMissingIntensity).toBe(30);
  });
});

describe("effort points (session-RPE)", () => {
  test("rating × minutes; missing ratings or durations give no points", () => {
    expect(sessionEffortPoints({ effortRating: 7, durationMinutes: 45 })).toBe(315);
    expect(sessionEffortPoints({ effortRating: null, durationMinutes: 45 })).toBeNull();
    expect(sessionEffortPoints({ effortRating: 7, durationMinutes: null })).toBeNull();
    expect(sessionEffortPoints({ effortRating: 0, durationMinutes: 45 })).toBe(0);
  });

  test("sums per day and over the week; unrated sessions are shown as missing", () => {
    const load = computeWeeklyActivityLoad({
      asOf: AS_OF,
      sessions: [
        session({ daysAgo: 0, effortRating: 7, durationMinutes: 45 }),
        session({ daysAgo: 0, effortRating: null, durationMinutes: 20 }),
        session({ daysAgo: 2, effortRating: 4, durationMinutes: 60 }),
        session({ daysAgo: 3, effortRating: 6, durationMinutes: null }),
      ],
      steps: [],
    });
    expect(load.effort.status).toBe("available");
    expect(load.effort.points).toBe(315 + 240);
    expect(load.effort.coverage).toEqual({
      sessions: 4,
      ratedSessions: 3,
      unratedSessions: 1,
      ratedMissingDuration: 1,
    });
    const byDate = Object.fromEntries(load.effort.days.map((d) => [d.date, d]));
    expect(load.effort.days).toHaveLength(7);
    expect(byDate[daysBefore(0)]).toMatchObject({
      points: 315,
      ratedSessions: 1,
      unratedSessions: 1,
    });
    expect(byDate[daysBefore(1)]).toMatchObject({
      points: null,
      ratedSessions: 0,
      unratedSessions: 0,
    });
    expect(byDate[daysBefore(3)]!.points).toBeNull();
  });

  test("a week with only unrated sessions has no number", () => {
    const load = computeWeeklyActivityLoad({
      asOf: AS_OF,
      sessions: [session({ effortRating: null })],
      steps: [],
    });
    expect(load.effort).toMatchObject({ status: "no_ratings", points: null });
  });

  test("a manual-only user gets both numbers without any wearable data", () => {
    const load = computeWeeklyActivityLoad({
      asOf: AS_OF,
      sessions: [session({ intensity: "vigorous", durationMinutes: 40, effortRating: 8 })],
      steps: [],
    });
    expect(load.activeMinutes.activeMinutes).toBe(80);
    expect(load.effort.points).toBe(320);
    expect(load.context).toEqual({
      steps: null,
      stepDays: 0,
      strengthVolumeKg: null,
      strengthSessions: 0,
    });
  });
});

describe("comparison with your own earlier weeks", () => {
  test("steady load: similar, and the current week is not in the baseline", () => {
    const result = compareEffort(weekly([0, 1, 2, 3, 4]), AS_OF);
    expect(result).toMatchObject({
      status: "available",
      band: "similar",
      currentPoints: 150,
      baselineAverage: 150,
      relativeDifference: 0,
      baselineWindows: 4,
    });
  });

  test("a genuine spike is well above; a quiet week is well below", () => {
    const spike = compareEffort([...weekly([1, 2, 3, 4]), ...weekly([0], 8, 60)], AS_OF);
    expect(spike).toMatchObject({ status: "available", band: "well_above", currentPoints: 480 });
    expect(spike.relativeDifference).toBeCloseTo(480 / 150 - 1);
    const quiet = compareEffort([...weekly([1, 2, 3, 4]), ...weekly([0], 2, 30)], AS_OF);
    expect(quiet.band).toBe("well_below");
    // Below the jump threshold stays "similar".
    expect(compareEffort([...weekly([1, 2, 3, 4]), ...weekly([0], 7)], AS_OF).band).toBe("similar");
  });

  test("the current week being far higher does not raise its own baseline", () => {
    const result = compareEffort([...weekly([1, 2, 3]), ...weekly([0], 10, 120)], AS_OF);
    expect(result.baselineAverage).toBe(150);
  });

  test("sparse logging withholds the comparison", () => {
    const result = compareEffort(weekly([0, 2, 4]), AS_OF);
    expect(result).toMatchObject({
      status: "insufficient_history",
      band: null,
      baselineAverage: null,
      baselineWindows: 2,
      baselineMinWindows: 3,
    });
    // Unrated weeks are missing, not zero: they neither count nor lower the average.
    const unrated = compareEffort(
      [...weekly([0, 1, 2]), session({ daysAgo: 22, effortRating: null })],
      AS_OF,
    );
    expect(unrated.status).toBe("insufficient_history");
  });

  test("a device switch segments the history", () => {
    const result = compareEffort(
      [...weekly([2, 3, 4], 5, 30, "device:1"), ...weekly([0, 1], 5, 30, "device:2")],
      AS_OF,
    );
    expect(result).toMatchObject({
      status: "history_segmented",
      band: null,
      baselineWindows: 1,
      segmentedBefore: activityWindow(AS_OF, 2).end,
    });
    // Once enough weeks exist with the new source, the comparison returns.
    const later = compareEffort(
      weekly([0, 1, 2, 3], 5, 30, "device:2").concat(weekly([4], 5, 30, "device:1")),
      AS_OF,
    );
    expect(later).toMatchObject({ status: "available", baselineWindows: 3 });
  });

  test("no rated session this week: nothing to compare", () => {
    expect(compareEffort(weekly([1, 2, 3, 4]), AS_OF)).toMatchObject({
      status: "no_current_effort",
      currentPoints: null,
    });
  });

  test("a baseline of 0-rated sessions compares without dividing by zero", () => {
    const zero = weekly([1, 2, 3], 0);
    expect(compareEffort([...zero, ...weekly([0], 0)], AS_OF).band).toBe("similar");
    const result = compareEffort([...zero, ...weekly([0])], AS_OF);
    expect(result).toMatchObject({ band: "well_above", relativeDifference: null });
  });
});

describe("context", () => {
  test("steps and strength volume are descriptive only", () => {
    const load = computeWeeklyActivityLoad({
      asOf: AS_OF,
      sessions: [
        session({ strengthVolumeKg: 2500 }),
        session({ daysAgo: 8, strengthVolumeKg: 9999 }),
      ],
      steps: [
        { date: daysBefore(0), steps: 4000 },
        { date: daysBefore(1), steps: null },
        { date: daysBefore(2), steps: 6000 },
        { date: daysBefore(9), steps: 50_000 },
      ],
    });
    expect(load.context).toEqual({
      steps: 10_000,
      stepDays: 2,
      strengthVolumeKg: 2500,
      strengthSessions: 1,
    });
    // Neither changes the effort points.
    expect(load.effort.points).toBe(150);
  });
});
