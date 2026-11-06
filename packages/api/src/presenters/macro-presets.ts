/**
 * Diet-style presets and protein per kg (#399). Pure and client-safe.
 *
 * A preset works out protein, carbohydrate and fat targets from the member's
 * own energy target and recent weight. It is a proposal: nothing is saved
 * until the member saves the targets, and saved targets are "entered by
 * you". Protein per kg is limited to the server's protein reference for the
 * member (0.8 g/kg by default, 1.2–1.6 only with the active opt-in, at least
 * 1.0 at 65+, at most 0.8 with a kidney declaration), so a preset can never
 * push protein past those bounds. Names are neutral: no "clean", no diets
 * framed as better or worse.
 */
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

/** The single energy target a goal row stands for (midpoint of a range). */
export { energyTargetOf } from "@openvalens/nutrition/energy-proposal-policy";

export const MACRO_PRESETS = ["balanced", "lower_carb", "lower_fat"] as const;
export type MacroPreset = (typeof MACRO_PRESETS)[number];

/** Share of energy from fat per preset; carbohydrate takes what protein and fat leave. */
export const PRESET_FAT_SHARE: Readonly<Record<MacroPreset, number>> = Object.freeze({
  balanced: 0.3,
  lower_carb: 0.4,
  lower_fat: 0.2,
});

export const PRESET_LABELS: Readonly<Record<MacroPreset, MessageDescriptor>> = Object.freeze({
  balanced: msg({ message: "Balanced", context: "macro preset" }),
  lower_carb: msg({ message: "Lower carb", context: "macro preset" }),
  lower_fat: msg({ message: "Lower fat", context: "macro preset" }),
});

export const PRESET_COPY = Object.freeze({
  title: msg`Macro targets from a style`,
  description: msg`Works out protein, carbohydrate and fat targets from your energy target and recent weight. Nothing changes until you save them.`,
  proteinPerKg: msg`Protein per kg of body weight`,
  save: msg`Save these targets`,
  saved: msg`Macro targets saved.`,
  needsEnergy: msg`Set an energy target first.`,
  needsWeight: msg`A recent weight is needed to work out protein.`,
  doesNotFit: msg`These choices don't fit inside your energy target. Try a lower protein or another style.`,
  kidneyCap: msg({
    message: "Protein stays at 0.8 g per kg or less because of your chronic kidney disease answer.",
    comment: "safety",
  }),
  activeHint: msg`Higher protein options appear when you turn on the active reference.`,
});

const KCAL_PER_G = { protein: 4, carbohydrate: 4, fat: 9 } as const;

/**
 * The g/kg values a member can pick: 0.2 steps inside their protein
 * reference range (both ends included), or the single reference value.
 */
export function proteinOptions(
  reference: { minGPerKg: number; maxGPerKg: number } | null,
): number[] {
  if (!reference) return [];
  const { minGPerKg: min, maxGPerKg: max } = reference;
  const out: number[] = [];
  for (let value = min; value <= max + 1e-9; value += 0.2) out.push(Math.round(value * 10) / 10);
  if (out.at(-1) !== max) out.push(max);
  return [...new Set(out)];
}

export type PresetTargets =
  | { ok: true; proteinG: number; carbohydrateG: number; fatG: number }
  | { ok: false; reason: "needs_energy" | "needs_weight" | "does_not_fit" };

const round5 = (value: number) => Math.round(value / 5) * 5;

/** Protein, carbohydrate and fat (g/day) for a preset, an energy target and a weight. */
export function presetTargets(input: {
  preset: MacroPreset;
  energyKcal: number | null;
  weightKg: number | null;
  proteinGPerKg: number;
}): PresetTargets {
  if (input.energyKcal === null || !(input.energyKcal > 0))
    return { ok: false, reason: "needs_energy" };
  if (input.weightKg === null || !(input.weightKg > 0))
    return { ok: false, reason: "needs_weight" };
  const proteinG = round5(input.proteinGPerKg * input.weightKg);
  const fatG = round5((PRESET_FAT_SHARE[input.preset] * input.energyKcal) / KCAL_PER_G.fat);
  const carbKcal = input.energyKcal - proteinG * KCAL_PER_G.protein - fatG * KCAL_PER_G.fat;
  const carbohydrateG = round5(carbKcal / KCAL_PER_G.carbohydrate);
  if (carbohydrateG < 50) return { ok: false, reason: "does_not_fit" };
  return { ok: true, proteinG, carbohydrateG, fatG };
}

/** `"1.2 g per kg"`. */
export function formatGPerKg(value: number, i18n: I18n): string {
  const text = value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return i18n._(msg`${text} g per kg`);
}
