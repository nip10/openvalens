import type { DailyTotals } from "./daily-totals";
import { nutrientCoverage, type NutrientCoverage } from "./totals";

/**
 * Sanitized nutrition context for the AI Coach (Issue #86). Pure TypeScript:
 * it turns the server's per-day totals (#79) into a small, fixed-shape summary
 * the chat model may see — no foods, brands, entry ids, per-day arrays or
 * dates ever cross this boundary.
 *
 * The context is deliberately minimal and honest:
 *
 * - Only the five headline nutrients are averaged, over the days that actually
 *   logged something. A nutrient with no value on any logged day is `null`,
 *   never 0.
 * - `coverage`, `loggedDays` and `completeDays` describe how complete the log
 *   is, so an empty or partial week is described as uncertain rather than as a
 *   number.
 * - `includeNumbers` is the member's hide-numbers choice. When false, every
 *   numeric field is withheld (`averages: null`) and `numbersHidden` is set, so
 *   no numeric value can reach the provider.
 *
 * The copy is descriptive and non-clinical: it never judges intake, never
 * prescribes, and never implies a diagnosis.
 */

/** Nutrients the Coach may average, in a fixed order. */
export const NUTRITION_COACH_NUTRIENTS = [
  "energyKcal",
  "proteinG",
  "carbohydrateG",
  "fatG",
  "fiberG",
] as const;
export type NutritionCoachNutrient = (typeof NUTRITION_COACH_NUTRIENTS)[number];

/** Default and maximum look-back windows a Coach context may cover. */
export const NUTRITION_COACH_DEFAULT_WINDOW_DAYS = 7;
export const NUTRITION_COACH_MAX_WINDOW_DAYS = 30;

export type NutritionCoachContext = {
  /** Number of local days the summary covers (including days with nothing logged). */
  windowDays: number;
  /** Days in the window with at least one logged entry. */
  loggedDays: number;
  /** Days the member explicitly marked complete. */
  completeDays: number;
  /** How many of the averaged nutrients the logged entries actually provided. */
  coverage: NutrientCoverage;
  /** True when numeric values were withheld (hide-numbers). */
  numbersHidden: boolean;
  /** Per-logged-day averages, or `null` when numbers are withheld or nothing was logged. */
  averages: Record<NutritionCoachNutrient, number | null> | null;
  /** Honest, non-clinical notes about what is missing or uncertain. */
  notes: string[];
};

function roundAverage(key: NutritionCoachNutrient, value: number): number {
  // Energy reads best as a whole number; grams keep one decimal.
  const digits = key === "energyKcal" ? 0 : 1;
  return Number(value.toFixed(digits));
}

function formatDays(count: number): string {
  return `${count} ${count === 1 ? "day" : "days"}`;
}

/**
 * Builds the Coach context from a window of per-day totals (oldest first). The
 * window length is taken from `days.length`; callers page `@openvalens/nutrition`
 * totals for the exact range.
 */
export function buildNutritionCoachContext(
  days: readonly DailyTotals[],
  options: { includeNumbers: boolean },
): NutritionCoachContext {
  const windowDays = days.length;
  const logged = days.filter((day) => day.entryCount > 0);
  const loggedDays = logged.length;
  const completeDays = days.filter((day) => day.status === "complete").length;

  let cells = 0;
  let reportedCells = 0;
  const perNutrient = {} as Record<NutritionCoachNutrient, number | null>;
  for (const key of NUTRITION_COACH_NUTRIENTS) {
    let sum = 0;
    let reported = 0;
    for (const day of logged) {
      const total = day.totals[key];
      cells += 1;
      if (total.known !== null) {
        sum += total.known;
        reported += 1;
        reportedCells += 1;
      }
    }
    perNutrient[key] = reported > 0 ? roundAverage(key, sum / reported) : null;
  }

  const coverage: NutrientCoverage =
    cells === 0 ? "no_entries" : nutrientCoverage(reportedCells, cells - reportedCells);

  const notes: string[] = [];
  if (loggedDays === 0) {
    notes.push(`No meals were logged in the last ${formatDays(windowDays)}.`);
  } else {
    if (loggedDays < windowDays) {
      notes.push(
        `${formatDays(windowDays - loggedDays)} of ${formatDays(windowDays)} had no logged meals; averages cover only the days with entries.`,
      );
    }
    if (coverage === "partial") {
      notes.push(
        "Some entries did not record every nutrient, so each average covers only the entries that provided it.",
      );
    }
    if (completeDays === 0) {
      notes.push("No day was marked complete, so the log may be partial.");
    }
    if (!options.includeNumbers) {
      notes.push(
        "The member withheld numeric values; only coverage and completeness are available.",
      );
    }
  }

  return {
    windowDays,
    loggedDays,
    completeDays,
    coverage,
    numbersHidden: !options.includeNumbers,
    averages: options.includeNumbers && loggedDays > 0 ? perNutrient : null,
    notes,
  };
}
