import { describe, expect, test } from "bun:test";
import type { ActivityLoadResult } from "@openvalens/api/activity-load-contract";

import { activityLoadScreen, toggleEffort, toggleIntensity } from "./activity-load-screen";

/** Issue #99 — native weekly activity model. Synthetic fixture shaped like `activity.weeklyLoad`. */

const days = [
  "2026-10-10",
  "2026-10-11",
  "2026-10-12",
  "2026-10-13",
  "2026-10-14",
  "2026-10-15",
  "2026-10-16",
];

function result(
  overrides: Partial<NonNullable<ActivityLoadResult["load"]>> = {},
): ActivityLoadResult {
  return {
    kind: "activity_load",
    status: "available",
    withheldReason: null,
    load: {
      algorithmVersion: "activity-load-0.1.0",
      asOf: "2026-10-16",
      window: { start: "2026-10-10", end: "2026-10-16", days: 7 },
      activeMinutes: {
        status: "available",
        activeMinutes: 160,
        moderateMinutes: 60,
        vigorousMinutes: 50,
        lightMinutes: 0,
        whoRange: { lower: 150, upper: 300 },
        whoPosition: "within_range",
        coverage: {
          sessions: 3,
          sessionsWithIntensity: 2,
          sessionsMissingIntensity: 1,
          minutesMissingIntensity: 40,
          sessionsMissingDuration: 0,
          intensityMethods: ["self_reported_talk_test"],
        },
      },
      effort: {
        status: "available",
        points: 700,
        days: days.map((date, index) => ({
          date,
          points: index === 6 ? 400 : index === 4 ? 300 : null,
          ratedSessions: index === 6 || index === 4 ? 1 : 0,
          unratedSessions: index === 5 ? 1 : 0,
        })),
        coverage: { sessions: 3, ratedSessions: 2, unratedSessions: 1, ratedMissingDuration: 0 },
      },
      comparison: {
        status: "insufficient_history",
        band: null,
        currentPoints: 700,
        baselineAverage: null,
        relativeDifference: null,
        baselineWindows: 1,
        baselineWindowsConsidered: 4,
        baselineMinWindows: 3,
        segmentedBefore: null,
      },
      context: { steps: 41000, stepDays: 6, strengthVolumeKg: null, strengthSessions: 0 },
      ...overrides,
    },
  };
}

describe("native activity load screen model", () => {
  test("both numbers with units, status, breakdown, coverage, formula and WHO source", () => {
    const screen = activityLoadScreen(result());
    expect(screen.windowText).toBe("Last 7 days: Sat 10 Oct – Fri 16 Oct");
    const [active, effort] = screen.numbers;
    expect(active).toMatchObject({ key: "active_minutes", valueText: "160", unitText: "min" });
    expect(active!.lines).toEqual([
      "Within the WHO range of 150–300 minutes a week.",
      "Moderate: 60 min",
      "Vigorous: 50 min (counts double)",
      "Light: 0 min (not counted)",
      "2 of 3 sessions have an intensity.",
      "40 min without an intensity are not counted.",
    ]);
    expect(active!.method.join(" ")).toContain("doi:10.1136/bjsports-2020-102955");
    expect(effort).toMatchObject({ key: "effort_points", valueText: "700", unitText: "points" });
    expect(effort!.lines).toContain("Sessions without a rating are left out, not estimated.");
  });

  test("days, comparison withheld below the threshold, context and footer", () => {
    const screen = activityLoadScreen(result());
    expect(screen.dayRows.map((row) => row.value)).toEqual([
      "—",
      "—",
      "—",
      "—",
      "300 points",
      "not rated",
      "400 points",
    ]);
    expect(screen.comparison!.lines[0]).toBe(
      "Shown once at least 3 of the previous 4 weeks have rated sessions (found 1).",
    );
    expect(screen.context[0]).toBe("Steps: 41,000 over 6 days with step data.");
    expect(screen.footer.at(-1)).toContain("activity-load-0.1.0");
  });

  test("no sessions: dashes with the reason, never zero; no unit shown", () => {
    const base = result().load!;
    const screen = activityLoadScreen(
      result({
        activeMinutes: {
          ...base.activeMinutes,
          status: "no_sessions",
          activeMinutes: null,
          whoPosition: null,
        },
        effort: { ...base.effort, status: "no_sessions", points: null },
      }),
    );
    for (const number of screen.numbers) {
      expect(number.valueText).toBe("—");
      expect(number.unitText).toBeNull();
      expect(number.lines[0]).toContain("not zero");
    }
  });

  test("withheld for a declared under-18: explanation only", () => {
    const screen = activityLoadScreen({
      kind: "activity_load",
      status: "withheld",
      withheldReason: "adults_only",
      load: null,
    });
    expect(screen.numbers).toEqual([]);
    expect(screen.comparison).toBeNull();
    expect(screen.withheldExplanation).toBe(
      "Weekly activity is for adults 18 and over, based on your profile answer.",
    );
  });

  test("choices toggle back to not recorded", () => {
    expect(toggleIntensity(null, "moderate")).toBe("moderate");
    expect(toggleIntensity("moderate", "moderate")).toBeNull();
    expect(toggleEffort(null, 0)).toBe(0);
    expect(toggleEffort(7, 7)).toBeNull();
  });
});
