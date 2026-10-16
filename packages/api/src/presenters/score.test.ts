import { describe, expect, test } from "bun:test";

import type { GoalProgressResult, ReadinessResult } from "../score-contract";
import { computeGoalProgress } from "../score-goal-progress";
import { computeReadiness, readinessAdultsOnly } from "../score-readiness";
import {
  formatReadinessValue,
  formatRelativeDifference,
  GOAL_PROGRESS_WITHHELD_EXPLANATIONS,
  GOAL_RESULT_STATE_LABELS,
  goalProgressView,
  READINESS_INPUT_LABELS,
  READINESS_INPUT_STATE_LABELS,
  READINESS_PROFILE_DESCRIPTIONS,
  READINESS_PROFILE_LABELS,
  READINESS_WITHHELD_EXPLANATIONS,
  readinessView,
  SCORE_COPY,
} from "./score";

const AS_OF = "2026-10-15";

function daysBefore(offset: number): string {
  const value = new Date(`${AS_OF}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - offset);
  return value.toISOString().slice(0, 10);
}

function flat(from: number, to: number, value: number) {
  return Array.from({ length: to - from + 1 }, (_, i) => ({ date: daysBefore(from + i), value }));
}

const available: ReadinessResult = computeReadiness(
  {
    sleepMinutes: [...flat(1, 28, 450), { date: AS_OF, value: 405 }],
    restingHeartRate: [...flat(1, 28, 60), { date: AS_OF, value: 63 }],
    steps: [],
  },
  AS_OF,
);

describe("readinessView", () => {
  test("labels the score experimental and shows profile, coverage and parts", () => {
    const view = readinessView(available);
    expect(view.badge).toBe("Experimental");
    expect(view.scoreText).toBe("38");
    expect(view.accessibilityLabel).toBe(
      "Experimental readiness index 38 out of 100, physiology-enhanced profile.",
    );
    expect(view.profileLabel).toBe("Physiology-enhanced profile");
    expect(view.coverageText).toBe(
      "Uses 2 of 3 inputs for this profile: Sleep and Resting heart rate.",
    );
    expect(view.wouldHelpText).toBe("More data for Recent activity load would help.");
    expect(view.withheldExplanation).toBeNull();
    const sleep = view.components.find((c) => c.key === "sleep")!;
    expect(sleep).toMatchObject({ used: true, scoreText: "40", stateLabel: "Used" });
    expect(sleep.detail).toBe(
      "Recent 6h 45m vs usual 7h 30m (median of 28 days), 10% below your usual.",
    );
    expect(view.versionText).toBe("Method readiness-0.1.0-experimental, as of 2026-10-15.");
  });

  test("a withheld score shows no number, a reason and what would help", () => {
    const view = readinessView(
      computeReadiness({ sleepMinutes: [], restingHeartRate: [], steps: [] }, AS_OF),
    );
    expect(view.available).toBe(false);
    expect(view.scoreText).toBe("—");
    expect(view.withheldExplanation).toBe(READINESS_WITHHELD_EXPLANATIONS.insufficient_inputs);
    expect(view.wouldHelpText).toBe(
      "More data for Sleep, Resting heart rate and Recent activity load would help.",
    );
    expect(view.components.find((c) => c.key === "hrv")?.stateLabel).toBe(
      "Not recorded by OpenValens yet",
    );
  });

  test("adults-only result explains itself", () => {
    const view = readinessView(readinessAdultsOnly(AS_OF));
    expect(view.withheldExplanation).toBe(READINESS_WITHHELD_EXPLANATIONS.adults_only);
    expect(view.components).toEqual([]);
  });
});

describe("goalProgressView", () => {
  const result: GoalProgressResult = computeGoalProgress([
    {
      goal: {
        id: 1,
        organizationId: "org-1",
        title: "Synthetic weight goal",
        category: "body_composition",
        horizon: null,
        status: "in_progress",
        currentValue: "79",
        targetValue: "70",
        targetDate: null,
        notes: null,
        direction: "decrease",
        baselineValue: "82",
        priority: "high",
      },
      checkins: [
        {
          id: 1,
          organizationId: "org-1",
          goalId: 1,
          date: "2026-10-01",
          value: "78",
          notes: null,
          createdAt: "2026-10-01T00:00:00.000Z",
        },
        {
          id: 2,
          organizationId: "org-1",
          goalId: 1,
          date: "2026-10-08",
          value: "79",
          notes: null,
          createdAt: "2026-10-08T00:00:00.000Z",
        },
      ],
    },
  ]);

  test("shows the total, each goal, its priority share and a setback flag", () => {
    const view = goalProgressView(result);
    expect(view.scoreText).toBe("25%");
    expect(view.coverageText).toBe("1 of 1 goals counted.");
    expect(view.flaggedText).toBe("1 goal moved away from the target recently.");
    expect(view.goals[0]).toMatchObject({
      title: "Synthetic weight goal",
      counted: true,
      progressText: "25%",
      detail: "Start 82, now 79, target 70 (down).",
      priorityText: "High priority, 100% of the total",
      flagText: "Moved away from the target at the last check-in",
    });
  });

  test("withheld goal progress shows no number", () => {
    const view = goalProgressView(computeGoalProgress([]));
    expect(view.scoreText).toBe("—");
    expect(view.withheldExplanation).toBe(GOAL_PROGRESS_WITHHELD_EXPLANATIONS.no_goals);
  });
});

describe("formatting", () => {
  test("values and differences", () => {
    expect(formatReadinessValue(425, "minutes")).toBe("7h 05m");
    expect(formatReadinessValue(58.4, "bpm")).toBe("58 bpm");
    expect(formatReadinessValue(12345, "steps_per_day")).toBe("12,345 steps a day");
    expect(formatReadinessValue(null, "bpm")).toBe("—");
    expect(formatRelativeDifference(0.004)).toBe("in line with your usual");
    expect(formatRelativeDifference(0.12)).toBe("12% above your usual");
    expect(formatRelativeDifference(null)).toBeNull();
  });
});

describe("copy", () => {
  // Health-copy rules (CONTRIBUTING.md, Legal and clinical gate decisions §10).
  const BANNED =
    /\b(diagnos\w*|detects?|screens? for|prevent\w*|treat\w*|cure\w*|at risk|risk score|abnormal|clinical-grade|medical-grade|early warning|predict\w*|injur\w*|clinically|optimal|healthy|unhealthy)\b/i;

  test("score copy follows the health-copy rules", () => {
    const texts = [
      ...Object.values(SCORE_COPY),
      ...Object.values(READINESS_INPUT_LABELS),
      ...Object.values(READINESS_INPUT_STATE_LABELS),
      ...Object.values(READINESS_PROFILE_LABELS),
      ...Object.values(READINESS_PROFILE_DESCRIPTIONS),
      ...Object.values(READINESS_WITHHELD_EXPLANATIONS),
      ...Object.values(GOAL_RESULT_STATE_LABELS),
      ...Object.values(GOAL_PROGRESS_WITHHELD_EXPLANATIONS),
      ...readinessView(available).components.map((c) => c.accessibilityLabel),
      ...goalProgressView(computeGoalProgress([])).goals.map((g) => g.accessibilityLabel),
    ];
    for (const text of texts) expect(text).not.toMatch(BANNED);
  });

  test("readiness copy says it is experimental and not advice", () => {
    expect(SCORE_COPY.experimentalBadge).toBe("Experimental");
    expect(SCORE_COPY.readinessIntro).toMatch(/experimental/i);
    expect(SCORE_COPY.readinessLimits).toMatch(/not medical advice/);
    expect(SCORE_COPY.pageIntro).toMatch(/never combined/);
  });
});
