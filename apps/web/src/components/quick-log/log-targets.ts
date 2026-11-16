import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { MealSlot } from "@openvalens/api/contracts/nutrition-diary";
import { findLogKind, type BuiltInLogKindId } from "@openvalens/api/presenters/log-kinds";

/**
 * What the log "+" opens (DESIGN.md "Forms and logging"). Pure TypeScript.
 *
 * A target names one thing to log. The palette opens it directly when it can
 * (a quick form, or food scoped to a meal and a day); a page that registered
 * its own dialog for the kind (`useLogDialog`) gets it instead.
 */

/** Things only a page's own dialog logs: the palette has no entry for them. */
export const PAGE_ONLY_LOG_KINDS = {
  period: msg({ message: "Period", context: "menstrual cycle" }),
} as const satisfies Record<string, MessageDescriptor>;
export type PageOnlyLogKindId = keyof typeof PAGE_ONLY_LOG_KINDS;

/** Food in the meal diary: which meal and which day (YYYY-MM-DD) to log to. */
export type FoodLogTarget = { kind: "food"; meal?: MealSlot; date?: string };

/** Any other palette kind: a built-in, or a custom tracker (`tracker:<id>`). */
export type KindLogTarget = {
  kind: Exclude<BuiltInLogKindId, "food"> | `tracker:${string}`;
  /** Field values to start from, by quick-form field id (e.g. `{ supplement: "3" }`). */
  values?: Readonly<Record<string, string>>;
  /** Kinds one tap away from the form (vitals: blood pressure). */
  related?: readonly BuiltInLogKindId[];
};

/** A thing only the page's own dialog logs. */
export type PageLogTarget = { kind: PageOnlyLogKindId };

export type LogTarget = FoodLogTarget | KindLogTarget | PageLogTarget;
export type LogTargetKind = LogTarget["kind"];

/**
 * Each screen's default (app-shell#0). The first match wins; a path matches
 * itself and everything under it (`/goals` covers `/goals/12`).
 */
export const ROUTE_LOG_TARGETS: readonly { path: string; target: LogTarget }[] = Object.freeze([
  { path: "/body", target: { kind: "weight" } },
  {
    path: "/records/vitals",
    target: { kind: "heart_rate", related: ["blood_pressure", "resting_heart_rate"] },
  },
  {
    path: "/records/activity",
    target: { kind: "steps", related: ["active_calories", "distance"] },
  },
  { path: "/records/sleep", target: { kind: "sleep" } },
  { path: "/records/labs", target: { kind: "lab_result" } },
  { path: "/nutrition", target: { kind: "food" } },
  { path: "/cycle", target: { kind: "period" } },
  { path: "/workouts", target: { kind: "workout" } },
  { path: "/supplements", target: { kind: "supplement_intake" } },
  { path: "/private-measurements", target: { kind: "private_measurement" } },
  { path: "/goals", target: { kind: "goal_checkin" } },
]);

/** The screen's default target, or null (the palette opens unfiltered). */
export function routeLogTarget(pathname: string): LogTarget | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const match = ROUTE_LOG_TARGETS.find(
    (entry) => path === entry.path || path.startsWith(`${entry.path}/`),
  );
  return match?.target ?? null;
}

/** The kind's name, for the button's label ("Log: Weight"). */
export function logTargetLabel(target: LogTarget | null): MessageDescriptor | null {
  if (!target) return null;
  if (target.kind in PAGE_ONLY_LOG_KINDS)
    return PAGE_ONLY_LOG_KINDS[target.kind as PageOnlyLogKindId];
  return findLogKind(target.kind)?.label ?? null;
}

/** A stable key for a target, so effects only rerun when it really changes. */
export function logTargetKey(target: LogTarget | null): string {
  return target ? JSON.stringify(target) : "";
}

/**
 * What a press of the "+" (or any `useOpenLog()` button) does: the page's own
 * dialog for the kind when one is registered, else the palette at the target.
 */
export type LogLaunch =
  | { type: "dialog"; target: LogTarget }
  | { type: "palette"; target: LogTarget | null };

export function resolveLogLaunch(
  target: LogTarget | null,
  hasDialog: (kind: string) => boolean,
): LogLaunch {
  if (target && hasDialog(target.kind)) return { type: "dialog", target };
  // A page-only kind with no dialog yet: nothing in the palette to point at.
  if (target && target.kind in PAGE_ONLY_LOG_KINDS) return { type: "palette", target: null };
  return { type: "palette", target };
}

/**
 * How the palette starts for a target, given the kinds the member can log:
 * a kind's quick form, the food list for a meal and day, or the full list.
 */
export type PaletteStart =
  | { type: "list" }
  | { type: "form"; kindId: string; values?: Readonly<Record<string, string>>; related: string[] }
  | { type: "food"; meal?: MealSlot; date?: string };

export function paletteStart(
  target: LogTarget | null,
  available: { has: (kindId: string) => boolean; hasQuickForm: (kindId: string) => boolean },
): PaletteStart {
  if (!target || !available.has(target.kind)) return { type: "list" };
  if (target.kind === "food") {
    const food = target as FoodLogTarget;
    return { type: "food", meal: food.meal, date: food.date };
  }
  if (!available.hasQuickForm(target.kind)) return { type: "list" };
  const kind = target as KindLogTarget;
  return {
    type: "form",
    kindId: kind.kind,
    values: kind.values,
    related: (kind.related ?? []).filter(
      (id) => id !== kind.kind && available.has(id) && available.hasQuickForm(id),
    ),
  };
}
