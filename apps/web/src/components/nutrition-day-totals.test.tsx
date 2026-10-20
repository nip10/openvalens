import { describe, expect, test } from "bun:test";
import {
  NUTRIENT_KEYS,
  type NutrientKey,
  type NutrientTotal,
} from "@openvalens/api/contracts/nutrition-diary";
import { renderToStaticMarkup } from "react-dom/server";

import { NutritionDayTotals } from "./nutrition-day-totals";

function totals(
  overrides: Partial<Record<NutrientKey, NutrientTotal>>,
  fallback: NutrientTotal,
): Record<NutrientKey, NutrientTotal> {
  return Object.fromEntries(
    NUTRIENT_KEYS.map((key) => [key, overrides[key] ?? fallback]),
  ) as Record<NutrientKey, NutrientTotal>;
}

describe("NutritionDayTotals", () => {
  test("shows each total with its coverage; unknown is never rendered as zero", () => {
    const html = renderToStaticMarkup(
      <NutritionDayTotals
        totals={totals(
          {
            energyKcal: { known: 412, reported: 2, missing: 1, coverage: "partial" },
            proteinG: { known: 0, reported: 3, missing: 0, coverage: "full" },
          },
          { known: null, reported: 0, missing: 3, coverage: "none" },
        )}
        sources={{ fdc: 2, off: 0, custom: 0, manual: 1 }}
      />,
    );
    expect(html).toContain("412 kcal");
    expect(html).toContain("2 of 3 entries");
    expect(html).toContain("0 g");
    expect(html).toContain("All 3 entries");
    expect(html).toContain("Unknown");
    expect(html).toContain("Not provided by 3 entries");
    expect(html).toContain("Energy: 412 kcal, 2 of 3 entries");
    // Salt and sodium are listed separately, as are the sugar types.
    for (const label of ["Sodium (mg)", "Salt (g)", "Total sugars (g)", "Added sugars (g)"])
      expect(html).toContain(label);
    expect(html).toContain("2 from USDA FoodData Central · 1 from Quick add");
    expect(html).not.toMatch(/>0 kcal</);
  });

  test("a day with nothing logged reads as not logged, not as zero", () => {
    const html = renderToStaticMarkup(
      <NutritionDayTotals
        totals={totals({}, { known: null, reported: 0, missing: 0, coverage: "no_entries" })}
        sources={{ fdc: 0, off: 0, custom: 0, manual: 0 }}
      />,
    );
    expect(html).toContain("Nothing logged");
    expect(html).not.toMatch(/>0( |<)/);
    expect(html).not.toContain("Sources:");
  });

  test("hide-numbers replaces every value but keeps coverage and logging notes", () => {
    const html = renderToStaticMarkup(
      <NutritionDayTotals
        totals={totals(
          { energyKcal: { known: 1840, reported: 3, missing: 1, coverage: "partial" } },
          { known: null, reported: 0, missing: 0, coverage: "no_entries" },
        )}
        sources={{ fdc: 2, off: 0, custom: 0, manual: 1 }}
        hideNumbers
      />,
    );
    expect(html).not.toContain("1,840");
    expect(html).toContain("Hidden");
    expect(html).toContain("3 of 4 entries");
    expect(html).toContain("Numbers are hidden. Coverage is still shown.");
    // Coverage is never hidden, and a verdict word never appears.
    expect(html).not.toMatch(/\b(over|under|good|bad)\b/i);
  });
});
