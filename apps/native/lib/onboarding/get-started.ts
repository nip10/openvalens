import type { PersonModule } from "@openvalens/api/presenters/modules";
import type { WellnessInputMethod } from "@openvalens/api/wellness-profile-contract";

/**
 * The Cockpit's "Get started" checklist for a new account (app review): a
 * few first steps picked from the onboarding answers, each ticked off by real
 * data. Dependency-free, so it is unit-tested directly.
 */

export const GET_STARTED_ITEMS = [
  "connect-health",
  "first-weight",
  "first-meal",
  "nutrition-targets",
  "first-goal",
] as const;
export type GetStartedItemId = (typeof GET_STARTED_ITEMS)[number];

export type GetStartedItem = { id: GetStartedItemId; done: boolean };

/** What the checklist is built from. A `null` signal is still loading. */
export type GetStartedInput = {
  enabled: ReadonlySet<PersonModule>;
  inputMethod: WellnessInputMethod | null;
  /** Whether this phone has a health app the app can read from. */
  healthAvailable: boolean;
  /** Nutrition targets are not offered while a support declaration stands. */
  targetsOffered: boolean;
  signals: Record<GetStartedItemId, boolean | null>;
  /** Items once seen done on this phone: they stay ticked (a meal is per day). */
  seenDone: ReadonlySet<string>;
};

/** The items that apply to this person, in order, each done or not. */
export function getStartedItems(input: GetStartedInput): GetStartedItem[] {
  const applies: Record<GetStartedItemId, boolean> = {
    "connect-health":
      input.healthAvailable && (input.inputMethod === "device" || input.inputMethod === "both"),
    "first-weight": input.enabled.has("body"),
    "first-meal": input.enabled.has("food"),
    "nutrition-targets": input.enabled.has("food") && input.targetsOffered,
    "first-goal": true,
  };
  return GET_STARTED_ITEMS.filter((id) => applies[id]).map((id) => ({
    id,
    done: input.signals[id] === true || input.seenDone.has(id),
  }));
}

/** Every signal the applicable items need has loaded. */
export function getStartedLoaded(input: GetStartedInput): boolean {
  return getStartedItems(input).every((item) => item.done || input.signals[item.id] !== null);
}

/**
 * Shown once onboarding is closed (the "Finish setting up" card comes first),
 * until it is dismissed or every item is done.
 */
export function shouldShowGetStarted(
  items: readonly GetStartedItem[],
  options: { dismissed: boolean; setupCardShown: boolean },
): boolean {
  if (options.dismissed || options.setupCardShown) return false;
  return items.some((item) => !item.done);
}
