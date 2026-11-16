import { describe, expect, test } from "bun:test";
import type { InsightsResult } from "@openvalens/api/insight-contract";
import { englishI18n } from "@openvalens/i18n/testing";

import { coachIdeas, type CoachIdeaInput } from "./coach-ideas";

type Insight = InsightsResult["insights"][number];

type Metric = "sleep_duration" | "resting_heart_rate" | "steps";

function change(
  metric: Metric,
  topic: Insight["topic"],
  direction: "higher" | "lower",
  unit: "minutes" | "bpm" | "steps",
  recentValue: number,
  baselineValue: number,
): Insight {
  return {
    id: `change.${metric}:2026-11-16`,
    ruleId: `change.${metric}`,
    ruleVersion: "1",
    kind: "change",
    topic,
    windowKey: "2026-11-16",
    windowEnd: "2026-11-16",
    factors: [],
    detail: {
      type: "change",
      metric,
      direction,
      unit,
      recentValue,
      recentDays: 7,
      recentWindowDays: 7,
      baselineValue,
      baselineDays: 28,
      baselineWindowDays: 28,
      difference: recentValue - baselineValue,
      threshold: 1,
      certainty: "clear",
    },
  };
}

const sleepUp = change("sleep_duration", "sleep", "higher", "minutes", 520, 441);
const heartDown = change("resting_heart_rate", "heart", "lower", "bpm", 56, 60);

const allOn: CoachIdeaInput["isEnabled"] = () => true;

function input(overrides: Partial<CoachIdeaInput> = {}): CoachIdeaInput {
  return { insights: [], goals: [], readinessScore: null, isEnabled: allOn, ...overrides };
}

describe("coach ideas (#coach-4)", () => {
  test("turns the person's changes, goals and readiness into questions, by subject", () => {
    const groups = coachIdeas(
      englishI18n,
      input({
        insights: [sleepUp, heartDown],
        goals: [
          { id: 1, title: "65 kg by 15 Jan", definition: { status: "active" } },
          { id: 2, title: "Old goal", definition: { status: "completed" } },
        ],
        readinessScore: 62,
      }),
    );
    const bySubject = Object.fromEntries(
      groups.map((group) => [group.subject, group.ideas.map((idea) => idea.text)]),
    );
    expect(bySubject.sleep?.[0]).toBe("Why is my sleep 1h 19m above my usual this week?");
    expect(bySubject.heart?.[0]).toBe(
      "What changed when my resting heart rate went down to 56 bpm?",
    );
    expect(bySubject.training).toContain("Plan this week's workouts around a readiness of 62");
    expect(bySubject.goals).toEqual(["Am I on track for “65 kg by 15 Jan”?"]);
    // Each subject still offers its general question after the personal ones.
    expect(bySubject.sleep?.at(-1)).toBe("How has my sleep been this week?");
    expect(groups.map((group) => group.subject)).toEqual([
      "sleep",
      "heart",
      "body",
      "training",
      "food",
      "goals",
    ]);
  });

  test("leaves out switched-off modules, and goals when there are none", () => {
    const groups = coachIdeas(
      englishI18n,
      input({
        insights: [sleepUp],
        isEnabled: (module) => module !== "sleep" && module !== "food",
      }),
    );
    const subjects = groups.map((group) => group.subject);
    expect(subjects).not.toContain("sleep");
    expect(subjects).not.toContain("food");
    expect(subjects).not.toContain("goals");
    expect(subjects).toContain("heart");
  });

  test("keeps each group short", () => {
    const goals = Array.from({ length: 6 }, (_, index) => ({
      id: index + 1,
      title: `Goal ${index + 1}`,
      definition: { status: "active" },
    }));
    const groups = coachIdeas(englishI18n, input({ goals }));
    expect(groups.find((group) => group.subject === "goals")?.ideas).toHaveLength(3);
  });
});
