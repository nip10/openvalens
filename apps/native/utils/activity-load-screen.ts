import type {
  ActivityIntensityOption,
  ActivityLoadResult,
} from "@openvalens/api/activity-load-contract";
import type { I18n } from "@lingui/core";
import { activityLoadView } from "@openvalens/api/presenters/activity-load";

/**
 * Issue #99 — native layout model for the weekly activity card on the
 * Workouts screen. Dependency-free (no RPC client / Varlock) so it is
 * unit-tested directly. It flattens the shared view model from
 * `@openvalens/api/presenters/activity-load` into text blocks, so the native
 * screen shows exactly what the web card shows: both numbers with units,
 * status, breakdown, coverage, formula and sources, the per-day effort, the
 * own-history comparison, context and the unavailable states.
 *
 * Text is rendered through the `i18n` passed in (#67): the Workouts screen
 * passes its own, so the card follows the interface language.
 */

export type ActivityNumberBlock = {
  key: "active_minutes" | "effort_points";
  title: string;
  valueText: string;
  unitText: string | null;
  accessibilityLabel: string;
  lines: string[];
  method: string[];
};

export type ActivityLoadScreen = {
  title: string;
  intro: string;
  windowText: string | null;
  withheldExplanation: string | null;
  numbers: ActivityNumberBlock[];
  dayRows: Array<{ key: string; label: string; value: string; accessibilityLabel: string }>;
  comparison: { title: string; lines: string[]; accessibilityLabel: string } | null;
  context: string[];
  footer: string[];
};

export function activityLoadScreen(result: ActivityLoadResult, i18n: I18n): ActivityLoadScreen {
  const view = activityLoadView(result, i18n);
  const numbers: ActivityNumberBlock[] = [];
  for (const part of [view.activeMinutes, view.effort]) {
    if (!part) continue;
    numbers.push({
      key: part.key,
      title: part.title,
      valueText: part.valueText,
      unitText: part.available ? part.unitText : null,
      accessibilityLabel: part.accessibilityLabel,
      lines: [part.statusText, ...part.breakdown, ...part.coverage],
      method: [part.formula, ...part.sources],
    });
  }
  return {
    title: view.title,
    intro: view.intro,
    windowText: view.windowText || null,
    withheldExplanation: view.withheldExplanation,
    numbers,
    dayRows: view.effortDays.map((day) => ({
      key: day.date,
      label: day.label,
      value: day.valueText,
      accessibilityLabel: day.accessibilityLabel,
    })),
    comparison: view.comparison
      ? {
          title: view.comparison.title,
          lines: [
            view.comparison.text,
            ...(view.comparison.detail ? [view.comparison.detail] : []),
            view.comparison.limits,
          ],
          accessibilityLabel: view.comparison.accessibilityLabel,
        }
      : null,
    context: view.context,
    footer: [...view.notes, ...(view.versionText ? [view.versionText] : [])],
  };
}

/** Tapping the selected choice again clears it (back to "not recorded"). */
export function toggleIntensity(
  current: ActivityIntensityOption | null,
  pressed: ActivityIntensityOption,
): ActivityIntensityOption | null {
  return current === pressed ? null : pressed;
}

export function toggleEffort(current: number | null, pressed: number): number | null {
  return current === pressed ? null : pressed;
}
