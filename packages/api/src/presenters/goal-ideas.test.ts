import { describe, expect, test } from "bun:test";
import { englishI18n, inEnglish } from "@openvalens/i18n/testing";
import { validateGoalDefinition } from "@openvalens/plans/goal-model";
import {
  sleepSuggestion,
  supplementSuggestion,
  waterSuggestion,
} from "@openvalens/plans/goal-suggestions";

import {
  GOAL_IDEAS_COPY,
  goalProjectionText,
  goalSuggestionSeed,
  goalSuggestionView,
} from "./goal-ideas";

describe("goal ideas presenter (goals#4, goals#7)", () => {
  test("the estimate always says it is one", () => {
    expect(goalProjectionText(englishI18n, { date: "2027-01-15", perWeek: -0.3, points: 20 })).toBe(
      "On track for Jan 15, 2027 (estimate)",
    );
    expect(inEnglish(GOAL_IDEAS_COPY.projectionExplanation)).toMatch(/^An estimate, not a promise/);
  });

  test("each idea shows the member's own figure it came from", () => {
    const sleep = goalSuggestionView(englishI18n, sleepSuggestion(Array(14).fill(7.2))!);
    expect(sleep).toEqual({
      key: "sleep_hours",
      label: "Sleep 7.5 h a night",
      basis: "Your usual: 7h 12m a night",
    });
    const water = goalSuggestionView(englishI18n, waterSuggestion(Array(10).fill(1800))!);
    expect(water.label).toBe("Drink 2,000 ml of water a day");
    expect(water.basis).toBe("Your usual: 1,800 ml on days you log water");
    const vitaminD = goalSuggestionView(englishI18n, supplementSuggestion(4, "Vitamin D", 20)!);
    expect(vitaminD.label).toBe("Take Vitamin D every day");
    expect(vitaminD.basis).toBe("You logged it on 20 of the last 28 days");
  });

  test("an idea opens a valid new goal, named after the chip", () => {
    const seed = goalSuggestionSeed(englishI18n, waterSuggestion(Array(10).fill(1800))!, {
      id: "00000000-0000-4000-8000-000000000001",
      startDate: "2026-11-16",
      timeZone: "Europe/Lisbon",
    });
    expect(seed).toMatchObject({
      title: "Drink 2,000 ml of water a day",
      source: "water",
      metric: "water_ml",
      unit: "ml",
      rule: { kind: "recurring", cadence: "daily", completion: { kind: "minimum", value: 2000 } },
    });
    expect(validateGoalDefinition(seed).ok).toBe(true);
  });

  test("the copy follows the health-copy rules", () => {
    const BANNED = /\b(healthy|unhealthy|optimal|recommended|should|risk|diagnos\w*|predict\w*)\b/i;
    for (const copy of Object.values(GOAL_IDEAS_COPY)) expect(inEnglish(copy)).not.toMatch(BANNED);
  });
});
