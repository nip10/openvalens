import { describe, expect, test } from "bun:test";

import type { NutrientKey, NutrientTotal } from "../contracts/nutrition-diary";
import type { NutritionTargetWire } from "../contracts/nutrition-targets";
import { presentEnergyEstimate, presentProposal } from "./energy-estimate";
import {
  describeDisplayedTotal,
  describeTarget,
  displayTotalValue,
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
    expect(formatNutrientSummaryLine(values, true)).toBe(HIDDEN_VALUE);
    expectNoNumbers(formatTarget(target, true));
    expectNoNumbers(describeTarget(target, true));
    expectNoNumbers(displayTotalValue("energyKcal", total, true));
    expectNoNumbers(
      formatProteinReference({ minG: 55, maxG: 70, minGPerKg: 0.8, maxGPerKg: 1 }, true),
    );
  });

  test("accessible total readings keep coverage words but no amounts", () => {
    const reading = describeDisplayedTotal("energyKcal", total, true);
    expect(reading).not.toContain("1234");
    expect(reading).not.toContain("1,234");
    expect(reading).toContain("value hidden");
  });

  test("estimates, pending proposals and water amounts are withheld", () => {
    expect(presentEnergyEstimate({ status: "estimated" } as never, true)).toBeNull();
    expect(
      presentProposal({ targetKcal: 2000, currentTargetKcal: 1800 } as never, true),
    ).toBeNull();
    for (const unit of ["ml", "l", "fl_oz"] as const) {
      expectNoNumbers(formatWaterAmount(500, unit, true));
      expectNoNumbers(formatWaterGoal(2000, unit, true));
      const view = { entryCount: 2, subtotalMl: 750, incomplete: false };
      expectNoNumbers(formatWaterSubtotal(view, unit, true));
      expectNoNumbers(describeWaterSubtotal(view, unit, true));
    }
  });

  test("the same values are shown when the mode is off", () => {
    expect(formatNutrientSummaryLine(values, false)).toContain("412 kcal");
    expect(formatTarget(target, false)).toContain("1,800");
  });
});
