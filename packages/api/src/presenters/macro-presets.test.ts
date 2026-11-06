import { describe, expect, test } from "bun:test";
import { englishI18n } from "@openvalens/i18n/testing";
import { findBannedCopy } from "@openvalens/nutrition/nutrition-safety";

import {
  MACRO_PRESETS,
  PRESET_COPY,
  PRESET_LABELS,
  formatGPerKg,
  presetTargets,
  proteinOptions,
} from "./macro-presets";

describe("macro presets (#399)", () => {
  test("protein options stay inside the member's reference", () => {
    expect(proteinOptions({ minGPerKg: 0.8, maxGPerKg: 0.8 })).toEqual([0.8]);
    expect(proteinOptions({ minGPerKg: 1.2, maxGPerKg: 1.6 })).toEqual([1.2, 1.4, 1.6]);
    expect(proteinOptions({ minGPerKg: 1, maxGPerKg: 1 })).toEqual([1]);
    expect(proteinOptions(null)).toEqual([]);
  });

  test("a preset splits the energy target; the macros add back up to it", () => {
    const result = presetTargets({
      preset: "balanced",
      energyKcal: 2000,
      weightKg: 70,
      proteinGPerKg: 1.2,
    });
    expect(result).toEqual({ ok: true, proteinG: 85, carbohydrateG: 270, fatG: 65 });
    if (!result.ok) throw new Error("expected targets");
    const kcal = result.proteinG * 4 + result.carbohydrateG * 4 + result.fatG * 9;
    expect(Math.abs(kcal - 2000)).toBeLessThanOrEqual(30);
    const lowerCarb = presetTargets({
      preset: "lower_carb",
      energyKcal: 2000,
      weightKg: 70,
      proteinGPerKg: 1.2,
    });
    const lowerFat = presetTargets({
      preset: "lower_fat",
      energyKcal: 2000,
      weightKg: 70,
      proteinGPerKg: 1.2,
    });
    if (!lowerCarb.ok || !lowerFat.ok) throw new Error("expected targets");
    expect(lowerCarb.carbohydrateG).toBeLessThan(result.carbohydrateG);
    expect(lowerFat.fatG).toBeLessThan(result.fatG);
  });

  test("needs an energy target and a weight, and refuses splits that don't fit", () => {
    expect(
      presetTargets({ preset: "balanced", energyKcal: null, weightKg: 70, proteinGPerKg: 0.8 }),
    ).toEqual({
      ok: false,
      reason: "needs_energy",
    });
    expect(
      presetTargets({ preset: "balanced", energyKcal: 2000, weightKg: null, proteinGPerKg: 0.8 }),
    ).toEqual({
      ok: false,
      reason: "needs_weight",
    });
    expect(
      presetTargets({ preset: "lower_carb", energyKcal: 1200, weightKg: 120, proteinGPerKg: 1.6 }),
    ).toEqual({ ok: false, reason: "does_not_fit" });
  });

  test("names and copy are neutral", () => {
    expect(formatGPerKg(1.2, englishI18n)).toBe("1.2 g per kg");
    const text = [
      ...MACRO_PRESETS.map((key) => englishI18n._(PRESET_LABELS[key])),
      ...Object.values(PRESET_COPY).map((m) => englishI18n._(m)),
    ].join(" ");
    expect(findBannedCopy(text)).toEqual([]);
  });
});
