import type { I18n } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import type {
  CustomFood,
  CustomFoodListItem,
  CustomFoodUsage,
} from "@openvalens/api/contracts/nutrition-custom-foods";
import type { FoodDraftCandidateWire } from "@openvalens/api/contracts/nutrition-food-drafts";
import { NUTRIENT_KEYS, type AmountUnit } from "@openvalens/api/contracts/nutrition-diary";
import type { NutritionTargetWire } from "@openvalens/api/contracts/nutrition-targets";
import { formatAmount } from "@openvalens/api/presenters/nutrition-diary";

import { friendlyDate, localIsoDay } from "@/utils/friendly";

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

/** How My foods orders its cards (foods#0): most used first by default. */
export const FOOD_SORTS = ["used", "name", "added"] as const;
export type FoodSort = (typeof FOOD_SORTS)[number];

/**
 * The food list in the chosen order. "used": most diary entries first, then
 * the latest logged, then by name. "name": A to Z in the reader's locale.
 * "added": newest first. A copy; the input is untouched.
 */
export function sortFoods<
  T extends Pick<CustomFoodListItem, "id" | "name" | "createdAt" | "usage">,
>(foods: readonly T[], sort: FoodSort, locale: string): T[] {
  const byName = (a: T, b: T) =>
    a.name.localeCompare(b.name, locale, { sensitivity: "base" }) || a.id - b.id;
  const latest = (food: T) => food.usage.lastLoggedOn ?? "";
  return [...foods].sort((a, b) => {
    if (sort === "added")
      return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : byName(a, b);
    if (sort === "used") {
      if (a.usage.logCount !== b.usage.logCount) return b.usage.logCount - a.usage.logCount;
      if (latest(a) !== latest(b)) return latest(a) < latest(b) ? 1 : -1;
    }
    return byName(a, b);
  });
}

/** Whole calendar days from one YYYY-MM-DD to another. */
function daysBetween(from: string, to: string): number {
  const day = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((day(to) - day(from)) / 86_400_000);
}

/**
 * "Last logged 2 days ago · 31 times" on a food card (foods#5), from the
 * member's own diary; null for a food never logged.
 */
export function foodUsageLine(
  usage: CustomFoodUsage,
  i18n: I18n,
  now: Date = new Date(),
): string | null {
  if (!usage.lastLoggedOn || usage.logCount < 1) return null;
  const days = daysBetween(usage.lastLoggedOn, localIsoDay(now));
  const on = friendlyDate(i18n, usage.lastLoggedOn, now);
  const when =
    days <= 0
      ? i18n._(msg`Last logged today`)
      : days === 1
        ? i18n._(msg`Last logged yesterday`)
        : days < 7
          ? i18n._(msg`Last logged ${plural(days, { one: "# day ago", other: "# days ago" })}`)
          : i18n._(msg`Last logged ${on}`);
  const count = usage.logCount;
  // How many times the food was logged in the diary.
  const times = i18n._(msg`${plural(count, { one: "once", other: "# times" })}`);
  return `${when} · ${times}`;
}
