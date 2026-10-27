import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { defaultModulesForFocus, type PersonModule } from "@openvalens/api/presenters/modules";
import type {
  FocusAnswer,
  WellnessInputMethod,
  WellnessProfileSnapshot,
} from "@openvalens/api/wellness-profile-contract";

import { HEALTHKIT_TYPE_IDENTIFIERS } from "@/lib/health-sync/healthkit-types";
import type { HealthKitRecordType } from "@/lib/health-sync/map-healthkit";
import {
  healthConnectPermissionsForModules,
  healthKitReadTypesForModules,
} from "@/lib/health-sync/modules";
import { SYNCED_TYPES } from "@/lib/health-sync/record-types";

/**
 * Onboarding stage 3 — the mobile first-run flow, one step per screen.
 *
 * Pure (no React Native, storage or RPC) so `bun test` checks the step
 * order, resume position, the "open once after first sign-in" rule, the module
 * defaults and which phone health permissions a module choice asks for.
 *
 * Progress lives on the server where an answer exists (the wellness profile:
 * setupStatus, eligibility, enabledModules, inputMethod, region); steps that
 * store nothing there (goal, privacy, or a skipped step) are remembered on
 * this phone as "visited".
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

/** The instance admin's server checklist, shown before the person's own steps (not counted). */
export const SERVER_STEP = "server" as const;
export type OnboardingRoute = OnboardingStep | typeof SERVER_STEP;

export const STEP_TITLES: Record<OnboardingStep, MessageDescriptor> = {
  welcome: msg`Welcome`,
  age: msg`Age check`,
  modules: msg`Pick your modules`,
  data: msg`How data arrives`,
  basics: msg`A few basics`,
  goal: msg`One goal`,
  privacy: msg`Privacy choices`,
  today: msg`Your Today`,
};

export function isOnboardingRoute(value: unknown): value is OnboardingRoute {
  return (
    value === SERVER_STEP || (ONBOARDING_STEPS as readonly unknown[]).includes(value as string)
  );
}

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

export function nextStep(step: OnboardingRoute): OnboardingStep | null {
  if (step === SERVER_STEP) return "welcome";
  return ONBOARDING_STEPS[stepIndex(step) + 1] ?? null;
}

export function previousStep(step: OnboardingRoute): OnboardingStep | null {
  if (step === SERVER_STEP) return null;
  return ONBOARDING_STEPS[stepIndex(step) - 1] ?? null;
}

/** Only the age check is required: it has no Skip. */
export function canSkip(step: OnboardingRoute): boolean {
  return step !== "age";
}

type Snapshot = Pick<
  WellnessProfileSnapshot,
  "setupStatus" | "eligibility" | "enabledModules" | "inputMethod" | "region"
>;

/** Whether the server already holds this step's answer. */
export function isStepAnsweredOnServer(step: OnboardingStep, snapshot: Snapshot): boolean {
  switch (step) {
    case "welcome":
      return snapshot.setupStatus !== null;
    case "age":
      return snapshot.eligibility.state !== "unknown";
    case "modules":
      return snapshot.enabledModules !== null;
    case "data":
      return snapshot.inputMethod.state !== "unknown";
    case "basics":
      return snapshot.region.state !== "unknown";
    case "goal":
    case "privacy":
      return false;
    case "today":
      return snapshot.setupStatus === "completed";
  }
}

export function isStepDone(
  step: OnboardingStep,
  snapshot: Snapshot,
  visited: ReadonlySet<string>,
): boolean {
  // The age check counts only once it has an answer, never merely by passing it.
  if (step === "age") return isStepAnsweredOnServer(step, snapshot);
  return visited.has(step) || isStepAnsweredOnServer(step, snapshot);
}

/** "N of 8" for the Cockpit card. */
export function onboardingProgress(
  snapshot: Snapshot,
  visited: ReadonlySet<string>,
): { done: number; total: number } {
  return {
    done: ONBOARDING_STEPS.filter((step) => isStepDone(step, snapshot, visited)).length,
    total: ONBOARDING_STEPS.length,
  };
}

/**
 * Where "Continue setting up" opens: the admin's server checklist first (once),
 * then the first step neither answered nor passed, else Your Today.
 */
export function resumeStep(
  snapshot: Snapshot,
  visited: ReadonlySet<string>,
  options: { isInstanceAdmin?: boolean } = {},
): OnboardingRoute {
  if (options.isInstanceAdmin && !visited.has(SERVER_STEP)) return SERVER_STEP;
  return ONBOARDING_STEPS.find((step) => !isStepDone(step, snapshot, visited)) ?? "today";
}

/**
 * Steps after the age check wait for its answer: opening one directly (a
 * stale link, a resume on another phone) lands on the age check instead.
 */
export function guardStep(step: OnboardingRoute, snapshot: Snapshot): OnboardingRoute {
  if (step === SERVER_STEP || stepIndex(step) <= stepIndex("age")) return step;
  return isStepAnsweredOnServer("age", snapshot) ? step : "age";
}

/** Setup is over once completed or dismissed ("Not now" / Skip on the welcome). */
export function isSetupClosed(snapshot: Pick<Snapshot, "setupStatus">): boolean {
  return snapshot.setupStatus === "completed" || snapshot.setupStatus === "skipped";
}

/**
 * The once-only automatic open, from the Cockpit only (deep links are never
 * redirected): setup not completed or dismissed, modules never chosen, and
 * not opened automatically on this phone before.
 */
export function shouldAutoOpenOnboarding(
  snapshot: Snapshot | null | undefined,
  alreadyAutoOpened: boolean,
): boolean {
  if (!snapshot || alreadyAutoOpened) return false;
  return !isSetupClosed(snapshot) && snapshot.enabledModules === null;
}

/** Whether the "Finish setting up" card shows on the Cockpit. */
export function shouldShowSetupCard(snapshot: Snapshot | null | undefined): boolean {
  return !!snapshot && !isSetupClosed(snapshot);
}

// ─── Modules step ──────────────────────────────────────────────

/** The module cards' starting choice: the stored one, else the focus defaults. */
export function initialModuleChoice(
  snapshot: Pick<WellnessProfileSnapshot, "enabledModules" | "focus">,
): PersonModule[] {
  return snapshot.enabledModules !== null
    ? [...snapshot.enabledModules]
    : defaultModulesForFocus(snapshot.focus);
}

/**
 * After a focus change: the cards follow the focus defaults until the person
 * touches a card themselves (then their choice stays).
 */
export function modulesAfterFocusChange(
  current: readonly PersonModule[],
  focus: FocusAnswer,
  touched: boolean,
): PersonModule[] {
  return touched ? [...current] : defaultModulesForFocus(focus);
}

// ─── How data arrives ──────────────────────────────────────────

export const DATA_SOURCES = ["phone", "wearable", "manual"] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

/** The profile's input method for the chosen sources (`null` = nothing picked). */
export function inputMethodForSources(
  sources: ReadonlySet<DataSource>,
): WellnessInputMethod | null {
  const device = sources.has("phone") || sources.has("wearable");
  const manual = sources.has("manual");
  if (device && manual) return "both";
  if (device) return "device";
  if (manual) return "manual";
  return null;
}

/** A starting selection from a stored input method. */
export function sourcesForInputMethod(
  answer: WellnessProfileSnapshot["inputMethod"],
): Set<DataSource> {
  if (answer.state !== "recorded") return new Set();
  if (answer.value === "manual") return new Set(["manual"]);
  if (answer.value === "both") return new Set(["phone", "manual"]);
  return new Set(["phone"]);
}

export type HealthPlatform = "ios" | "android";

/**
 * The phone health permissions onboarding asks for: only the chosen modules'
 * data types (an empty list = nothing to ask, so no sheet is shown). Matches
 * what `requestHealthAccess` sends for the same choice.
 */
export function healthPermissionsForChoice(
  platform: HealthPlatform,
  modules: readonly PersonModule[],
): string[] {
  const profile = { enabledModules: modules };
  if (platform === "ios") {
    return healthKitReadTypesForModules(
      Object.keys(HEALTHKIT_TYPE_IDENTIFIERS) as HealthKitRecordType[],
      profile,
    );
  }
  return healthConnectPermissionsForModules(SYNCED_TYPES, profile).map(
    (permission) => permission.recordType,
  );
}

export type HealthPermissionOutcome = "granted" | "denied" | "unavailable" | "nothing_to_ask";

/** How the permission sheet went, for the note under the step. */
export function healthPermissionOutcome(
  asked: readonly string[],
  access: { available: boolean; grantedTypes: readonly string[] } | null,
): HealthPermissionOutcome {
  if (asked.length === 0) return "nothing_to_ask";
  if (!access || !access.available) return "unavailable";
  return access.grantedTypes.length > 0 ? "granted" : "denied";
}
