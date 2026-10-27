import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import {
  defaultModulesForFocus,
  hasChosenModules,
  type PersonModule,
} from "@openvalens/api/presenters/modules";
import type {
  WellnessFocusArea,
  WellnessProfileSnapshot,
} from "@openvalens/api/wellness-profile-contract";

/**
 * Onboarding stage 2 — the web first-run flow (`/welcome`) as pure rules, so
 * the step order, the resume position, the "N of 8" count and the redirect
 * are tested without a browser.
 *
 * Nothing new is stored: each step saves through the existing APIs (the
 * wellness profile with `expectedRevision`, goals, consents), and progress is
 * read back from which answers exist. `setupStatus` marks the flow as seen
 * (`in_progress`), finished (`completed`) or dismissed (`skipped`).
 */

export const ONBOARDING_STEPS = [
  "welcome",
  "age",
  "modules",
  "data",
  "basics",
  "goal",
  "privacy",
  "today",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_STEP_TITLES: Record<OnboardingStep, MessageDescriptor> = {
  welcome: msg`Welcome`,
  age: msg`Age check`,
  modules: msg`Pick your modules`,
  data: msg`How data arrives`,
  basics: msg`A few basics`,
  goal: msg`One goal`,
  privacy: msg`Privacy choices`,
  today: msg`Your Today`,
};

/** Only the age check can't be skipped. */
export function isStepRequired(step: OnboardingStep): boolean {
  return step === "age";
}

type ProfileAnswers = Pick<
  WellnessProfileSnapshot,
  "setupStatus" | "eligibility" | "enabledModules" | "inputMethod" | "region" | "birthYear" | "sex"
>;

/** What else the flow reads to tell whether a step has an answer. */
export type OnboardingExtras = {
  /** Goals in the workspace; `null` while unknown. */
  goalCount?: number | null;
  /** Whether the person ever answered the AI consent (granted or revoked). */
  aiConsentAnswered?: boolean | null;
  /** Whether daily reminders are on. */
  remindersOn?: boolean | null;
};

/** Whether a step has an answer on the server (skipped steps have none). */
export function isStepDone(
  step: OnboardingStep,
  profile: ProfileAnswers,
  extras: OnboardingExtras = {},
): boolean {
  switch (step) {
    case "welcome":
      return profile.setupStatus !== null;
    case "age":
      return profile.eligibility.state !== "unknown";
    case "modules":
      return hasChosenModules(profile);
    case "data":
      return profile.inputMethod.state !== "unknown";
    case "basics":
      return (
        profile.region.state !== "unknown" ||
        profile.birthYear.state !== "unknown" ||
        profile.sex.state !== "unknown"
      );
    case "goal":
      return (extras.goalCount ?? 0) > 0;
    case "privacy":
      return extras.aiConsentAnswered === true || extras.remindersOn === true;
    case "today":
      return profile.setupStatus === "completed";
  }
}

/** "N of 8" for the dashboard card and the flow. */
export function onboardingProgress(
  profile: ProfileAnswers,
  extras: OnboardingExtras = {},
): { done: number; total: number } {
  if (profile.setupStatus === "completed") {
    return { done: ONBOARDING_STEPS.length, total: ONBOARDING_STEPS.length };
  }
  return {
    done: ONBOARDING_STEPS.filter((step) => isStepDone(step, profile, extras)).length,
    total: ONBOARDING_STEPS.length,
  };
}

/**
 * Where "Continue" opens the flow: the first step without an answer, so a
 * person who left part-way picks up there. With everything answered, the
 * last step (Your Today).
 */
export function resumeStep(profile: ProfileAnswers, extras: OnboardingExtras = {}): OnboardingStep {
  return (
    ONBOARDING_STEPS.slice(0, -1).find((step) => !isStepDone(step, profile, extras)) ?? "today"
  );
}

/**
 * Whether the person may open a step: past the age check only once it has an
 * answer (it is the one required step).
 */
export function canOpenStep(
  target: OnboardingStep,
  profile: Pick<ProfileAnswers, "eligibility">,
): boolean {
  return (
    ONBOARDING_STEPS.indexOf(target) <= ONBOARDING_STEPS.indexOf("age") ||
    profile.eligibility.state !== "unknown"
  );
}

/**
 * The first-sign-in redirect to `/welcome` (only from `/` and `/dashboard`,
 * so deep links are never taken over): the flow was never opened and no
 * module choice exists. Opening `/welcome` records `in_progress`, so this
 * happens once; after that the dashboard card offers to continue.
 */
export function shouldRedirectToWelcome(
  profile: Pick<ProfileAnswers, "setupStatus" | "enabledModules"> | null | undefined,
): boolean {
  if (!profile) return false;
  return profile.setupStatus === null && !hasChosenModules(profile);
}

/** Whether the dashboard shows "Finish setting up" (until completed or dismissed). */
export function shouldShowFinishSetup(
  profile: Pick<ProfileAnswers, "setupStatus"> | null | undefined,
): boolean {
  if (!profile) return false;
  return profile.setupStatus === null || profile.setupStatus === "in_progress";
}

/**
 * The module cards the modules step starts with: the stored choice if there
 * is one, else the defaults for the focus areas (supplements, labs, cycle and
 * coach are never pre-selected).
 */
export function initialModules(
  profile: Pick<ProfileAnswers, "enabledModules">,
  focus: readonly WellnessFocusArea[],
): PersonModule[] {
  return hasChosenModules(profile)
    ? [...(profile.enabledModules as PersonModule[])]
    : defaultModulesForFocus(focus);
}
