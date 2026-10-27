import "@/testing/varlock-test-setup";
import { describe, expect, test } from "bun:test";
import { EMPTY_WELLNESS_PROFILE } from "@openvalens/api/wellness-profile-contract";

import {
  canOpenStep,
  initialModules,
  isStepRequired,
  ONBOARDING_STEPS,
  onboardingProgress,
  resumeStep,
  shouldRedirectToWelcome,
  shouldShowFinishSetup,
} from "./onboarding";

const empty = EMPTY_WELLNESS_PROFILE;
const adult = { state: "recorded", value: "adult" } as const;

describe("onboarding steps", () => {
  test("eight steps in the proposal's order; only the age check is required", () => {
    expect([...ONBOARDING_STEPS]).toEqual([
      "welcome",
      "age",
      "modules",
      "data",
      "basics",
      "goal",
      "privacy",
      "today",
    ]);
    expect(ONBOARDING_STEPS.filter(isStepRequired)).toEqual(["age"]);
  });

  test("nothing past the age check opens until it has an answer", () => {
    expect(canOpenStep("welcome", empty)).toBe(true);
    expect(canOpenStep("age", empty)).toBe(true);
    expect(canOpenStep("modules", empty)).toBe(false);
    expect(canOpenStep("today", empty)).toBe(false);
    expect(canOpenStep("modules", { eligibility: adult })).toBe(true);
    // "Prefer not to say" and under 18 are answers too (the existing rule applies).
    expect(canOpenStep("modules", { eligibility: { state: "declined" } })).toBe(true);
    expect(canOpenStep("goal", { eligibility: { state: "recorded", value: "under_18" } })).toBe(
      true,
    );
  });
});

describe("module defaults", () => {
  test("focus areas pre-select their modules; never supplements, labs, cycle or coach", () => {
    expect(initialModules(empty, ["sleep_recovery", "activity_fitness"])).toEqual([
      "sleep",
      "activity",
      "heart",
    ]);
    const all = initialModules(empty, [
      "sleep_recovery",
      "activity_fitness",
      "nutrition",
      "body_goals",
      "wellbeing",
    ]);
    for (const never of ["supplements", "labs", "cycle", "coach"] as const)
      expect(all).not.toContain(never);
  });

  test("no focus pre-selects nothing; a stored choice wins over defaults", () => {
    expect(initialModules(empty, [])).toEqual([]);
    expect(initialModules({ enabledModules: ["labs"] }, ["nutrition"])).toEqual(["labs"]);
  });
});

describe("resume and progress", () => {
  test("a new person starts at Welcome, 0 of 8", () => {
    expect(resumeStep(empty)).toBe("welcome");
    expect(onboardingProgress(empty)).toEqual({ done: 0, total: 8 });
  });

  test("resumes at the first step without an answer", () => {
    const seen = { ...empty, setupStatus: "in_progress" as const };
    expect(resumeStep(seen)).toBe("age");
    const aged = { ...seen, eligibility: adult };
    expect(resumeStep(aged)).toBe("modules");
    const picked = { ...aged, enabledModules: ["sleep" as const] };
    expect(resumeStep(picked)).toBe("data");
    const data = { ...picked, inputMethod: { state: "declined" as const } };
    expect(resumeStep(data)).toBe("basics");
    const basics = { ...data, region: { state: "recorded" as const, value: "pt" as const } };
    expect(resumeStep(basics)).toBe("goal");
    expect(resumeStep(basics, { goalCount: 1 })).toBe("privacy");
    expect(resumeStep(basics, { goalCount: 1, aiConsentAnswered: true })).toBe("today");
    expect(onboardingProgress(basics, { goalCount: 1, remindersOn: true })).toEqual({
      done: 7,
      total: 8,
    });
  });

  test("completed counts all eight", () => {
    expect(onboardingProgress({ ...empty, setupStatus: "completed" })).toEqual({
      done: 8,
      total: 8,
    });
  });
});

describe("first sign-in redirect", () => {
  test("only when setup was never opened and no modules were chosen", () => {
    expect(shouldRedirectToWelcome(empty)).toBe(true);
    expect(shouldRedirectToWelcome({ ...empty, setupStatus: "in_progress" })).toBe(false);
    expect(shouldRedirectToWelcome({ ...empty, setupStatus: "completed" })).toBe(false);
    expect(shouldRedirectToWelcome({ ...empty, setupStatus: "skipped" })).toBe(false);
    expect(shouldRedirectToWelcome({ ...empty, enabledModules: [] })).toBe(false);
    expect(shouldRedirectToWelcome(null)).toBe(false);
  });

  test("the dashboard card shows until completed or dismissed", () => {
    expect(shouldShowFinishSetup(empty)).toBe(true);
    expect(shouldShowFinishSetup({ setupStatus: "in_progress" })).toBe(true);
    expect(shouldShowFinishSetup({ setupStatus: "completed" })).toBe(false);
    expect(shouldShowFinishSetup({ setupStatus: "skipped" })).toBe(false);
    expect(shouldShowFinishSetup(undefined)).toBe(false);
  });
});
