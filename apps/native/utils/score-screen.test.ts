import { describe, expect, test } from "bun:test";
import { computeGoalProgress } from "@openvalens/api/score-goal-progress";
import { computeReadiness } from "@openvalens/api/score-readiness";
import { englishI18n } from "@openvalens/i18n/testing";

import { goalLogValue, goalProgressCard, readinessCard } from "./score-screen";

const AS_OF = "2026-10-15";

function daysBefore(offset: number): string {
  const value = new Date(`${AS_OF}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - offset);
  return value.toISOString().slice(0, 10);
}

const flat = (from: number, to: number, value: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ date: daysBefore(from + i), value }));

describe("native score screen model", () => {
  test("available readiness: experimental badge, score, profile and every input", () => {
    const card = readinessCard(
      computeReadiness(
        {
          sleepMinutes: [...flat(1, 28, 450), { date: AS_OF, value: 405 }],
          restingHeartRate: [],
          steps: [...flat(4, 31, 8000), ...flat(1, 3, 8000)],
        },
        AS_OF,
      ),
      englishI18n,
    );
    expect(card.badge).toBe("Experimental");
    expect(card.scoreText).toBe("45");
    expect(card.scoreSuffix).toBe("out of 100");
    expect(card.notes).toContain("Manual-friendly profile");
    expect(card.rows.map((row) => [row.key, row.value])).toEqual([
      ["sleep", "40"],
      ["resting_heart_rate", "—"],
      ["activity_load", "50"],
      ["hrv", "—"],
      ["check_in", "—"],
    ]);
    expect(card.limits).toMatch(/not medical advice/);
  });

  test("withheld readiness shows a dash and the reason, never a default", () => {
    const card = readinessCard(
      computeReadiness({ sleepMinutes: [], restingHeartRate: [], steps: [] }, AS_OF),
      englishI18n,
    );
    expect(card.scoreText).toBe("—");
    expect(card.scoreSuffix).toBeNull();
    expect(card.notes[0]).toMatch(/not enough recent data/);
  });

  test("goal progress flags a setback on the goal row", () => {
    const card = goalProgressCard(
      computeGoalProgress([
        {
          goal: {
            id: 7,
            organizationId: "org-1",
            title: "Synthetic goal",
            category: "health",
            horizon: null,
            status: "in_progress",
            currentValue: "79",
            targetValue: "70",
            targetDate: null,
            notes: null,
            direction: "decrease",
            baselineValue: "82",
            priority: null,
          },
          checkins: [
            {
              id: 1,
              organizationId: "org-1",
              goalId: 7,
              date: "2026-10-01",
              value: "78",
              notes: null,
              createdAt: "",
            },
            {
              id: 2,
              organizationId: "org-1",
              goalId: 7,
              date: "2026-10-02",
              value: "79",
              notes: null,
              createdAt: "",
            },
          ],
        },
      ]),
      englishI18n,
    );
    expect(card.scoreText).toBe("25%");
    expect(card.rows[0]!.lines).toContain("⚑ Moved away from the target at the last check-in");
    expect(card.notes).toContain("1 goal moved away from the target recently.");
  });

  test("goalLogValue trims and bounds the value", () => {
    expect(goalLogValue("  79 kg ")).toBe("79 kg");
    expect(goalLogValue("   ")).toBeNull();
    expect(goalLogValue("9".repeat(81))).toBeNull();
  });
});
