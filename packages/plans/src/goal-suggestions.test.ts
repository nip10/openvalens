import { describe, expect, test } from "bun:test";

import {
  freshGoalSuggestions,
  goalSuggestionRule,
  sleepSuggestion,
  supplementSuggestion,
  waterSuggestion,
} from "./goal-suggestions";
import { validateGoalDefinition } from "./goal-model";

describe("goal suggestions (goals#7)", () => {
  test("sleep: the usual night, rounded up to the next half hour", () => {
    const nights = [7.1, 7.2, 7.3, 7.2, 6.9, 7.4, 7.25];
    expect(sleepSuggestion(nights)).toEqual({
      kind: "sleep",
      source: "sleep",
      metric: "sleep_hours",
      unit: "h",
      target: 7.5,
      usual: 7.2,
      days: 7,
    });
    // Already on a half hour: keep it.
    expect(sleepSuggestion(Array(10).fill(8))).toMatchObject({ target: 8 });
  });

  test("water: the usual day, rounded up to the next 250 ml", () => {
    expect(waterSuggestion([1800, 1600, 1900, 1700, 2100, 1850, 1650, 0])).toMatchObject({
      target: 2000,
      usual: 1800,
      days: 7,
    });
  });

  test("no idea from under a week of data", () => {
    expect(sleepSuggestion([7, 7, 7, 7, 7, 7])).toBeNull();
    expect(waterSuggestion([2000, 2000])).toBeNull();
  });

  test("a supplement is offered once it is taken on half the days", () => {
    expect(supplementSuggestion(4, " Vitamin D ", 13)).toBeNull();
    expect(supplementSuggestion(4, "Vitamin D", 20)).toEqual({
      kind: "supplement",
      source: "supplement",
      metric: "supplement:4",
      unit: null,
      supplementName: "Vitamin D",
      days: 20,
    });
  });

  test("every idea builds a goal the server accepts", () => {
    const ideas = [
      sleepSuggestion(Array(14).fill(7.2))!,
      waterSuggestion(Array(14).fill(1800))!,
      supplementSuggestion(4, "Vitamin D", 20)!,
    ];
    for (const idea of ideas) {
      const checked = validateGoalDefinition({
        id: "00000000-0000-4000-8000-000000000001",
        title: "Idea",
        source: idea.source,
        metric: idea.metric,
        unit: idea.unit,
        rule: goalSuggestionRule(idea),
        startDate: "2026-11-16",
        timeZone: "Europe/Lisbon",
        dayCutoff: null,
        status: "active",
      });
      expect(checked.ok).toBe(true);
    }
  });

  test("ideas you already have a goal for are left out, three at most", () => {
    const ideas = [
      sleepSuggestion(Array(14).fill(7.2))!,
      waterSuggestion(Array(14).fill(1800))!,
      supplementSuggestion(4, "Vitamin D", 20)!,
      supplementSuggestion(5, "Magnesium", 18)!,
    ];
    expect(freshGoalSuggestions(ideas, []).map((idea) => idea.metric)).toEqual([
      "sleep_hours",
      "water_ml",
      "supplement:4",
    ]);
    expect(
      freshGoalSuggestions(ideas, [{ definition: { source: "sleep", metric: "sleep_hours" } }]).map(
        (idea) => idea.metric,
      ),
    ).toEqual(["water_ml", "supplement:4", "supplement:5"]);
  });
});
