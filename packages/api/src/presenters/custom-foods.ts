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
  title: "My foods",
  manageLink: "Manage my foods",
  privacy:
    "Foods you save here are private to you. They are not shared with other members or added to public food databases.",
  empty: "No saved foods yet. Create one here or tick “Save to my foods” when you quick add.",
  create: "New food",
  save: "Save food",
  saving: "Saving…",
  edit: "Edit",
  cancel: "Cancel",
  archive: "Archive",
  restore: "Restore",
  showArchived: "Show archived foods",
  archivedBadge: "Archived",
  archived: "Food archived. It no longer appears in search or quick logging.",
  restored: "Food restored.",
  saved: "Food saved.",
  unchanged: "No changes to save.",
  editNote:
    "Changes apply to new entries. Meals you already logged keep the values they were saved with.",
  archiveNote:
    "Archiving hides a food from search and logging. Meals you already logged keep their values, and you can restore it later.",
  blankNote:
    "Leave a value blank if you do not know it. Blank is shown as unknown; 0 is saved as zero.",
  provenance: "Entered by you",
  conflictTitle: "This food changed on another device",
  conflictArchived: "This food was archived on another device. Restore it to edit.",
  keepMine: "Keep my change",
  keepServer: "Keep the other version",
  networkError: "Could not reach the server. Your saved foods are unchanged.",
  retry: "Retry",
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
): { ok: true; food: CustomFoodContent } | { ok: false; error: string } {
  const base = parseQuickAdd({
    name: fields.name,
    basisAmount: fields.basisAmount,
    basisUnit: fields.basisUnit,
    nutrients: fields.nutrients,
    barcode: fields.barcode,
  });
  if (!base.ok) return base;
  if (base.food.name.length > 200)
    return { ok: false, error: "Use at most 200 characters for the name." };
  const brand = fields.brand.trim();
  if (brand.length > 200) return { ok: false, error: "Use at most 200 characters for the brand." };
  const servingLabel = fields.servingLabel.trim();
  if (servingLabel.length > 100)
    return { ok: false, error: "Use at most 100 characters for the serving name." };
  const rawServing = fields.servingSizeAmount.trim();
  const servingSizeAmount = rawServing ? Number(rawServing) : null;
  if (servingSizeAmount !== null && (!Number.isFinite(servingSizeAmount) || servingSizeAmount <= 0))
    return { ok: false, error: "Serving size must be a positive amount, or left blank." };
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
export function describeBasis(basis: NutrientBasis): string {
  const per = `Values per ${formatAmount(basis.nutrientBasisAmount, basis.nutrientBasisUnit)}`;
  if (basis.servingSizeAmount === null || basis.servingSizeUnit === null)
    return basis.servingLabel ? `${per} · serving: ${basis.servingLabel}` : per;
  const size = formatAmount(basis.servingSizeAmount, basis.servingSizeUnit);
  return `${per} · ${basis.servingLabel ?? "1 serving"} = ${size}`;
}

/** `"5 of 12 values entered"`: how much of the label the member filled in. */
export function describeCoverage(food: Pick<CustomFood, "nutrientsPerBasis">): string {
  const entered = NUTRIENT_KEYS.filter((key) => food.nutrientsPerBasis[key] !== null).length;
  return `${entered} of ${NUTRIENT_KEYS.length} values entered`;
}

/** Field label with its unit, e.g. `"Protein (g, optional)"`. */
export function nutrientFieldLabel(key: NutrientKey): string {
  return `${NUTRIENT_LABELS[key].label} (${NUTRIENT_LABELS[key].unit}, optional)`;
}
