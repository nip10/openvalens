import { describe, expect, test } from "bun:test";
import { englishI18n, inEnglish } from "@openvalens/i18n/testing";
import { DRINK_PRESET_KEYS as DOMAIN_KEYS } from "@openvalens/nutrition/drinks";
import { findBannedCopy } from "@openvalens/nutrition/nutrition-safety";

import { DRINK_PRESET_KEYS, lastCaffeineInput } from "../contracts/nutrition-drinks";
import {
  DRINK_PRESET_LABELS,
  DRINKS_COPY,
  caffeineWindowsForNights,
  describeCaffeineReference,
  describeStandardDrink,
  drinkCoverageText,
  drinkPresetLabel,
  formatAlcoholTotal,
  formatCaffeineTotal,
  formatStandardDrinks,
  lastCaffeineText,
} from "./drinks";

const i18n = englishI18n;
const full = { knownEntries: 2, totalEntries: 2, amount: 163, atLeast: false };
const partial = { knownEntries: 2, totalEntries: 3, amount: 15.6, atLeast: true };
const pt = {
  region: "pt" as const,
  grams: 10,
  unit: "standard_drink" as const,
  org: "DGS",
  document: "Norma 030/2012",
  url: "https://example.org",
};

describe("drink copy (#443)", () => {
  test("contract preset keys match the domain", () => {
    expect([...DRINK_PRESET_KEYS]).toEqual([...DOMAIN_KEYS]);
  });

  test("no judgement, limit or medical language", () => {
    const strings = [
      ...Object.values(DRINKS_COPY).map(inEnglish),
      ...Object.values(DRINK_PRESET_LABELS).map(inEnglish),
    ];
    for (const text of strings) {
      expect(findBannedCopy(text)).toEqual([]);
      expect(text.toLowerCase()).not.toMatch(
        /limit|guideline|recommended|safe|hydration|too many|diagnos/,
      );
    }
  });

  test("labels presets with their volume", () => {
    expect(drinkPresetLabel("beer", i18n)).toBe("Beer · 330 ml");
    expect(drinkPresetLabel("espresso", i18n)).toBe("Espresso · 30 ml");
  });

  test("totals, coverage and at-least", () => {
    expect(formatCaffeineTotal(full, i18n, false)).toBe("163 mg");
    expect(formatAlcoholTotal(partial, i18n, false)).toBe("at least 15.6 g");
    expect(inEnglish(drinkCoverageText(partial))).toBe("2 of 3 foods reported a value");
    expect(
      formatCaffeineTotal(
        { knownEntries: 0, totalEntries: 1, amount: null, atLeast: false },
        i18n,
        false,
      ),
    ).toBe("Unknown");
  });

  test("standard drinks cite the region's definition", () => {
    const alcohol = {
      status: "ready" as const,
      total: partial,
      definition: pt,
      standardDrinks: 1.6,
    };
    expect(formatStandardDrinks(alcohol, i18n, false)).toBe("at least 1.6 standard drinks");
    expect(describeStandardDrink(pt, i18n)).toBe(
      "1 standard drink = 10 g of pure alcohol (DGS, Norma 030/2012)",
    );
    expect(
      describeStandardDrink({ ...pt, region: "uk", grams: 8, unit: "uk_unit", org: "NHS" }, i18n),
    ).toBe("1 UK unit = 8 g of pure alcohol (NHS, Norma 030/2012)");
    expect(
      formatStandardDrinks({ ...alcohol, definition: null, standardDrinks: null }, i18n, false),
    ).toBeNull();
  });

  test("the caffeine reference is a number with its source", () => {
    expect(
      describeCaffeineReference(
        { mgPerDay: 400, org: "EFSA", document: "x", url: "https://example.org" },
        i18n,
      ),
    ).toBe("EFSA reference for adults: 400 mg a day");
    expect(lastCaffeineText("16:40", i18n)).toBe("Last caffeine 16:40");
  });

  test("hide-numbers mode leaves no digits", () => {
    const alcohol = {
      status: "ready" as const,
      total: partial,
      definition: pt,
      standardDrinks: 1.6,
    };
    expect(formatCaffeineTotal(full, i18n, true)).not.toMatch(/\d/);
    expect(formatAlcoholTotal(partial, i18n, true)).not.toMatch(/\d/);
    expect(formatStandardDrinks(alcohol, i18n, true)).toBeNull();
  });
});

describe("caffeine windows for sleep nights (#443)", () => {
  test("from the previous night's end, at most 24 hours, to this night's start", () => {
    const windows = caffeineWindowsForNights([
      {
        date: "2026-11-13",
        mainSleepStart: "2026-11-12T23:00:00.000Z",
        mainSleepEnd: "2026-11-13T07:00:00.000Z",
      },
      {
        date: "2026-11-12",
        mainSleepStart: "2026-11-11T23:30:00.000Z",
        mainSleepEnd: "2026-11-12T06:30:00.000Z",
      },
      { date: "2026-11-10", mainSleepStart: null, mainSleepEnd: null },
    ]);
    expect(windows.nights).toEqual([
      {
        key: "2026-11-12",
        from: "2026-11-10T23:30:00.000Z",
        to: "2026-11-11T23:30:00.000Z",
      },
      {
        key: "2026-11-13",
        from: "2026-11-12T06:30:00.000Z",
        to: "2026-11-12T23:00:00.000Z",
      },
    ]);
    expect(lastCaffeineInput.safeParse(windows).success).toBe(true);
  });

  test("keeps the latest 31 nights, which the contract accepts", () => {
    const nights = Array.from({ length: 40 }, (_, index) => {
      const start = Date.UTC(2026, 9, 1 + index, 23);
      return {
        date: new Date(start + 8 * 3_600_000).toISOString().slice(0, 10),
        mainSleepStart: new Date(start).toISOString(),
        mainSleepEnd: new Date(start + 8 * 3_600_000).toISOString(),
      };
    });
    const windows = caffeineWindowsForNights(nights);
    expect(windows.nights).toHaveLength(31);
    expect(windows.nights.at(-1)?.key).toBe(nights.at(-1)?.date);
    expect(lastCaffeineInput.safeParse(windows).success).toBe(true);
  });

  test("the contract rejects long or reversed windows", () => {
    const night = { key: "k", from: "2026-11-10T00:00:00Z", to: "2026-11-12T00:00:00Z" };
    expect(lastCaffeineInput.safeParse({ nights: [night] }).success).toBe(false);
    expect(
      lastCaffeineInput.safeParse({ nights: [{ ...night, to: "2026-11-09T00:00:00Z" }] }).success,
    ).toBe(false);
  });
});
