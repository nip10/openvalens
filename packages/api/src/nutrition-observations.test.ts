import { describe, expect, test } from "bun:test";

import {
  buildNutritionObservations,
  type NutritionObservationInput,
} from "./nutrition-observations";

const base: NutritionObservationInput = {
  memberId: "member-a",
  window: { from: "2026-10-01", to: "2026-10-07" },
  optedIn: true,
  permissions: { nutrition: true, sleep: true, activity: true },
  hideNumbers: false,
  meals: [1, 2, 3].map((day) => ({
    memberId: "member-a",
    consumedAt: `2026-10-0${day}T18:00:00Z`,
    complete: true,
  })),
  sleep: [1, 2, 3].map((day) => ({
    memberId: "member-a",
    startedAt: `2026-10-0${day}T21:00:00Z`,
    complete: true,
  })),
  workouts: [1, 2, 3].map((day) => ({
    memberId: "member-a",
    startedAt: `2026-10-0${day}T19:00:00Z`,
    complete: true,
  })),
};

describe("buildNutritionObservations", () => {
  test.each([
    ["opt-in is off", { optedIn: false }],
    ["nutrition permission is absent", { permissions: { ...base.permissions, nutrition: false } }],
    ["sleep permission is absent", { permissions: { ...base.permissions, sleep: false } }],
    ["activity permission is absent", { permissions: { ...base.permissions, activity: false } }],
  ] as const)("fails closed when %s", (_label, patch) => {
    const result = buildNutritionObservations({ ...base, ...patch });
    if (_label === "sleep permission is absent")
      expect(result.map((item) => item.ruleId)).toEqual(["observation.meals_and_workouts"]);
    else if (_label === "activity permission is absent")
      expect(result.map((item) => item.ruleId)).toEqual(["observation.meals_near_sleep"]);
    else expect(result).toEqual([]);
  });

  test.each([
    ["no timestamps", { meals: [], sleep: [], workouts: [] }],
    [
      "invalid timestamps",
      {
        meals: base.meals.map((meal) => ({ ...meal, consumedAt: "not-a-time" })),
      },
    ],
    ["incomplete meals", { meals: base.meals.map((meal) => ({ ...meal, complete: false })) }],
    [
      "incomplete event records",
      {
        sleep: base.sleep.map((row) => ({ ...row, complete: false })),
        workouts: base.workouts.map((row) => ({ ...row, complete: false })),
      },
    ],
  ] as const)("omits observations for %s", (_label, patch) => {
    expect(buildNutritionObservations({ ...base, ...patch })).toEqual([]);
  });

  test("excludes records outside the declared window and requires three matching events", () => {
    const outside = {
      ...base,
      meals: base.meals.map((meal) => ({ ...meal, consumedAt: "2026-09-30T18:00:00Z" })),
    };
    expect(buildNutritionObservations(outside)).toEqual([]);
    expect(buildNutritionObservations({ ...base, meals: base.meals.slice(0, 2) })).toEqual([]);
  });

  test("does not match records belonging to another member", () => {
    expect(
      buildNutritionObservations({
        ...base,
        meals: base.meals.map((meal) => ({ ...meal, memberId: "member-b" })),
      }),
    ).toEqual([]);
  });

  test("emits only descriptive co-occurrence with period and completeness", () => {
    const result = buildNutritionObservations(base);
    expect(result.map(({ ruleId }) => ruleId)).toEqual([
      "observation.meals_near_sleep",
      "observation.meals_and_workouts",
    ]);
    for (const observation of result) {
      expect(observation.window).toEqual({ from: "2026-10-01", to: "2026-10-07", days: 7 });
      expect(observation.completeness).toContain(
        "3 matching timestamped records from completed diary days",
      );
      expect(observation.body.toLowerCase()).toMatch(/records only/);
      expect(observation.body.toLowerCase()).toMatch(/does not establish a relationship/);
      expect(observation.body.toLowerCase()).not.toMatch(
        /meals (cause|caused|change|changed) (sleep|workouts)|diagnos|recommend|should|avoid|eat back|supplement|hrv/,
      );
    }
  });

  test("suppresses matching counts and numeric completeness in hide-numbers mode", () => {
    const result = buildNutritionObservations({ ...base, hideNumbers: true });
    expect(result).toHaveLength(2);
    for (const observation of result) {
      expect(observation.matchingEvents).toBeNull();
      expect(observation.completeness).toBe(
        "Sufficient matching timestamped records from completed diary days were available.",
      );
    }
  });
});
