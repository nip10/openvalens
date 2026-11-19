import { sql, type Database } from "@openvalens/db";
import type { NutritionScope } from "@openvalens/nutrition";
import { readNutritionTargetSettings } from "@openvalens/nutrition/targets";

import type { FoodDraftMealExample } from "./contracts/nutrition-food-drafts";

/** Explicitly scoped to the member's own non-deleted diary entries; no AI or writes. */
export async function recentMealExamples(
  db: Database,
  scope: NutritionScope,
): Promise<FoodDraftMealExample[]> {
  const settings = await readNutritionTargetSettings(db, scope);
  const rows = await db.execute<{
    meal_id: number;
    name: string;
    amount: number;
    unit: "g" | "ml" | "serving";
  }>(sql`
    with recent as (
      select m.id, m.local_date from nutrition_meal m
      where m.organization_id = ${scope.organizationId} and m.user_id = ${scope.userId}
        and exists (select 1 from nutrition_meal_entry e where e.organization_id = m.organization_id
          and e.user_id = m.user_id and e.meal_id = m.id and e.deleted_at is null)
      order by m.local_date desc, m.id desc limit 12
    )
    select r.id as meal_id, s.name, e.amount, e.unit from recent r
    join nutrition_meal_entry e on e.meal_id = r.id
      and e.organization_id = ${scope.organizationId} and e.user_id = ${scope.userId} and e.deleted_at is null
    join nutrition_food_snapshot s on s.id = e.snapshot_id and s.organization_id = e.organization_id
    order by r.local_date desc, r.id desc, e.id asc
  `);
  const meals = new Map<number, FoodDraftMealExample>();
  for (const row of rows.rows) {
    const meal = meals.get(row.meal_id) ?? { id: row.meal_id, items: [] };
    if (meal.items.length < 4)
      meal.items.push({
        name: row.name.slice(0, 200),
        amount: settings.hideNumbers ? null : row.amount,
        unit: row.unit,
      });
    meals.set(row.meal_id, meal);
  }
  const seen = new Set<string>();
  return [...meals.values()]
    .filter((meal) => {
      const key = JSON.stringify(meal.items);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}
