import { MEAL_SLOTS, type MealSlot } from "@openvalens/api/contracts/nutrition-diary";
import { localDateIn, mealSlotForLocalTime } from "@openvalens/api/presenters/nutrition-diary";

/** What Add food needs from a meal draft a connected AI app made (#439, M2c). */
export type AiAppFoodDraftTarget = {
  id: string;
  payload: { eatenAt: string; meal: string | null };
};

/**
 * Add food for one meal draft: its items are logged on the day and at the
 * time the member told the app, in the meal the app named (or the one that
 * time falls in), not on the diary day that happens to be open.
 */
export function aiFoodDraftHref(draft: AiAppFoodDraftTarget, timeZone: string) {
  const eatenAt = new Date(draft.payload.eatenAt);
  const valid = !Number.isNaN(eatenAt.getTime());
  const meal = MEAL_SLOTS.includes(draft.payload.meal as MealSlot)
    ? (draft.payload.meal as MealSlot)
    : mealSlotForLocalTime(valid ? eatenAt : new Date());
  const params: Record<string, string> = {
    mode: "app",
    aiDraft: draft.id,
    timeZone,
    meal,
    localDate: localDateIn(timeZone, valid ? eatenAt : new Date()),
  };
  if (valid) params.at = eatenAt.toISOString();
  return { pathname: "/log-food" as const, params };
}
