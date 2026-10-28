import { describe, expect, test } from "bun:test";
import { englishI18n, inEnglish } from "@openvalens/i18n/testing";
import { computeNutrientFactor } from "@openvalens/nutrition/nutrients";
import { summarizeEntries } from "@openvalens/nutrition/totals";

import { NUTRIENT_KEYS, type NutrientValues } from "../contracts/nutrition-diary";
import {
  ALL_NUTRIENTS,
  DIARY_COPY,
  NUTRIENT_LABELS,
  SLOT_LABELS,
  SYNC_STATE_LABELS,
  dayStatusText,
  describeNutrientTotal,
  foodSourceLabel,
  formatAmount,
  formatCoverage,
  formatNutrientTotal,
  formatSources,
  groupBySlot,
  localDateIn,
  mealSlotForLocalTime,
  newClientMutationId,
  parseQuickAdd,
  previewFactor,
  previewNutrients,
  shiftLocalDate,
  summarizeDay,
  unitsFor,
} from "./nutrition-diary";

describe("mealSlotForLocalTime", () => {
  test.each([
    ["10:29", 10, 29, "breakfast"],
    ["10:30", 10, 30, "lunch"],
    ["14:59", 14, 59, "lunch"],
    ["15:00", 15, 0, "snack"],
    ["17:29", 17, 29, "snack"],
    ["17:30", 17, 30, "dinner"],
    ["21:29", 21, 29, "dinner"],
    ["21:30", 21, 30, "snack"],
  ] as const)("uses the local meal window at %s", (_label, hour, minute, expected) => {
    expect(mealSlotForLocalTime(new Date(2026, 9, 27, hour, minute))).toBe(expected);
  });
});

function nutrients(values: Partial<NutrientValues>): NutrientValues {
  return Object.fromEntries(
    NUTRIENT_KEYS.map((key) => [key, values[key] ?? null]),
  ) as NutrientValues;
}

describe("summarizeDay", () => {
  test("sums known values and counts unknown ones separately, never as zero", () => {
    const summary = summarizeDay([
      { nutrients: nutrients({ energyKcal: 200, proteinG: 0 }) },
      { nutrients: nutrients({ energyKcal: 150 }) },
      { nutrients: nutrients({}) },
    ]);
    expect(summary.entryCount).toBe(3);
    expect(summary.totals.energyKcal).toEqual({
      known: 350,
      reported: 2,
      missing: 1,
      coverage: "partial",
    });
    // A recorded zero is reported data; absent values stay unknown.
    expect(summary.totals.proteinG).toEqual({
      known: 0,
      reported: 1,
      missing: 2,
      coverage: "partial",
    });
    expect(summary.totals.fiberG).toEqual({
      known: null,
      reported: 0,
      missing: 3,
      coverage: "none",
    });
  });

  test("an empty day has no totals, not zero totals", () => {
    const summary = summarizeDay([]);
    expect(summary.totals.energyKcal).toEqual({
      known: null,
      reported: 0,
      missing: 0,
      coverage: "no_entries",
    });
    expect(formatNutrientTotal("energyKcal", summary.totals.energyKcal, englishI18n)).toBe("—");
  });

  test("formats partial coverage explicitly", () => {
    expect(
      formatNutrientTotal("energyKcal", { known: 350, reported: 2, missing: 1 }, englishI18n),
    ).toBe("350 kcal from 2 of 3 entries");
    expect(
      formatNutrientTotal("proteinG", { known: 12.34, reported: 2, missing: 0 }, englishI18n),
    ).toBe("12.3 g");
    expect(
      formatNutrientTotal("fiberG", { known: null, reported: 0, missing: 3 }, englishI18n),
    ).toBe("Unknown");
  });

  test("states coverage for every nutrient, including full and empty", () => {
    expect(inEnglish(formatCoverage({ reported: 0, missing: 0 }))).toBe("Nothing logged");
    expect(inEnglish(formatCoverage({ reported: 1, missing: 0 }))).toBe("From 1 entry");
    expect(inEnglish(formatCoverage({ reported: 3, missing: 0 }))).toBe("All 3 entries");
    expect(inEnglish(formatCoverage({ reported: 2, missing: 1 }))).toBe("2 of 3 entries");
    expect(inEnglish(formatCoverage({ reported: 0, missing: 1 }))).toBe("Not provided by 1 entry");
    expect(
      describeNutrientTotal(
        "saltG",
        { known: null, reported: 0, missing: 2, coverage: "none" },
        englishI18n,
      ),
    ).toBe("Salt: unknown, not provided by 2 entries");
    expect(
      describeNutrientTotal(
        "energyKcal",
        {
          known: 412,
          reported: 2,
          missing: 1,
          coverage: "partial",
        },
        englishI18n,
      ),
    ).toBe("Energy: 412 kcal, 2 of 3 entries");
    expect(
      describeNutrientTotal(
        "fiberG",
        {
          known: null,
          reported: 0,
          missing: 0,
          coverage: "no_entries",
        },
        englishI18n,
      ),
    ).toBe("Fibre: nothing logged");
  });

  test("lists every nutrient once, keeping salt/sodium and sugar types separate", () => {
    expect([...ALL_NUTRIENTS].sort()).toEqual([...NUTRIENT_KEYS].sort());
    const labels = ALL_NUTRIENTS.map((key) => inEnglish(NUTRIENT_LABELS[key].label));
    for (const label of ["Sodium", "Salt", "Total sugars", "Added sugars", "Free sugars"])
      expect(labels).toContain(label);
  });

  test("names the sources behind the totals", () => {
    expect(formatSources({ fdc: 2, off: 0, custom: 0, manual: 1 }, englishI18n)).toBe(
      "2 from USDA FoodData Central, 1 from Quick add",
    );
    expect(formatSources({ fdc: 0, off: 0, custom: 0, manual: 0 }, englishI18n)).toBeNull();
  });

  test("matches the server's domain summary exactly", () => {
    const entries = [
      { nutrients: nutrients({ energyKcal: 120.5, sodiumMg: 300 }), source: "fdc" as const },
      { nutrients: nutrients({ saltG: 0, totalSugarsG: 4 }), source: "off" as const },
    ];
    const server = summarizeEntries(entries);
    expect(summarizeDay(entries)).toEqual({
      entryCount: server.entryCount,
      totals: server.totals,
    });
  });
});

describe("day marker", () => {
  test("a blank unmarked day and a completed empty day read differently", () => {
    const blank = dayStatusText("unmarked", 0);
    const completedEmpty = dayStatusText("complete", 0);
    expect(inEnglish(blank.label)).not.toBe(inEnglish(completedEmpty.label));
    expect(inEnglish(blank.description)).toContain("not as zero");
    expect(inEnglish(completedEmpty.description)).toContain("nothing logged");
  });
});

describe("formatting helpers", () => {
  test("amounts, sources and slots", () => {
    expect(formatAmount(150, "g", englishI18n)).toBe("150 g");
    expect(formatAmount(1, "serving", englishI18n)).toBe("1 serving");
    expect(formatAmount(2.5, "serving", englishI18n)).toBe("2.5 servings");
    expect(inEnglish(foodSourceLabel("off"))).toBe("Open Food Facts");
    expect(groupBySlot([{ slot: "lunch" as const }]).map((group) => group.entries.length)).toEqual([
      0, 1, 0, 0, 0,
    ]);
  });

  test("local dates", () => {
    const instant = new Date("2026-10-14T23:30:00.000Z");
    expect(localDateIn("Europe/Lisbon", instant)).toBe("2026-10-15");
    expect(localDateIn("America/New_York", instant)).toBe("2026-10-14");
    expect(shiftLocalDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftLocalDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  test("client mutation ids are unique and fit the 64-char contract", () => {
    const a = newClientMutationId();
    const b = newClientMutationId();
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(64);
  });
});

describe("neutral copy", () => {
  // Judgement, pressure and alarm words the diary must never use.
  const BANNED =
    /\b(good|bad|healthy|unhealthy|junk|clean|cheat|guilt\w*|sin\w*|naughty|over|under|exceed\w*|too much|missed|streak\w*|fail\w*|warning|danger\w*|violat\w*|budget|allowance|earn\w*)\b/i;

  test("no user-facing diary string judges food, intake or completeness", () => {
    const strings = [
      ...Object.values(DIARY_COPY),
      ...Object.values(SLOT_LABELS),
      ...Object.values(SYNC_STATE_LABELS),
      ...Object.values(NUTRIENT_LABELS).map((entry) => entry.label),
      ...[
        [0, 0],
        [1, 0],
        [3, 0],
        [2, 1],
        [0, 2],
      ].map(([reported, missing]) => formatCoverage({ reported: reported!, missing: missing! })),
      ...(["unmarked", "complete"] as const).flatMap((status) =>
        [0, 3].flatMap((count) => Object.values(dayStatusText(status, count))),
      ),
    ];
    for (const text of strings) expect(inEnglish(text)).not.toMatch(BANNED);
  });
});

describe("portion preview", () => {
  const per100g = {
    nutrientBasisAmount: 100,
    nutrientBasisUnit: "g" as const,
    servingSizeAmount: 30,
    servingSizeUnit: "g" as const,
    servingLabel: "1 slice",
  };
  const perServing = {
    nutrientBasisAmount: 1,
    nutrientBasisUnit: "serving" as const,
    servingSizeAmount: 250,
    servingSizeUnit: "ml" as const,
    servingLabel: null,
  };
  const noServing = { ...per100g, servingSizeAmount: null, servingSizeUnit: null };

  test("matches computeNutrientFactor in @openvalens/nutrition", () => {
    const cases = [
      [per100g, 150, "g"],
      [per100g, 2, "serving"],
      [per100g, 50, "ml"],
      [perServing, 500, "ml"],
      [perServing, 1.5, "serving"],
      [perServing, 100, "g"],
      [noServing, 1, "serving"],
    ] as const;
    for (const [basis, amount, unit] of cases) {
      let expected: number | null;
      try {
        expected = computeNutrientFactor(basis, amount, unit);
      } catch {
        expected = null;
      }
      expect(previewFactor(basis, amount, unit)).toBe(expected);
    }
  });

  test("keeps unknown values unknown and lists loggable units", () => {
    const values = previewNutrients(per100g, nutrients({ energyKcal: 250 }), 2, "serving");
    expect(values?.energyKcal).toBeCloseTo(150);
    expect(values?.proteinG).toBeNull();
    expect(previewNutrients(noServing, nutrients({}), 1, "serving")).toBeNull();
    expect(unitsFor(per100g)).toEqual(["g", "serving"]);
    expect(unitsFor(perServing)).toEqual(["ml", "serving"]);
  });

  test("quick add: blank nutrients stay unknown, invalid input is explained", () => {
    const parsed = parseQuickAdd({
      name: " Soup ",
      basisAmount: "1",
      basisUnit: "serving",
      nutrients: { energyKcal: "120", proteinG: "", fatG: "0" },
    });
    expect(parsed).toEqual({
      ok: true,
      food: {
        name: "Soup",
        nutrientBasisAmount: 1,
        nutrientBasisUnit: "serving",
        nutrients: { energyKcal: 120, fatG: 0 },
      },
    });
    expect(parseQuickAdd({ name: "", basisAmount: "1", basisUnit: "g", nutrients: {} }).ok).toBe(
      false,
    );
    expect(
      parseQuickAdd({ name: "x", basisAmount: "1", basisUnit: "g", nutrients: { fatG: "-1" } }),
    ).toMatchObject({ ok: false });
  });
});
