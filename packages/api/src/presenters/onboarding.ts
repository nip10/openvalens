/**
 * Onboarding (#444) — the first run as pure rules, shared by web and mobile so
 * both show the same three screens and the same "Finish setting up" card.
 * Pure TypeScript — safe for the app bundle.
 *
 * The first run is three screens:
 *   1. `start` — the age check plus health-data consent (the only required step);
 *   2. `first_log` — Weight, Water or Last night's sleep, or Skip;
 *   3. `connect` — the phone's health data or a device, or Skip.
 *
 * Everything else (modules, basics, one goal, privacy) is a "Finish setting
 * up" item on Today, each opening its own screen. Nothing new is stored:
 * answers live where they always did (the wellness profile, goals, consents)
 * and `setupStatus` keeps its meaning:
 *   - `null` — never opened (a new account is sent to the first run once);
 *   - `in_progress` — the first run is open or was left part-way;
 *   - `completed` — the first run is over (the earlier 8-step flow counts);
 *   - `skipped` — the "Finish setting up" card was dismissed (Settings brings
 *     it back by setting `completed`).
 */
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import type { WellnessProfileSnapshot } from "../wellness-profile-contract";
import {
  availableLogKinds,
  type BuiltInLogKindId,
  type LogKind,
  type LogKindContext,
  LOG_KINDS,
} from "./log-kinds";
import { hasChosenModules } from "./modules";

// ─── The first run ─────────────────────────────────────────────

export const FIRST_RUN_STEPS = ["start", "first_log", "connect"] as const;
export type FirstRunStep = (typeof FIRST_RUN_STEPS)[number];

export const FIRST_RUN_STEP_TITLES: Record<FirstRunStep, MessageDescriptor> = {
  start: msg`Before you start`,
  first_log: msg`Your first entry`,
  connect: msg`Connect your data`,
};

export type OnboardingProfile = Pick<
  WellnessProfileSnapshot,
  "setupStatus" | "eligibility" | "enabledModules" | "region" | "birthYear" | "sex"
>;

/**
 * What else the rules read. Each is optional: `null` or missing means still
 * loading (or failed), and reads as "not done".
 */
export type OnboardingFacts = {
  /** The health-data consent still has to be accepted (this version). */
  consentNeeded?: boolean | null;
  /** The person has at least one entry they logged themselves. */
  hasEntries?: boolean | null;
  /** A phone is syncing or a wearable account is connected. */
  connected?: boolean | null;
  /** Goals in the workspace. */
  goalCount?: number | null;
  /** The AI consent was ever answered (granted or revoked). */
  aiConsentAnswered?: boolean | null;
  /** Daily reminders are on. */
  remindersOn?: boolean | null;
};

/** Screen 1 is answered: the age check has an answer and no consent is waiting. */
export function isStartDone(
  profile: Pick<OnboardingProfile, "eligibility">,
  facts: Pick<OnboardingFacts, "consentNeeded"> = {},
): boolean {
  return profile.eligibility.state !== "unknown" && facts.consentNeeded !== true;
}

/**
 * Whether this person is sent to the first run (from the home page and
 * Today only, so deep links are never taken over):
 *   - a new account (setup never opened, no module choice), once — opening
 *     the first run records `in_progress`;
 *   - someone who left the first run before answering screen 1, because the
 *     age check and consent are the only steps that block Today.
 * Anyone whose first run is over (`completed`, or the card dismissed) is never
 * sent again, whatever the earlier flow left unanswered.
 */
export function needsFirstRun(
  profile: Pick<OnboardingProfile, "setupStatus" | "eligibility" | "enabledModules"> | null,
  facts: Pick<OnboardingFacts, "consentNeeded"> = {},
): boolean {
  if (!profile) return false;
  if (profile.setupStatus === null) return !hasChosenModules(profile);
  if (profile.setupStatus === "in_progress") return !isStartDone(profile, facts);
  return false;
}

/** Where the first run opens: screen 1 until it is answered, then the first log. */
export function firstRunResumeStep(
  profile: Pick<OnboardingProfile, "eligibility">,
  facts: Pick<OnboardingFacts, "consentNeeded"> = {},
): FirstRunStep {
  return isStartDone(profile, facts) ? "first_log" : "start";
}

export function nextFirstRunStep(step: FirstRunStep): FirstRunStep | null {
  return FIRST_RUN_STEPS[FIRST_RUN_STEPS.indexOf(step) + 1] ?? null;
}

export function previousFirstRunStep(step: FirstRunStep): FirstRunStep | null {
  return FIRST_RUN_STEPS[FIRST_RUN_STEPS.indexOf(step) - 1] ?? null;
}

/** "Step N of 3". */
export function firstRunPosition(step: FirstRunStep): { index: number; total: number } {
  return { index: FIRST_RUN_STEPS.indexOf(step) + 1, total: FIRST_RUN_STEPS.length };
}

// ─── Screen 2: the first log ───────────────────────────────────

/** The three large cards, in order. Each reuses its quick-log kind (#440). */
export const FIRST_LOG_KIND_IDS = [
  "weight",
  "water",
  "sleep",
] as const satisfies readonly BuiltInLogKindId[];
export type FirstLogKindId = (typeof FIRST_LOG_KIND_IDS)[number];

export const FIRST_LOG_CARD_COPY: Record<FirstLogKindId, MessageDescriptor> = {
  weight: msg`Weight`,
  water: msg`Water`,
  sleep: msg`Last night's sleep`,
};

/** Shown on the Water card while plain water is off: tapping it turns it on. */
export const FIRST_LOG_WATER_NOTE = msg`This turns on water logging`;

/**
 * The cards this person can use: the module is on and their role can write.
 * Plain water counts as on, because tapping the Water card turns it on.
 */
export function firstLogKinds(
  context: Pick<LogKindContext, "enabledModules" | "can">,
): LogKind<FirstLogKindId>[] {
  const kinds = FIRST_LOG_KIND_IDS.map(
    (id) => LOG_KINDS.find((kind) => kind.id === id) as LogKind<FirstLogKindId>,
  );
  return availableLogKinds({ ...context, preferences: { plain_water: true } }, kinds);
}

/** Whether choosing this card first turns plain water on. */
export function turnsOnWater(kindId: string, plainWaterEnabled: boolean | null | undefined) {
  return kindId === "water" && plainWaterEnabled !== true;
}

// ─── Screen 3: connect ─────────────────────────────────────────

/** The phone app's stores. The App Store listing is not public yet. */
export const PHONE_APP_STORES = [
  {
    id: "google_play",
    label: "Google Play",
    url: "https://play.google.com/store/apps/details?id=com.openvalens.app",
  },
] as const;

/**
 * What the "Get the phone app" QR code holds: the app's link with this
 * server's address, so the phone app can start on the same server.
 */
export function phoneAppLink(serverUrl: string): string {
  return `openvalens://server?url=${encodeURIComponent(serverUrl.replace(/\/+$/, ""))}`;
}

// ─── "Finish setting up" on Today ──────────────────────────────

/** The card's items, in order. Each opens its own screen. */
export const SETUP_ITEMS = [
  "first_log",
  "connect",
  "modules",
  "basics",
  "goal",
  "privacy",
] as const;
export type SetupItem = (typeof SETUP_ITEMS)[number];

export function isSetupItem(value: unknown): value is SetupItem {
  return (SETUP_ITEMS as readonly unknown[]).includes(value);
}

export const SETUP_ITEM_COPY: Record<
  SetupItem,
  { title: MessageDescriptor; description: MessageDescriptor }
> = {
  first_log: {
    title: msg`Log your first entry`,
    description: msg`Weight, water or last night's sleep.`,
  },
  connect: {
    title: msg`Connect your data`,
    description: msg`The phone app or a wearable account.`,
  },
  modules: {
    title: msg`Pick your modules`,
    description: msg`Show only the parts of the app you use.`,
  },
  basics: {
    title: msg`A few basics`,
    description: msg`Region, birth year and sex, all optional.`,
  },
  goal: {
    title: msg`Set one goal`,
    description: msg`Something to work toward, in your own words.`,
  },
  privacy: {
    title: msg`Privacy choices`,
    description: msg`AI, reminders and usage analytics. All off until you turn them on.`,
  },
};

/** Whether an item has an answer (a skipped item has none). */
export function isSetupItemDone(
  item: SetupItem,
  profile: OnboardingProfile,
  facts: OnboardingFacts = {},
): boolean {
  switch (item) {
    case "first_log":
      return facts.hasEntries === true;
    case "connect":
      return facts.connected === true;
    case "modules":
      return hasChosenModules(profile);
    case "basics":
      return (
        profile.region.state !== "unknown" ||
        profile.birthYear.state !== "unknown" ||
        profile.sex.state !== "unknown"
      );
    case "goal":
      return (facts.goalCount ?? 0) > 0;
    case "privacy":
      return facts.aiConsentAnswered === true || facts.remindersOn === true;
  }
}

/** "N of 6" and the items still open, in order. */
export function setupProgress(
  profile: OnboardingProfile,
  facts: OnboardingFacts = {},
): { done: number; total: number; pending: SetupItem[] } {
  const pending = SETUP_ITEMS.filter((item) => !isSetupItemDone(item, profile, facts));
  return { done: SETUP_ITEMS.length - pending.length, total: SETUP_ITEMS.length, pending };
}

/** Whether Today shows "Finish setting up": not dismissed and something is still open. */
export function shouldShowSetupCard(
  profile: OnboardingProfile | null | undefined,
  facts: OnboardingFacts = {},
): boolean {
  if (!profile || profile.setupStatus === "skipped") return false;
  return setupProgress(profile, facts).pending.length > 0;
}

/** Whether Settings offers to bring the dismissed card back. */
export function canRestoreSetupCard(
  profile: Pick<OnboardingProfile, "setupStatus"> | null | undefined,
): boolean {
  return profile?.setupStatus === "skipped";
}
