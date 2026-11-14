import { describe, expect, test } from "bun:test";
import {
  EMPTY_WELLNESS_PROFILE,
  type FocusAnswer,
  type WellnessProfileSnapshot,
} from "@openvalens/api/wellness-profile-contract";

import {
  canSkip,
  firstRunEntry,
  guardRoute,
  healthPermissionOutcome,
  healthPermissionsForChoice,
  initialModuleChoice,
  isOnboardingRoute,
  modulesAfterFocusChange,
  nextRoute,
  previousRoute,
  shouldOpenFirstRun,
} from "./steps";

const empty: WellnessProfileSnapshot = { ...EMPTY_WELLNESS_PROFILE };
const adult = { state: "recorded", value: "adult" } as const;

describe("routes", () => {
  test("three screens; the server checklist leads into screen 1", () => {
    expect(nextRoute("server")).toBe("start");
    expect(nextRoute("start")).toBe("first_log");
    expect(nextRoute("first_log")).toBe("connect");
    expect(nextRoute("connect")).toBeNull();
    expect(previousRoute("connect")).toBe("first_log");
    expect(previousRoute("start")).toBeNull();
    expect(previousRoute("server")).toBeNull();
  });

  test("only the old step names are not routes", () => {
    for (const route of ["server", "start", "first_log", "connect"])
      expect(isOnboardingRoute(route)).toBe(true);
    for (const old of ["welcome", "age", "modules", "today", undefined])
      expect(isOnboardingRoute(old)).toBe(false);
  });

  test("screen 1 has no Skip", () => {
    expect(canSkip("start")).toBe(false);
    expect(canSkip("server")).toBe(false);
    expect(canSkip("first_log")).toBe(true);
    expect(canSkip("connect")).toBe(true);
  });
});

describe("guard and entry", () => {
  test("later screens wait for the age check and the consent", () => {
    expect(guardRoute("connect", empty)).toBe("start");
    expect(guardRoute("first_log", { ...empty, eligibility: adult })).toBe("first_log");
    expect(guardRoute("first_log", { ...empty, eligibility: adult }, { consentNeeded: true })).toBe(
      "start",
    );
    expect(guardRoute("server", empty)).toBe("server");
  });

  test("an admin's new account sees the server checklist first, then screen 1", () => {
    expect(firstRunEntry(empty, {}, { isInstanceAdmin: true })).toBe("server");
    expect(firstRunEntry(empty)).toBe("start");
    expect(
      firstRunEntry({ ...empty, setupStatus: "in_progress" }, {}, { isInstanceAdmin: true }),
    ).toBe("start");
    expect(firstRunEntry({ ...empty, setupStatus: "in_progress", eligibility: adult })).toBe(
      "first_log",
    );
  });
});

describe("opening by itself", () => {
  test("a new account, once while Today stays open", () => {
    expect(shouldOpenFirstRun(empty, {}, false)).toBe(true);
    expect(shouldOpenFirstRun(empty, {}, true)).toBe(false);
    expect(shouldOpenFirstRun(undefined, {}, false)).toBe(false);
  });

  test("part-way: only while the age check or consent is unanswered", () => {
    const partway = { ...empty, setupStatus: "in_progress" as const };
    expect(shouldOpenFirstRun(partway, {}, false)).toBe(true);
    expect(shouldOpenFirstRun({ ...partway, eligibility: adult }, {}, false)).toBe(false);
    expect(
      shouldOpenFirstRun({ ...partway, eligibility: adult }, { consentNeeded: true }, false),
    ).toBe(true);
  });

  test("existing members: a finished or dismissed first run never opens again", () => {
    // `completed` includes everyone who finished the earlier 8-step flow.
    expect(shouldOpenFirstRun({ ...empty, setupStatus: "completed" }, {}, false)).toBe(false);
    expect(shouldOpenFirstRun({ ...empty, setupStatus: "skipped" }, {}, false)).toBe(false);
    expect(
      shouldOpenFirstRun({ ...empty, setupStatus: "completed" }, { consentNeeded: true }, false),
    ).toBe(false);
    // Modules chosen before setup was ever opened (the profile screen) count as set up.
    expect(shouldOpenFirstRun({ ...empty, enabledModules: ["sleep"] }, {}, false)).toBe(false);
  });
});

describe("module defaults", () => {
  test("focus pre-selects; supplements, labs, cycle and coach never are", () => {
    const focus: FocusAnswer = {
      state: "recorded",
      value: ["sleep_recovery", "activity_fitness", "nutrition", "body_goals", "wellbeing"],
    };
    expect(initialModuleChoice({ enabledModules: null, focus })).toEqual([
      "sleep",
      "activity",
      "heart",
      "body",
      "food",
      "care",
    ]);
    expect(initialModuleChoice({ enabledModules: null, focus: { state: "unknown" } })).toEqual([]);
    expect(initialModuleChoice({ enabledModules: ["labs"], focus })).toEqual(["labs"]);
  });

  test("cards follow focus until touched", () => {
    const nutrition: FocusAnswer = { state: "recorded", value: ["nutrition"] };
    expect(modulesAfterFocusChange(["sleep"], nutrition, false)).toEqual(["food"]);
    expect(modulesAfterFocusChange(["sleep"], nutrition, true)).toEqual(["sleep"]);
    expect(modulesAfterFocusChange(["sleep"], { state: "just_exploring" }, false)).toEqual([]);
  });
});

describe("connect: the phone's health app", () => {
  test("health permissions are asked only for the modules' types", () => {
    expect(healthPermissionsForChoice("ios", ["sleep"])).toEqual([
      "HKCategoryTypeIdentifierSleepAnalysis",
    ]);
    expect(healthPermissionsForChoice("android", ["sleep"])).toEqual(["SleepSession"]);
    expect(healthPermissionsForChoice("android", ["heart", "body"])).toEqual([
      "Weight",
      "BodyFat",
      "HeartRate",
    ]);
    expect(healthPermissionsForChoice("ios", ["activity"])).toEqual([
      "HKQuantityTypeIdentifierStepCount",
      "HKQuantityTypeIdentifierActiveEnergyBurned",
      "HKQuantityTypeIdentifierDistanceWalkingRunning",
      "HKWorkoutTypeIdentifier",
    ]);
    for (const platform of ["ios", "android"] as const) {
      expect(healthPermissionsForChoice(platform, ["food", "labs", "coach", "cycle"])).toEqual([]);
      expect(healthPermissionsForChoice(platform, [])).toEqual([]);
    }
  });

  test("the permission outcome handles nothing to ask, denial and no health app", () => {
    expect(healthPermissionOutcome([], null)).toBe("nothing_to_ask");
    expect(healthPermissionOutcome(["Steps"], null)).toBe("unavailable");
    expect(healthPermissionOutcome(["Steps"], { available: false, grantedTypes: [] })).toBe(
      "unavailable",
    );
    expect(healthPermissionOutcome(["Steps"], { available: true, grantedTypes: [] })).toBe(
      "denied",
    );
    expect(healthPermissionOutcome(["Steps"], { available: true, grantedTypes: ["steps"] })).toBe(
      "granted",
    );
  });
});
