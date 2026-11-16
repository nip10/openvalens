import { describe, expect, test } from "bun:test";
import { englishI18n } from "@openvalens/i18n/testing";

import { diaryDayLabel, draftAmount, enteredValues, shortBasis, targetSince } from "./food-display";

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
