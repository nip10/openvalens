import { defaultModulesForFocus, type PersonModule } from "@openvalens/api/presenters/modules";
import {
  FIRST_RUN_STEPS,
  firstRunResumeStep,
  isStartDone,
  needsFirstRun,
  nextFirstRunStep,
  previousFirstRunStep,
  type FirstRunStep,
  type OnboardingFacts,
  type OnboardingProfile,
} from "@openvalens/api/presenters/onboarding";
import type {
  FocusAnswer,
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
 * Onboarding (#444) — the mobile first run, one screen per step, on the
 * shared rules in `@openvalens/api/presenters/onboarding` (the same three
 * screens as the web's `/welcome`):
 *   1. `start` — the age check plus health-data consent (no Skip);
 *   2. `first_log` — Weight, Water or Last night's sleep, or Skip;
 *   3. `connect` — Apple Health or Health Connect, then a watch or ring.
 *
 * Pure (no React Native, storage or RPC) so `bun test` checks the routing,
 * the guard, where the flow opens and which phone permissions are asked.
 */

/** The instance admin's server checklist, shown before screen 1 (not counted). */
export const SERVER_STEP = "server" as const;
export type OnboardingRoute = FirstRunStep | typeof SERVER_STEP;

export function isOnboardingRoute(value: unknown): value is OnboardingRoute {
  return value === SERVER_STEP || (FIRST_RUN_STEPS as readonly unknown[]).includes(value);
}

export function nextRoute(route: OnboardingRoute): FirstRunStep | null {
  return route === SERVER_STEP ? "start" : nextFirstRunStep(route);
}

export function previousRoute(route: OnboardingRoute): FirstRunStep | null {
  return route === SERVER_STEP ? null : previousFirstRunStep(route);
}

/** Screen 1 (and the admin's checklist, which asks nothing) has no Skip. */
export function canSkip(route: OnboardingRoute): boolean {
  return route !== "start" && route !== SERVER_STEP;
}

type Facts = Pick<OnboardingFacts, "consentNeeded">;

/**
 * Screens after screen 1 wait for its answers: opening one directly (a stale
 * link, a resume on another phone) lands on screen 1 instead.
 */
export function guardRoute(
  route: OnboardingRoute,
  profile: Pick<OnboardingProfile, "eligibility">,
  facts: Facts = {},
): OnboardingRoute {
  if (route === SERVER_STEP || route === "start") return route;
  return isStartDone(profile, facts) ? route : "start";
}

/**
 * Where the first run opens: the admin's server checklist on a new account,
 * then screen 1 until it is answered, then the first log.
 */
export function firstRunEntry(
  profile: Pick<OnboardingProfile, "setupStatus" | "eligibility">,
  facts: Facts = {},
  options: { isInstanceAdmin?: boolean } = {},
): OnboardingRoute {
  if (options.isInstanceAdmin && profile.setupStatus === null) return SERVER_STEP;
  return firstRunResumeStep(profile, facts);
}

/**
 * Whether Today opens the first run by itself (Today only, so deep links are
 * never taken over), at most once while Today stays open: the shared
 * `needsFirstRun` rule. A first run that is over (`completed`, or the card
 * dismissed) never opens again.
 */
export function shouldOpenFirstRun(
  profile: Parameters<typeof needsFirstRun>[0] | undefined,
  facts: Facts,
  alreadyOpened: boolean,
): boolean {
  if (!profile || alreadyOpened) return false;
  return needsFirstRun(profile, facts);
}

// ─── Modules (a "Finish setting up" item) ──────────────────────

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

// ─── Connect: the phone's health app ───────────────────────────

export type HealthPlatform = "ios" | "android";

/**
 * The phone health permissions the connect screen asks for: only the
 * modules' data types (every module until the person chooses, so weight,
 * steps, heart rate, sleep and workouts). Matches what `requestHealthAccess`
 * sends for the same profile; an empty list = nothing to ask.
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

/** How the permission sheet went, for the note under the button. */
export function healthPermissionOutcome(
  asked: readonly string[],
  access: { available: boolean; grantedTypes: readonly string[] } | null,
): HealthPermissionOutcome {
  if (asked.length === 0) return "nothing_to_ask";
  if (!access || !access.available) return "unavailable";
  return access.grantedTypes.length > 0 ? "granted" : "denied";
}
