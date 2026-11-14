import { describe, expect, test } from "bun:test";

import { createAppI18n } from "@openvalens/i18n";
import { englishI18n, inEnglish } from "@openvalens/i18n/testing";

import type { NutrientKey, NutrientTotal } from "../contracts/nutrition-diary";
import type { NutritionTargetWire } from "../contracts/nutrition-targets";
import { formatAlcoholTotal, formatCaffeineTotal, formatStandardDrinks } from "./drinks";
import { presentEnergyEstimate, presentProposal } from "./energy-estimate";
import {
  describeDisplayedTotal,
  describeTarget,
  displayTotalValue,
  formatDrinkNutrientsLine,
  formatNutrientSummaryLine,
  formatProteinReference,
  formatTarget,
  HIDDEN_VALUE,
} from "./nutrition-targets";
import {
  describeWaterSubtotal,
  formatWaterAmount,
  formatWaterGoal,
  formatWaterSubtotal,
} from "./plain-water";
import { timelineSummary, timelineTitle } from "./timeline";

const portugueseI18n = createAppI18n("pt-PT");

/**
 * Hide-numbers leak check (#88). Every text presenter that renders intake,
 * target, estimate, proposal or water values, including the accessible
 * one-line readings, is run with the mode on: no digit may survive except in
 * calendar dates, which stay usable. A new surface should add its presenter
 * here.
 */

const withoutDates = (text: string) => text.replace(/\d{4}-\d{2}-\d{2}/g, "");
function expectNoNumbers(text: string | null | undefined) {
  expect(withoutDates(text ?? "")).not.toMatch(/\d/);
}

const values = {
  energyKcal: 412,
  proteinG: 9.5,
  carbohydrateG: 60,
  fatG: 12,
  fiberG: 4,
  totalSugarsG: 3,
  sodiumMg: 250,
  caffeineMg: 63,
  alcoholG: 3.9,
} as Record<NutrientKey, number>;
const target: NutritionTargetWire = {
  id: 1,
  nutrient: "energyKcal",
  minAmount: 1800,
  maxAmount: 2200,
  source: "entered",
  effectiveFrom: "2026-10-01",
  effectiveTo: null,
};
const total: NutrientTotal = { known: 1234, reported: 3, missing: 1, coverage: "partial" };

describe("hide-numbers mode (#88)", () => {
  test("food, target and day-total text carries no numbers", () => {
    expect(formatNutrientSummaryLine(values, true, englishI18n)).toBe(inEnglish(HIDDEN_VALUE));
    expect(formatDrinkNutrientsLine(values, true, englishI18n)).toBe(inEnglish(HIDDEN_VALUE));
    expectNoNumbers(formatTarget(target, true, englishI18n));
    expectNoNumbers(describeTarget(target, true, englishI18n));
    expectNoNumbers(displayTotalValue("energyKcal", total, true, englishI18n));
    expectNoNumbers(
      formatProteinReference(
        { minG: 55, maxG: 70, minGPerKg: 0.8, maxGPerKg: 1 },
        true,
        englishI18n,
      ),
    );
  });

  test("accessible total readings keep coverage words but no amounts", () => {
    const reading = describeDisplayedTotal("energyKcal", total, true, englishI18n);
    expect(reading).not.toContain("1234");
    expect(reading).not.toContain("1,234");
    expect(reading).toContain("value hidden");
  });

  test("estimates, pending proposals and water amounts are withheld", () => {
    expect(presentEnergyEstimate({ status: "estimated" } as never, true, englishI18n)).toBeNull();
    expect(
      presentProposal({ targetKcal: 2000, currentTargetKcal: 1800 } as never, true, englishI18n),
    ).toBeNull();
    for (const unit of ["ml", "l", "fl_oz"] as const) {
      expectNoNumbers(formatWaterAmount(500, unit, true, englishI18n));
      expectNoNumbers(formatWaterGoal(2000, unit, true, englishI18n));
      const view = { entryCount: 2, subtotalMl: 750, incomplete: false };
      expectNoNumbers(formatWaterSubtotal(view, unit, true, englishI18n));
      expectNoNumbers(describeWaterSubtotal(view, unit, true, englishI18n));
    }
  });

  test("caffeine and alcohol totals are withheld (#443)", () => {
    const drink = { knownEntries: 1, totalEntries: 2, amount: 163, atLeast: true };
    expectNoNumbers(formatCaffeineTotal(drink, englishI18n, true));
    expectNoNumbers(formatAlcoholTotal(drink, englishI18n, true));
    expect(
      formatStandardDrinks(
        {
          status: "ready",
          total: drink,
          standardDrinks: 16.3,
          definition: {
            region: "pt",
            grams: 10,
            unit: "standard_drink",
            org: "DGS",
            document: "Norma 030/2012",
            url: "https://example.org",
          },
        },
        englishI18n,
        true,
      ),
    ).toBeNull();
  });

  test("plain water on the timeline is withheld (#493)", () => {
    // The server drops the amount; the presenter withholds anything marked hidden.
    const water = {
      id: "plain_water_entry:1",
      at: "2026-10-01T08:00:00.000Z",
      kind: "event",
      domain: "water",
      title: "Plain water",
      summary: "Plain water",
      severity: "none",
      sourceRefs: [{ type: "source_record", label: "plain_water_entry:1", provider: "manual" }],
      canonical: { table: "plain_water_entry", quantityMl: 250, hidden: true },
    };
    for (const i18n of [englishI18n, portugueseI18n]) {
      expectNoNumbers(timelineSummary(water, i18n));
      expectNoNumbers(timelineTitle(water, i18n));
    }
  });

  test("the same values are shown when the mode is off", () => {
    expect(formatNutrientSummaryLine(values, false, englishI18n)).toContain("412 kcal");
    expect(formatTarget(target, false, englishI18n)).toContain("1,800");
  });
});
