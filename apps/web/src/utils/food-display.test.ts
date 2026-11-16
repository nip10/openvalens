import { describe, expect, test } from "bun:test";
import { englishI18n } from "@openvalens/i18n/testing";

import {
  diaryDayLabel,
  draftAmount,
  enteredValues,
  foodUsageLine,
  shortBasis,
  sortFoods,
  targetSince,
} from "./food-display";

const NOW = new Date(2026, 10, 16, 12, 0);

const basis = (
  patch: Partial<{
    nutrientBasisAmount: number;
    nutrientBasisUnit: "g" | "ml" | "serving";
    servingLabel: string | null;
  }>,
) => ({
  basis: {
    nutrientBasisAmount: 100,
    nutrientBasisUnit: "g" as const,
    servingSizeAmount: null,
    servingSizeUnit: null,
    servingLabel: null,
    ...patch,
  },
});

describe("diaryDayLabel (nutrition#1)", () => {
  test("names today and yesterday with the date", () => {
    expect(diaryDayLabel(englishI18n, "2026-11-16", NOW)).toBe("Today, Nov 16");
    expect(diaryDayLabel(englishI18n, "2026-11-15", NOW)).toBe("Yesterday, Nov 15");
  });

  test("shows only the date for other days", () => {
    expect(diaryDayLabel(englishI18n, "2026-10-08", NOW)).toBe("Oct 8");
    expect(diaryDayLabel(englishI18n, "2025-10-08", NOW)).toBe("Oct 8, 2025");
  });
});

describe("shortBasis (foods#1)", () => {
  test("a generic serving reads per serving", () => {
    const one = { nutrientBasisAmount: 1, nutrientBasisUnit: "serving" as const };
    expect(shortBasis(basis({ ...one, servingLabel: "1 portion" }), englishI18n)).toBe(
      "per serving",
    );
    expect(shortBasis(basis({ ...one, servingLabel: null }), englishI18n)).toBe("per serving");
    expect(shortBasis(basis({ ...one, servingLabel: "mug" }), englishI18n)).toBe("per mug");
    expect(shortBasis(basis({ ...one, servingLabel: "1 mug" }), englishI18n)).toBe("per mug");
  });

  test("a weight or volume basis reads per its amount", () => {
    expect(shortBasis(basis({}), englishI18n)).toBe("per 100 g");
    expect(
      shortBasis(basis({ nutrientBasisUnit: "ml", nutrientBasisAmount: 250 }), englishI18n),
    ).toBe("per 250 ml");
  });
});

test("enteredValues counts only the values the member filled in", () => {
  expect(
    enteredValues({
      nutrientsPerBasis: { energyKcal: 80, proteinG: 0, fatG: null } as never,
    }),
  ).toBe(2);
});

describe("targetSince (nutrition-targets#6)", () => {
  test("uses friendly dates, never ISO", () => {
    const entered = { source: "entered" as const, effectiveFrom: "2026-08-19", effectiveTo: null };
    expect(targetSince(entered, englishI18n, NOW)).toBe("since Aug 19");
    expect(targetSince({ ...entered, effectiveTo: "2026-12-01" }, englishI18n, NOW)).toBe(
      "Aug 19 to Dec 1",
    );
  });

  test("says when the target was an accepted suggestion", () => {
    expect(
      targetSince(
        { source: "proposal", effectiveFrom: "2026-11-16", effectiveTo: null },
        englishI18n,
        NOW,
      ),
    ).toBe("Accepted suggestion, since Today");
  });
});

describe("draftAmount (food-draft#0)", () => {
  test("keeps an amount the diary can log", () => {
    expect(draftAmount({ quantity: 150, unitText: "g" })).toEqual({ amount: 150, unit: "g" });
    expect(draftAmount({ quantity: 2, unitText: "servings" })).toEqual({
      amount: 2,
      unit: "serving",
    });
  });

  test("leaves anything else to the food's usual amount", () => {
    expect(draftAmount({ quantity: 2, unitText: "slices" })).toBeNull();
    expect(draftAmount({ quantity: null, unitText: "g" })).toBeNull();
    expect(draftAmount(null)).toBeNull();
  });
});

describe("food usage (foods#0, #5)", () => {
  const food = (
    id: number,
    name: string,
    createdAt: string,
    logCount: number,
    last: string | null,
  ) => ({
    id,
    name,
    createdAt,
    usage: { logCount, lastLoggedOn: last },
  });
  const foods = [
    food(1, "apple", "2026-09-01T00:00:00Z", 3, "2026-11-10"),
    food(2, "Bread", "2026-11-01T00:00:00Z", 31, "2026-11-14"),
    food(3, "Almonds", "2026-10-01T00:00:00Z", 3, "2026-11-15"),
    food(4, "Cocoa", "2026-11-02T00:00:00Z", 0, null),
  ];

  test("most used first, then the latest logged, then by name", () => {
    expect(sortFoods(foods, "used", "en").map((item) => item.id)).toEqual([2, 3, 1, 4]);
    expect(sortFoods(foods, "name", "en").map((item) => item.name)).toEqual([
      "Almonds",
      "apple",
      "Bread",
      "Cocoa",
    ]);
    expect(sortFoods(foods, "added", "en").map((item) => item.id)).toEqual([4, 2, 3, 1]);
    // A copy: the server's order is left as it was.
    expect(foods.map((item) => item.id)).toEqual([1, 2, 3, 4]);
  });

  test("the card line says when it was last logged and how often", () => {
    const line = (logCount: number, lastLoggedOn: string | null) =>
      foodUsageLine({ logCount, lastLoggedOn }, englishI18n, NOW);
    expect(line(31, "2026-11-14")).toBe("Last logged 2 days ago · 31 times");
    expect(line(1, "2026-11-16")).toBe("Last logged today · once");
    expect(line(2, "2026-11-15")).toBe("Last logged yesterday · 2 times");
    expect(line(5, "2026-10-08")).toBe("Last logged Oct 8 · 5 times");
    expect(line(0, null)).toBeNull();
  });
});
