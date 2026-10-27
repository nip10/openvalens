import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import type { Insight, InsightMetric } from "../insight-contract";
import {
  PERSON_MODULES,
  type FocusAnswer,
  type PersonModule,
  type WellnessFocusArea,
} from "../wellness-profile-contract";

export { PERSON_MODULES, normalizeModules, type PersonModule } from "../wellness-profile-contract";

/**
 * Onboarding stage 1 — per-person modules, shared by web, native and the
 * server's insight/reminder filters.
 *
 * A module is a part of the app the person can switch on or off. Hiding one
 * removes it from the menu, the dashboard tiles, insights and reminders, and
 * (on the phone) stops syncing its health data types. Nothing is deleted, and
 * a hidden module's pages still open from a direct link.
 *
 * The stored choice is `enabledModules` on the wellness profile: `null` means
 * the person has not chosen yet, which reads as every module on, so nothing
 * disappears for accounts that predate onboarding (or while the profile is
 * still loading).
 */

export const MODULE_LABELS: Record<PersonModule, MessageDescriptor> = {
  sleep: msg`Sleep`,
  activity: msg`Activity & workouts`,
  heart: msg`Heart & vitals`,
  body: msg`Body & weight`,
  food: msg`Food & water`,
  supplements: msg`Supplements & medications`,
  labs: msg`Labs & clinical`,
  cycle: msg`Cycle`,
  coach: msg`Coach (AI)`,
  care: msg`Preventive care`,
};

/** One short line under the label: what the module includes. */
export const MODULE_DESCRIPTIONS: Record<PersonModule, MessageDescriptor> = {
  sleep: msg`Nights, stages, rest`,
  activity: msg`Steps, sessions, effort`,
  heart: msg`Heart rate, HRV, blood pressure`,
  body: msg`Weight, composition, body map`,
  food: msg`Meal diary, water, nutrients`,
  supplements: msg`Regimens, reminders`,
  labs: msg`Results with the lab's ranges`,
  cycle: msg`Period log, history`,
  coach: msg`Chat about your own records`,
  care: msg`Screening dates`,
};

/**
 * Platform-neutral icon keys; each app maps them to its lucide icon
 * (web `lucide-react`, native `lucide-react-native`).
 */
export type ModuleIconKey =
  | "moon"
  | "footprints"
  | "heart-pulse"
  | "scale"
  | "utensils"
  | "pill"
  | "flask"
  | "calendar-heart"
  | "message-circle"
  | "shield-check";

export const MODULE_ICONS: Record<PersonModule, ModuleIconKey> = {
  sleep: "moon",
  activity: "footprints",
  heart: "heart-pulse",
  body: "scale",
  food: "utensils",
  supplements: "pill",
  labs: "flask",
  cycle: "calendar-heart",
  coach: "message-circle",
  care: "shield-check",
};

/** The Bloom measure tone of each module (DESIGN.md "Which tone"). */
export type ModuleTone = "sleep" | "steps" | "heart" | "weight" | "water" | "food" | "signal";

export const MODULE_TONES: Record<PersonModule, ModuleTone> = {
  sleep: "sleep",
  activity: "steps",
  heart: "heart",
  body: "weight",
  food: "food",
  supplements: "food",
  labs: "water",
  cycle: "heart",
  coach: "signal",
  care: "weight",
};

/** Shown at the top of a hidden module's pages (they still work from a direct link). */
export const MODULE_HIDDEN_NOTE = msg`This module is hidden. Turn it on in Settings › Modules.`;
export const MODULE_HIDDEN_LINK = msg`Open Settings › Modules`;
/** Shown on the Modules settings screen. */
export const MODULES_KEEP_DATA_NOTE = msg`Hiding a module keeps its data. Turn it back on and everything is there again.`;

// ─── Defaults from the focus answer ────────────────────────────

/**
 * Modules each focus area pre-selects. Supplements, labs, cycle and coach are
 * never pre-selected: the person picks them.
 */
export const FOCUS_MODULE_DEFAULTS: Record<WellnessFocusArea, readonly PersonModule[]> = {
  sleep_recovery: ["sleep", "heart"],
  activity_fitness: ["activity", "heart"],
  nutrition: ["food"],
  body_goals: ["body"],
  wellbeing: ["care"],
};

/**
 * The module choice the onboarding step starts from. No focus (never answered
 * or "just exploring") pre-selects nothing.
 */
export function defaultModulesForFocus(
  focus: FocusAnswer | readonly WellnessFocusArea[] | null | undefined,
): PersonModule[] {
  const areas = Array.isArray(focus)
    ? (focus as readonly WellnessFocusArea[])
    : focus && "value" in focus && focus.state === "recorded"
      ? focus.value
      : [];
  const chosen = new Set(areas.flatMap((area) => FOCUS_MODULE_DEFAULTS[area] ?? []));
  return PERSON_MODULES.filter((module) => chosen.has(module));
}

// ─── Reading the stored choice ─────────────────────────────────

type ModuleProfile = { enabledModules: readonly PersonModule[] | null } | null | undefined;

/** Whether the person has chosen their modules (`false` until onboarding or Settings saves one). */
export function hasChosenModules(profile: ModuleProfile): boolean {
  return Array.isArray(profile?.enabledModules);
}

/** The modules that are on. Not chosen yet (or not loaded) = every module. */
export function enabledModuleSet(profile: ModuleProfile): ReadonlySet<PersonModule> {
  const chosen = profile?.enabledModules;
  return new Set(Array.isArray(chosen) ? chosen : PERSON_MODULES);
}

export function isModuleEnabled(profile: ModuleProfile, id: PersonModule): boolean {
  const chosen = profile?.enabledModules;
  return Array.isArray(chosen) ? chosen.includes(id) : true;
}

/** The next stored choice after switching one module. */
export function toggleModule(
  profile: ModuleProfile,
  id: PersonModule,
  on: boolean,
): PersonModule[] {
  const next = new Set(enabledModuleSet(profile));
  if (on) next.add(id);
  else next.delete(id);
  return PERSON_MODULES.filter((module) => next.has(module));
}

// ─── Insights ──────────────────────────────────────────────────

export const METRIC_MODULES: Record<InsightMetric, PersonModule> = {
  sleep_duration: "sleep",
  resting_heart_rate: "heart",
  steps: "activity",
  weight: "body",
};

/**
 * The modules an insight belongs to; it is shown only when all of them are on.
 * Goal insights belong to the always-on goals, so they have none. The
 * cross-module nutrition observations need food and the module they describe.
 */
export function insightModules(insight: Pick<Insight, "detail">): PersonModule[] {
  const detail = insight.detail;
  switch (detail.type) {
    case "goal":
      return [];
    case "meals_and_workouts":
      return ["food", "activity"];
    case "meals_near_sleep":
      return ["food", "sleep"];
    case "activity_energy_context":
      return ["food", "activity"];
    default:
      return [METRIC_MODULES[detail.metric]];
  }
}

/**
 * Drops insights of hidden modules, and co-occurring factors that name a
 * hidden module's measure. A no-op when the person has not chosen modules.
 */
export function filterInsightsByModules<T extends Pick<Insight, "detail" | "factors">>(
  insights: readonly T[],
  profile: ModuleProfile,
): T[] {
  if (!hasChosenModules(profile)) return [...insights];
  const on = enabledModuleSet(profile);
  return insights
    .filter((insight) => insightModules(insight).every((module) => on.has(module)))
    .map((insight) => ({
      ...insight,
      factors: insight.factors.filter((factor) => on.has(METRIC_MODULES[factor.metric])),
    }));
}

// ─── Phone health sync (HealthKit / Health Connect) ────────────

/**
 * The phone health data kinds OpenValens reads, by module. Each app maps its
 * platform record types onto these kinds.
 */
export const HEALTH_SYNC_KINDS = [
  "steps",
  "distance",
  "active_energy",
  "exercise",
  "heart_rate",
  "resting_heart_rate",
  "hrv",
  "sleep",
  "weight",
  "body_fat",
] as const;
export type HealthSyncKind = (typeof HEALTH_SYNC_KINDS)[number];

export const HEALTH_SYNC_KIND_MODULES: Record<HealthSyncKind, PersonModule> = {
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
};

/** Whether the phone should read (and ask permission for) a data kind. */
export function isHealthSyncKindEnabled(profile: ModuleProfile, kind: HealthSyncKind): boolean {
  return isModuleEnabled(profile, HEALTH_SYNC_KIND_MODULES[kind]);
}
