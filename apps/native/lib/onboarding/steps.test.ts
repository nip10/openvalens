import { describe, expect, test } from "bun:test";
import {
  EMPTY_WELLNESS_PROFILE,
  type FocusAnswer,
  type WellnessProfileSnapshot,
} from "@openvalens/api/wellness-profile-contract";

import {
  canSkip,
  guardStep,
  healthPermissionOutcome,
  healthPermissionsForChoice,
  initialModuleChoice,
  inputMethodForSources,
  modulesAfterFocusChange,
  nextStep,
  ONBOARDING_STEPS,
  onboardingProgress,
  previousStep,
  resumeStep,
  shouldAutoOpenOnboarding,
  shouldShowSetupCard,
  sourcesForInputMethod,
} from "./steps";

const empty: WellnessProfileSnapshot = { ...EMPTY_WELLNESS_PROFILE };
const adult = { state: "recorded", value: "adult" } as const;
const none = new Set<string>();

describe("step model", () => {
  test("eight steps in the proposal's order", () => {
    expect(ONBOARDING_STEPS).toEqual([
      "welcome",
      "age",
      "modules",
      "data",
      "basics",
      "goal",
      "privacy",
      "today",
    ]);
  });

  test("next/previous walk the order; the server checklist leads into Welcome", () => {
    expect(nextStep("welcome")).toBe("age");
    expect(nextStep("today")).toBeNull();
    expect(previousStep("welcome")).toBeNull();
    expect(previousStep("modules")).toBe("age");
    expect(nextStep("server")).toBe("welcome");
  });

  test("only the age check cannot be skipped", () => {
    expect(ONBOARDING_STEPS.filter((step) => !canSkip(step))).toEqual(["age"]);
  });
});

describe("resume position", () => {
  test("a new person starts at Welcome; an admin sees the server checklist first, once", () => {
    expect(resumeStep(empty, none)).toBe("welcome");
    expect(resumeStep(empty, none, { isInstanceAdmin: true })).toBe("server");
    expect(resumeStep(empty, new Set(["server"]), { isInstanceAdmin: true })).toBe("welcome");
  });

  test("resumes at the first step neither answered on the server nor passed here", () => {
    const started = { ...empty, setupStatus: "in_progress" as const, eligibility: adult };
    expect(resumeStep(started, none)).toBe("modules");
    expect(resumeStep({ ...started, enabledModules: ["sleep"] }, none)).toBe("data");
    expect(resumeStep({ ...started, enabledModules: ["sleep"] }, new Set(["data", "basics"]))).toBe(
      "goal",
    );
  });

  test("the age check is never passed without an answer", () => {
    expect(resumeStep({ ...empty, setupStatus: "in_progress" }, new Set(["age", "modules"]))).toBe(
      "age",
    );
    expect(guardStep("basics", empty)).toBe("age");
    expect(guardStep("basics", { ...empty, eligibility: adult })).toBe("basics");
    expect(guardStep("welcome", empty)).toBe("welcome");
  });

  test("everything done resumes at Your Today; progress counts N of 8", () => {
    const visited = new Set(["data", "basics", "goal", "privacy"]);
    const snapshot = {
      ...empty,
      setupStatus: "in_progress" as const,
      eligibility: adult,
      enabledModules: [],
    };
    expect(resumeStep(snapshot, visited)).toBe("today");
    expect(onboardingProgress(snapshot, visited)).toEqual({ done: 7, total: 8 });
    expect(onboardingProgress(empty, none)).toEqual({ done: 0, total: 8 });
  });
});

describe("routing rule", () => {
  test("opens once after first sign-in while setup is open and modules unchosen", () => {
    expect(shouldAutoOpenOnboarding(empty, false)).toBe(true);
    expect(shouldAutoOpenOnboarding(empty, true)).toBe(false);
    expect(shouldAutoOpenOnboarding(null, false)).toBe(false);
    expect(shouldAutoOpenOnboarding({ ...empty, enabledModules: ["food"] }, false)).toBe(false);
    expect(shouldAutoOpenOnboarding({ ...empty, setupStatus: "skipped" }, false)).toBe(false);
    expect(shouldAutoOpenOnboarding({ ...empty, setupStatus: "completed" }, false)).toBe(false);
    expect(shouldAutoOpenOnboarding({ ...empty, setupStatus: "in_progress" }, false)).toBe(true);
  });

  test("the setup card shows until completed or dismissed", () => {
    expect(shouldShowSetupCard(empty)).toBe(true);
    expect(shouldShowSetupCard({ ...empty, setupStatus: "in_progress" })).toBe(true);
    expect(shouldShowSetupCard({ ...empty, setupStatus: "skipped" })).toBe(false);
    expect(shouldShowSetupCard({ ...empty, setupStatus: "completed" })).toBe(false);
    expect(shouldShowSetupCard(undefined)).toBe(false);
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

describe("how data arrives", () => {
  test("sources map to the profile's input method and back", () => {
    expect(inputMethodForSources(new Set())).toBeNull();
    expect(inputMethodForSources(new Set(["phone"]))).toBe("device");
    expect(inputMethodForSources(new Set(["wearable"]))).toBe("device");
    expect(inputMethodForSources(new Set(["manual"]))).toBe("manual");
    expect(inputMethodForSources(new Set(["phone", "manual"]))).toBe("both");
    expect([...sourcesForInputMethod({ state: "recorded", value: "both" })]).toEqual([
      "phone",
      "manual",
    ]);
    expect([...sourcesForInputMethod({ state: "unknown" })]).toEqual([]);
  });

  test("health permissions are asked only for the chosen modules' types", () => {
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
