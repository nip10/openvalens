import { describe, expect, test } from "bun:test";
import { englishI18n } from "@openvalens/i18n/testing";

import type { Insight, InsightDetail } from "../insight-contract";
import { WELLNESS_FOCUS_AREAS } from "../wellness-profile-contract";
import {
  defaultModulesForFocus,
  enabledModuleSet,
  filterInsightsByModules,
  FOCUS_MODULE_DEFAULTS,
  HEALTH_SYNC_KIND_MODULES,
  HEALTH_SYNC_KINDS,
  hasChosenModules,
  insightModules,
  isHealthSyncKindEnabled,
  isModuleEnabled,
  MODULE_DESCRIPTIONS,
  MODULE_ICONS,
  MODULE_LABELS,
  MODULE_TONES,
  PERSON_MODULES,
  toggleModule,
} from "./modules";

const NEVER_DEFAULT = ["supplements", "labs", "cycle", "coach"] as const;

describe("module vocabulary", () => {
  test("every module has a label, a description, an icon and a tone", () => {
    for (const module of PERSON_MODULES) {
      expect(englishI18n._(MODULE_LABELS[module]).length).toBeGreaterThan(0);
      expect(englishI18n._(MODULE_DESCRIPTIONS[module]).length).toBeGreaterThan(0);
      expect(MODULE_ICONS[module]).toBeTruthy();
      expect(MODULE_TONES[module]).toBeTruthy();
    }
  });
});

describe("defaults from the focus answer", () => {
  test("each focus area pre-selects its modules", () => {
    expect(defaultModulesForFocus(["sleep_recovery"])).toEqual(["sleep", "heart"]);
    expect(defaultModulesForFocus(["activity_fitness"])).toEqual(["activity", "heart"]);
    expect(defaultModulesForFocus(["nutrition"])).toEqual(["food"]);
    expect(defaultModulesForFocus(["body_goals"])).toEqual(["body"]);
    expect(defaultModulesForFocus(["wellbeing"])).toEqual(["care"]);
  });

  test("areas combine without duplicates, in module order", () => {
    expect(
      defaultModulesForFocus({ state: "recorded", value: ["activity_fitness", "sleep_recovery"] }),
    ).toEqual(["sleep", "activity", "heart"]);
  });

  test("no focus pre-selects nothing", () => {
    expect(defaultModulesForFocus({ state: "unknown" })).toEqual([]);
    expect(defaultModulesForFocus({ state: "just_exploring" })).toEqual([]);
    expect(defaultModulesForFocus(null)).toEqual([]);
    expect(defaultModulesForFocus([])).toEqual([]);
  });

  test("supplements, labs, cycle and coach are never pre-selected", () => {
    const all = defaultModulesForFocus([...WELLNESS_FOCUS_AREAS]);
    for (const module of NEVER_DEFAULT) expect(all).not.toContain(module);
    for (const area of WELLNESS_FOCUS_AREAS)
      for (const module of NEVER_DEFAULT) expect(FOCUS_MODULE_DEFAULTS[area]).not.toContain(module);
  });
});

describe("reading the stored choice", () => {
  test("not chosen (or not loaded) means every module is on", () => {
    for (const profile of [null, undefined, { enabledModules: null }]) {
      expect(hasChosenModules(profile)).toBe(false);
      expect([...enabledModuleSet(profile)]).toEqual([...PERSON_MODULES]);
      for (const module of PERSON_MODULES) expect(isModuleEnabled(profile, module)).toBe(true);
    }
  });

  test("a chosen list is exact; an empty list turns everything off", () => {
    const profile = { enabledModules: ["sleep", "food"] as const };
    expect(hasChosenModules(profile)).toBe(true);
    expect(isModuleEnabled(profile, "sleep")).toBe(true);
    expect(isModuleEnabled(profile, "heart")).toBe(false);
    for (const module of PERSON_MODULES)
      expect(isModuleEnabled({ enabledModules: [] }, module)).toBe(false);
  });

  test("toggling starts from 'all on' when nothing was chosen", () => {
    expect(toggleModule(null, "labs", false)).toEqual(
      PERSON_MODULES.filter((module) => module !== "labs"),
    );
    expect(toggleModule({ enabledModules: ["food", "sleep"] }, "heart", true)).toEqual([
      "sleep",
      "heart",
      "food",
    ]);
    expect(toggleModule({ enabledModules: ["sleep"] }, "sleep", false)).toEqual([]);
  });
});

function insight(detail: InsightDetail, factors: Insight["factors"] = []): Insight {
  return {
    id: "x",
    ruleId: "change.steps",
    ruleVersion: "1",
    kind: "change",
    topic: "activity",
    windowKey: "w",
    windowEnd: "2026-10-27",
    detail,
    factors,
  };
}

const change = (metric: "sleep_duration" | "resting_heart_rate" | "steps" | "weight") =>
  ({
    type: "change",
    metric,
    direction: "higher",
    unit: "minutes",
    recentValue: 1,
    recentDays: 1,
    recentWindowDays: 1,
    baselineValue: 1,
    baselineDays: 1,
    baselineWindowDays: 1,
    difference: 1,
    threshold: 1,
    certainty: "clear",
  }) as const;

const window = { from: "2026-10-01", to: "2026-10-27", days: 27 };

describe("insights follow modules", () => {
  test("each insight maps to its module(s)", () => {
    expect(insightModules(insight(change("sleep_duration")))).toEqual(["sleep"]);
    expect(insightModules(insight(change("resting_heart_rate")))).toEqual(["heart"]);
    expect(insightModules(insight(change("steps")))).toEqual(["activity"]);
    expect(insightModules(insight(change("weight")))).toEqual(["body"]);
    expect(
      insightModules(
        insight({
          type: "goal",
          goalId: 1,
          goalTitle: "g",
          state: "reached",
          progress: 1,
          currentValue: null,
          targetValue: null,
        }),
      ),
    ).toEqual([]);
    expect(
      insightModules(
        insight({
          type: "meals_near_sleep",
          window,
          evenings: 1,
          nearSleepEvenings: 1,
          nearSleepWindowMinutes: 240,
          medianGapMinutes: null,
        }),
      ),
    ).toEqual(["food", "sleep"]);
    expect(
      insightModules(
        insight({
          type: "meals_and_workouts",
          window,
          diaryCompleteDays: 1,
          workoutDays: 1,
          daysWithBoth: 1,
        }),
      ),
    ).toEqual(["food", "activity"]);
  });

  test("hidden modules' insights and factors are dropped", () => {
    const list = [
      insight(change("sleep_duration"), [{ metric: "steps", direction: "lower" }]),
      insight(change("weight")),
    ];
    const filtered = filterInsightsByModules(list, { enabledModules: ["sleep"] });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.detail).toEqual(change("sleep_duration"));
    expect(filtered[0]!.factors).toEqual([]);
  });

  test("nothing is filtered before the person chooses", () => {
    const list = [insight(change("weight"), [{ metric: "steps", direction: "lower" }])];
    expect(filterInsightsByModules(list, { enabledModules: null })).toEqual(list);
  });
});

describe("phone health sync follows modules", () => {
  test("record kinds map to their modules", () => {
    expect(HEALTH_SYNC_KIND_MODULES).toEqual({
      steps: "activity",
      distance: "activity",
      active_energy: "activity",
      exercise: "activity",
      heart_rate: "heart",
      resting_heart_rate: "heart",
      hrv: "heart",
      sleep: "sleep",
      weight: "body",
      body_fat: "body",
    });
  });

  test("only kinds of enabled modules sync; everything syncs before a choice", () => {
    const profile = { enabledModules: ["sleep"] as const };
    expect(HEALTH_SYNC_KINDS.filter((kind) => isHealthSyncKindEnabled(profile, kind))).toEqual([
      "sleep",
    ]);
    expect(HEALTH_SYNC_KINDS.every((kind) => isHealthSyncKindEnabled(null, kind))).toBe(true);
  });
});
