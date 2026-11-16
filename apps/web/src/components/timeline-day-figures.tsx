import type { I18n } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { formatSteps } from "@openvalens/api/presenters/activity";
import { formatKg } from "@openvalens/api/presenters/body";
import { formatSleepDuration } from "@openvalens/api/presenters/sleep";
import { Footprints, type LucideIcon, Moon, Scale, Utensils } from "lucide-react";

import type { Tone } from "@/components/page";

/** A day's figures as the server returns them (`timeline.dayTotals`). */
export type DayFigures = {
  date: string;
  asleepMinutes: number | null;
  steps: number | null;
  meals: number | null;
  weightKg: number | null;
};

type Settings = Parameters<typeof formatKg>[1];

/** The server's longest `timeline.dayTotals` range. */
const DAY_TOTALS_SPAN = 62;

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The `timeline.dayTotals` ranges that cover the loaded days, newest first,
 * each at most 62 days and starting and ending on a loaded day, so sparse
 * history costs one call per stretch rather than one per 62 empty days.
 */
export function dayTotalsRanges(days: readonly string[]): { from: string; to: string }[] {
  const sorted = [...new Set(days)].sort().reverse();
  const ranges: { from: string; to: string }[] = [];
  for (const day of sorted) {
    const current = ranges.at(-1);
    if (current && day >= addDays(current.to, -(DAY_TOTALS_SPAN - 1))) current.from = day;
    else ranges.push({ from: day, to: day });
  }
  return ranges;
}

export type DayFigurePart = { key: string; icon: LucideIcon; tone: Tone; text: string };

/** "8h 50m", "11k steps", "3 meals", "66.6 kg": only the figures the day has. */
export function dayFigureParts(
  figures: DayFigures,
  i18n: I18n,
  settings?: Settings,
): DayFigurePart[] {
  const parts: DayFigurePart[] = [];
  if (figures.asleepMinutes)
    parts.push({
      key: "sleep",
      icon: Moon,
      tone: "sleep",
      text: i18n._(msg`${formatSleepDuration(figures.asleepMinutes)} sleep`),
    });
  if (figures.steps)
    parts.push({
      key: "steps",
      icon: Footprints,
      tone: "steps",
      text: i18n._(msg`${formatSteps(Math.round(figures.steps))} steps`),
    });
  if (figures.meals)
    parts.push({
      key: "meals",
      icon: Utensils,
      tone: "food",
      text: i18n._(msg`${plural(figures.meals, { one: "# meal", other: "# meals" })}`),
    });
  if (figures.weightKg)
    parts.push({
      key: "weight",
      icon: Scale,
      tone: "weight",
      text: formatKg(figures.weightKg, settings),
    });
  return parts;
}

const TONE_TEXT: Partial<Record<Tone, string>> = {
  sleep: "text-sleep",
  steps: "text-steps",
  food: "text-food",
  weight: "text-weight",
};

/**
 * timeline#6 — the one line of figures under a day's heading, so scrolling
 * back reads well before opening any row. Nothing when the day has none.
 */
export function TimelineDayFigures({
  figures,
  settings,
}: {
  figures: DayFigures | undefined;
  settings?: Settings;
}) {
  const { i18n } = useLingui();
  if (!figures) return null;
  const parts = dayFigureParts(figures, i18n, settings);
  if (parts.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
      {parts.map((part) => (
        <li key={part.key} className="num flex items-center gap-1.5" data-day-figure={part.key}>
          <part.icon className={`size-3.5 ${TONE_TEXT[part.tone] ?? ""}`} aria-hidden="true" />
          {part.text}
        </li>
      ))}
    </ul>
  );
}
