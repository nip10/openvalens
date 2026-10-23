import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg, select } from "@lingui/core/macro";

import type { CustomFood, CustomFoodContent } from "../contracts/nutrition-custom-foods";
import {
  NUTRIENT_KEYS,
  type AmountUnit,
  type NutrientBasis,
  type NutrientKey,
} from "../contracts/nutrition-diary";
import { NUTRIENT_LABELS, formatAmount, parseQuickAdd } from "./nutrition-diary";

/**
 * Shared copy and form logic for managing private custom foods (Issue #81),
 * used by `apps/web` and `apps/native` so both platforms validate and word
 * things the same way. Blank fields stay unknown (`null`); `0` is a value.
 * Copy is neutral: it records, it never judges.
 */

export const CUSTOM_FOOD_COPY = Object.freeze({
  title: msg`My foods`,
  manageLink: msg`Manage my foods`,
  privacy: msg`Foods you save here are private to you. They are not shared with other members or added to public food databases.`,
  empty: msg`No saved foods yet. Create one here or tick “Save to my foods” when you quick add.`,
  create: msg`New food`,
  save: msg`Save food`,
  saving: msg`Saving…`,
  edit: msg`Edit`,
  cancel: msg`Cancel`,
  archive: msg`Archive`,
  restore: msg`Restore`,
  showArchived: msg`Show archived foods`,
  archivedBadge: msg`Archived`,
  archived: msg`Food archived. It no longer appears in search or quick logging.`,
  restored: msg`Food restored.`,
  saved: msg`Food saved.`,
  unchanged: msg`No changes to save.`,
  editNote: msg`Changes apply to new entries. Meals you already logged keep the values they were saved with.`,
  archiveNote: msg`Archiving hides a food from search and logging. Meals you already logged keep their values, and you can restore it later.`,
  blankNote: msg`Leave a value blank if you do not know it. Blank is shown as unknown; 0 is saved as zero.`,
  provenance: msg`Entered by you`,
  conflictTitle: msg`This food changed on another device`,
  conflictArchived: msg`This food was archived on another device. Restore it to edit.`,
  keepMine: msg`Keep my change`,
  keepServer: msg`Keep the other version`,
  networkError: msg`Could not reach the server. Your saved foods are unchanged.`,
  retry: msg`Retry`,
});

/** Every core nutrient, in label order; all optional. */
export const CUSTOM_FOOD_NUTRIENTS: readonly NutrientKey[] = NUTRIENT_KEYS;

/** Raw text fields of the custom food form. */
export type CustomFoodFields = {
  name: string;
  brand: string;
  barcode: string;
  basisAmount: string;
  basisUnit: AmountUnit;
  servingSizeAmount: string;
  servingSizeUnit: "g" | "ml";
  servingLabel: string;
  nutrients: Partial<Record<NutrientKey, string>>;
};

export const EMPTY_CUSTOM_FOOD_FIELDS: CustomFoodFields = Object.freeze({
  name: "",
  brand: "",
  barcode: "",
  basisAmount: "100",
  basisUnit: "g",
  servingSizeAmount: "",
  servingSizeUnit: "g",
  servingLabel: "",
  nutrients: {},
}) as CustomFoodFields;

/** Form fields for editing a saved food: unknown stays blank, zero stays `"0"`. */
export function fieldsFromCustomFood(food: CustomFood): CustomFoodFields {
  const nutrients: Partial<Record<NutrientKey, string>> = {};
  for (const key of NUTRIENT_KEYS) {
    const value = food.nutrientsPerBasis[key];
    if (value !== null) nutrients[key] = String(value);
  }
  return {
    name: food.name,
    brand: food.brand ?? "",
    barcode: food.barcode ?? "",
    basisAmount: String(food.basis.nutrientBasisAmount),
    basisUnit: food.basis.nutrientBasisUnit,
    servingSizeAmount:
      food.basis.servingSizeAmount === null ? "" : String(food.basis.servingSizeAmount),
    servingSizeUnit: food.basis.servingSizeUnit ?? "g",
    servingLabel: food.basis.servingLabel ?? "",
    nutrients,
  };
}

/**
 * Validates the form into the wire shape. Every optional field is sent
 * explicitly (`null` when blank) so an edit can clear a value.
 */
export function parseCustomFood(
  fields: CustomFoodFields,
): { ok: true; food: CustomFoodContent } | { ok: false; error: MessageDescriptor } {
  const base = parseQuickAdd({
    name: fields.name,
    basisAmount: fields.basisAmount,
    basisUnit: fields.basisUnit,
    nutrients: fields.nutrients,
    barcode: fields.barcode,
  });
  if (!base.ok) return base;
  if (base.food.name.length > 200)
    return { ok: false, error: msg`Use at most 200 characters for the name.` };
  const brand = fields.brand.trim();
  if (brand.length > 200)
    return { ok: false, error: msg`Use at most 200 characters for the brand.` };
  const servingLabel = fields.servingLabel.trim();
  if (servingLabel.length > 100)
    return { ok: false, error: msg`Use at most 100 characters for the serving name.` };
  const rawServing = fields.servingSizeAmount.trim();
  const servingSizeAmount = rawServing ? Number(rawServing) : null;
  if (servingSizeAmount !== null && (!Number.isFinite(servingSizeAmount) || servingSizeAmount <= 0))
    return { ok: false, error: msg`Serving size must be a positive amount, or left blank.` };
  const nutrients = Object.fromEntries(
    NUTRIENT_KEYS.map((key) => [key, base.food.nutrients?.[key] ?? null]),
  ) as Record<NutrientKey, number | null>;
  return {
    ok: true,
    food: {
      name: base.food.name,
      brand: brand || null,
      barcode: base.food.barcode ?? null,
      nutrientBasisAmount: base.food.nutrientBasisAmount,
      nutrientBasisUnit: base.food.nutrientBasisUnit,
      servingSizeAmount,
      servingSizeUnit: servingSizeAmount === null ? null : fields.servingSizeUnit,
      servingLabel: servingLabel || null,
      nutrients,
    },
  };
}

/** `"Values per 100 g · 1 slice = 30 g"`. */
export function describeBasis(basis: NutrientBasis, i18n: I18n): string {
  const per = formatAmount(basis.nutrientBasisAmount, basis.nutrientBasisUnit, i18n);
  const label = basis.servingLabel;
  if (basis.servingSizeAmount === null || basis.servingSizeUnit === null)
    return label
      ? i18n._(msg`Values per ${per} · serving: ${label}`)
      : i18n._(msg`Values per ${per}`);
  const size = formatAmount(basis.servingSizeAmount, basis.servingSizeUnit, i18n);
  return label
    ? i18n._(msg`Values per ${per} · ${label} = ${size}`)
    : i18n._(msg`Values per ${per} · 1 serving = ${size}`);
}

/** `"5 of 12 values entered"`: how much of the label the member filled in. */
export function describeCoverage(food: Pick<CustomFood, "nutrientsPerBasis">): MessageDescriptor {
  const entered = NUTRIENT_KEYS.filter((key) => food.nutrientsPerBasis[key] !== null).length;
  const total = NUTRIENT_KEYS.length;
  return msg`${entered} of ${total} values entered`;
}

/** Field label with its unit, e.g. `"Protein (g, optional)"`. */
export function nutrientFieldLabel(key: NutrientKey): MessageDescriptor {
  const unit = NUTRIENT_LABELS[key].unit;
  return msg`${select(key, {
    energyKcal: "Energy",
    energyKj: "Energy",
    proteinG: "Protein",
    carbohydrateG: "Carbohydrate",
    fatG: "Fat",
    saturatedFatG: "Saturated fat",
    fiberG: "Fibre",
    totalSugarsG: "Total sugars",
    addedSugarsG: "Added sugars",
    freeSugarsG: "Free sugars",
    sodiumMg: "Sodium",
    saltG: "Salt",
    other: "Value",
  })} (${unit}, optional)`;
}
