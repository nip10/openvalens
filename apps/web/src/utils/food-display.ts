import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { CustomFood } from "@openvalens/api/contracts/nutrition-custom-foods";
import type { FoodDraftCandidateWire } from "@openvalens/api/contracts/nutrition-food-drafts";
import { NUTRIENT_KEYS, type AmountUnit } from "@openvalens/api/contracts/nutrition-diary";
import type { NutritionTargetWire } from "@openvalens/api/contracts/nutrition-targets";
import { formatAmount } from "@openvalens/api/presenters/nutrition-diary";

import { friendlyDate } from "@/utils/friendly";

/**
 * Short readings for the food screens (meal diary, My foods, targets). Pure
 * functions of their inputs and the locale.
 */

/** "Today, 16 Nov" for the diary's day switcher, or "8 Oct" when the friendly name is the date. */
export function diaryDayLabel(i18n: I18n, iso: string, now: Date = new Date()): string {
  const friendly = friendlyDate(i18n, iso, now);
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return friendly;
  const short = new Intl.DateTimeFormat(i18n.locale, {
    day: "numeric",
    month: "short",
    ...(y === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(new Date(y, m - 1, d));
  return friendly === short ? short : `${friendly}, ${short}`;
}

/** "per 100 g", "per serving", "per mug": what a food's values are for (foods#1). */
export function shortBasis(food: Pick<CustomFood, "basis">, i18n: I18n): string {
  const { nutrientBasisAmount, nutrientBasisUnit, servingLabel } = food.basis;
  if (nutrientBasisUnit === "serving" && nutrientBasisAmount === 1) {
    // "1 mug" reads "per mug"; a generic "1 portion" reads "per serving".
    const label = servingLabel?.trim().replace(/^1\s+/, "");
    if (!label || /^(portion|serving)$/i.test(label)) return i18n._(msg`per serving`);
    return i18n._(msg`per ${label}`);
  }
  const amount = formatAmount(nutrientBasisAmount, nutrientBasisUnit, i18n);
  return i18n._(msg`per ${amount}`);
}

/** How many nutrient values the member filled in for a food. */
export function enteredValues(food: Pick<CustomFood, "nutrientsPerBasis">): number {
  return NUTRIENT_KEYS.filter((key) => (food.nutrientsPerBasis[key] ?? null) !== null).length;
}

/** "since 19 Aug", "19 Aug to 1 Dec", with the source when it was an accepted suggestion. */
export function targetSince(
  target: Pick<NutritionTargetWire, "source" | "effectiveFrom" | "effectiveTo">,
  i18n: I18n,
  now: Date = new Date(),
): string {
  const from = friendlyDate(i18n, target.effectiveFrom, now);
  const until = target.effectiveTo ? friendlyDate(i18n, target.effectiveTo, now) : null;
  const span = until ? i18n._(msg`${from} to ${until}`) : i18n._(msg`since ${from}`);
  return target.source === "proposal" ? i18n._(msg`Accepted suggestion, ${span}`) : span;
}

/** A described item's amount, when its unit is one the diary logs in (g, ml, servings). */
export function draftAmount(
  item: Pick<FoodDraftCandidateWire, "quantity" | "unitText"> | null,
): { amount: number; unit: AmountUnit } | null {
  if (!item?.quantity || item.quantity <= 0) return null;
  const unit = item.unitText?.trim().toLowerCase();
  if (unit === "g" || unit === "gram" || unit === "grams")
    return { amount: item.quantity, unit: "g" };
  if (unit === "ml") return { amount: item.quantity, unit: "ml" };
  if (unit === "serving" || unit === "servings") return { amount: item.quantity, unit: "serving" };
  return null;
}
