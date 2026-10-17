import { describe, expect, test } from "bun:test";

import { buildNutritionCoachContext, NUTRITION_COACH_NUTRIENTS } from "./coach-context";
import type { DailyTotals } from "./daily-totals";
import { normalizeNutrients, type NutrientValues } from "./nutrients";
import { summarizeEntries, type TotalsFoodSource } from "./totals";

// Synthetic data only; no real people or foods.

function day(
  localDate: string,
  status: "complete" | "unmarked",
  entries: Array<{ nutrients: Partial<NutrientValues>; source?: TotalsFoodSource }> = [],
): DailyTotals {
  return {
    localDate,
    status,
    ...summarizeEntries(
      entries.map((entry) => ({
        nutrients: normalizeNutrients(entry.nutrients),
        source: entry.source ?? "manual",
      })),
    ),
  };
}

const WEEK = [
  "2026-10-01",
  "2026-10-02",
  "2026-10-03",
  "2026-10-04",
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
];

describe("buildNutritionCoachContext", () => {
  test("averages only the logged days and reports full coverage when numbers are allowed", () => {
    const days = WEEK.map((date) =>
      day(date, "complete", [
        {
          nutrients: { energyKcal: 2000, proteinG: 100, carbohydrateG: 200, fatG: 70, fiberG: 30 },
        },
      ]),
    );
    const context = buildNutritionCoachContext(days, { includeNumbers: true });

    expect(context.windowDays).toBe(7);
    expect(context.loggedDays).toBe(7);
    expect(context.completeDays).toBe(7);
    expect(context.coverage).toBe("full");
    expect(context.numbersHidden).toBe(false);
    expect(context.averages).toEqual({
      energyKcal: 2000,
      proteinG: 100,
      carbohydrateG: 200,
      fatG: 70,
      fiberG: 30,
    });
    // A complete, fully-reported week needs no caveats.
    expect(context.notes).toEqual([]);
  });

  test("withholds every numeric value when numbers are not allowed, and says so", () => {
    const days = WEEK.map((date) =>
      day(date, "complete", [{ nutrients: { energyKcal: 2000, proteinG: 100 } }]),
    );
    const context = buildNutritionCoachContext(days, { includeNumbers: false });

    expect(context.numbersHidden).toBe(true);
    expect(context.averages).toBeNull();
    // Coverage/completeness are still described so the model can answer honestly.
    expect(context.loggedDays).toBe(7);
    expect(context.notes.some((note) => note.toLowerCase().includes("withheld"))).toBe(true);
    // No number from the log may ride along anywhere in the serialized context.
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("2000");
    expect(serialized).not.toContain("100");
  });

  test("reports nothing logged as no_entries without inventing zeros", () => {
    const days = WEEK.map((date) => day(date, "unmarked"));
    const context = buildNutritionCoachContext(days, { includeNumbers: true });

    expect(context.loggedDays).toBe(0);
    expect(context.coverage).toBe("no_entries");
    expect(context.averages).toBeNull();
    expect(context.notes).toHaveLength(1);
    expect(context.notes[0]).toContain("No meals were logged");
  });

  test("averages each nutrient over only the days that reported it", () => {
    const days = [
      day("2026-10-01", "unmarked", [{ nutrients: { energyKcal: 2000 } }]),
      day("2026-10-02", "unmarked", [{ nutrients: {} }]),
    ];
    const context = buildNutritionCoachContext(days, { includeNumbers: true });

    expect(context.averages?.energyKcal).toBe(2000);
    expect(context.averages?.proteinG).toBeNull();
    expect(context.coverage).toBe("partial");
    expect(context.notes.some((note) => note.includes("did not record every nutrient"))).toBe(true);
    // Two logged days but neither marked complete -> a partial-log caveat.
    expect(context.notes.some((note) => note.includes("marked complete"))).toBe(true);
  });

  test("reports missing days separately from per-entry nutrient coverage", () => {
    const days = [
      ...WEEK.slice(0, 3).map((date) =>
        day(date, "complete", [
          {
            nutrients: { energyKcal: 1800, proteinG: 90, carbohydrateG: 180, fatG: 60, fiberG: 25 },
          },
        ]),
      ),
      ...WEEK.slice(3).map((date) => day(date, "unmarked")),
    ];
    const context = buildNutritionCoachContext(days, { includeNumbers: true });
    expect(context.loggedDays).toBe(3);
    // Every logged entry reported every nutrient, so coverage is full...
    expect(context.coverage).toBe("full");
    // ...but the empty days are called out honestly instead of being counted as zero.
    expect(context.notes.some((note) => note.includes("had no logged meals"))).toBe(true);
  });

  test("exposes only the projected keys — never a food, brand, id or date field", () => {
    const context = buildNutritionCoachContext(
      [day("2026-10-01", "complete", [{ nutrients: { energyKcal: 2000 } }])],
      { includeNumbers: true },
    );
    expect(Object.keys(context).sort()).toEqual(
      [
        "averages",
        "completeDays",
        "coverage",
        "loggedDays",
        "notes",
        "numbersHidden",
        "windowDays",
      ].sort(),
    );
    expect(Object.keys(context.averages ?? {}).sort()).toEqual(
      [...NUTRITION_COACH_NUTRIENTS].sort(),
    );
  });
});
