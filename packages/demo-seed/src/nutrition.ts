import { sql, type Database } from "@openvalens/db";
import { nutritionFood } from "@openvalens/db/schema/nutrition";
import { and, eq } from "drizzle-orm";

import type { DemoApi, DemoActor } from "./api";
import type { DemoCalendar } from "./dates";
import { round, type Random } from "./random";

/**
 * Meal diary, plain water and nutrition targets (Issue #301), through the
 * same `nutritionDiary`, `plainWater` and `nutritionTargets` procedures the
 * apps call. Foods are the person's own custom foods with typical label
 * values per 100 g or per serving; nothing comes from an external catalog.
 * Times are on the person's wall clock (`calendar.timeZone`), and today stops
 * at the moment of seeding.
 */

/** Height for the nutrition safeguards; the same as on the DEXA scans (`care.ts`). */
export const DEMO_HEIGHT_CM = 168;

/** When each meal is eaten (wall-clock hour). */
const SLOT_HOURS = { breakfast: 8, lunch: 12.5, snack: 15.5, dinner: 19 } as const;

type Food = {
  name: string;
  basis: { amount: number; unit: "g" | "ml" | "serving" };
  nutrients: {
    energyKcal: number;
    proteinG: number;
    carbohydrateG: number;
    fatG: number;
    fiberG: number;
    totalSugarsG: number;
    sodiumMg: number;
  };
};

const FOODS = {
  oats: {
    name: "Porridge oats",
    basis: { amount: 100, unit: "g" },
    nutrients: {
      energyKcal: 375,
      proteinG: 11,
      carbohydrateG: 60,
      fatG: 8,
      fiberG: 9,
      totalSugarsG: 1,
      sodiumMg: 5,
    },
  },
  yogurt: {
    name: "Greek yogurt, plain",
    basis: { amount: 100, unit: "g" },
    nutrients: {
      energyKcal: 97,
      proteinG: 9,
      carbohydrateG: 4,
      fatG: 5,
      fiberG: 0,
      totalSugarsG: 4,
      sodiumMg: 35,
    },
  },
  berries: {
    name: "Mixed berries",
    basis: { amount: 100, unit: "g" },
    nutrients: {
      energyKcal: 45,
      proteinG: 1,
      carbohydrateG: 9,
      fatG: 0.3,
      fiberG: 4,
      totalSugarsG: 7,
      sodiumMg: 1,
    },
  },
  eggs: {
    name: "Eggs, scrambled",
    basis: { amount: 100, unit: "g" },
    nutrients: {
      energyKcal: 150,
      proteinG: 11,
      carbohydrateG: 1.5,
      fatG: 11,
      fiberG: 0,
      totalSugarsG: 1,
      sodiumMg: 300,
    },
  },
  toast: {
    name: "Wholemeal toast",
    basis: { amount: 1, unit: "serving" },
    nutrients: {
      energyKcal: 95,
      proteinG: 4,
      carbohydrateG: 16,
      fatG: 1.2,
      fiberG: 2.8,
      totalSugarsG: 1.5,
      sodiumMg: 170,
    },
  },
  chickenSalad: {
    name: "Chicken and quinoa salad",
    basis: { amount: 1, unit: "serving" },
    nutrients: {
      energyKcal: 520,
      proteinG: 38,
      carbohydrateG: 45,
      fatG: 19,
      fiberG: 8,
      totalSugarsG: 6,
      sodiumMg: 640,
    },
  },
  lentilSoup: {
    name: "Lentil soup",
    basis: { amount: 1, unit: "serving" },
    nutrients: {
      energyKcal: 310,
      proteinG: 18,
      carbohydrateG: 46,
      fatG: 6,
      fiberG: 12,
      totalSugarsG: 7,
      sodiumMg: 720,
    },
  },
  wrap: {
    name: "Hummus and falafel wrap",
    basis: { amount: 1, unit: "serving" },
    nutrients: {
      energyKcal: 480,
      proteinG: 16,
      carbohydrateG: 58,
      fatG: 20,
      fiberG: 10,
      totalSugarsG: 5,
      sodiumMg: 890,
    },
  },
  salmon: {
    name: "Baked salmon",
    basis: { amount: 100, unit: "g" },
    nutrients: {
      energyKcal: 206,
      proteinG: 22,
      carbohydrateG: 0,
      fatG: 13,
      fiberG: 0,
      totalSugarsG: 0,
      sodiumMg: 60,
    },
  },
  rice: {
    name: "Brown rice, cooked",
    basis: { amount: 100, unit: "g" },
    nutrients: {
      energyKcal: 123,
      proteinG: 2.7,
      carbohydrateG: 26,
      fatG: 1,
      fiberG: 1.6,
      totalSugarsG: 0.4,
      sodiumMg: 4,
    },
  },
  stirFry: {
    name: "Tofu vegetable stir-fry",
    basis: { amount: 1, unit: "serving" },
    nutrients: {
      energyKcal: 430,
      proteinG: 24,
      carbohydrateG: 38,
      fatG: 20,
      fiberG: 7,
      totalSugarsG: 9,
      sodiumMg: 980,
    },
  },
  pasta: {
    name: "Wholewheat pasta with tomato sauce",
    basis: { amount: 1, unit: "serving" },
    nutrients: {
      energyKcal: 540,
      proteinG: 20,
      carbohydrateG: 88,
      fatG: 11,
      fiberG: 11,
      totalSugarsG: 10,
      sodiumMg: 610,
    },
  },
  broccoli: {
    name: "Steamed broccoli",
    basis: { amount: 100, unit: "g" },
    nutrients: {
      energyKcal: 35,
      proteinG: 2.4,
      carbohydrateG: 7,
      fatG: 0.4,
      fiberG: 3.3,
      totalSugarsG: 1.4,
      sodiumMg: 41,
    },
  },
  apple: {
    name: "Apple",
    basis: { amount: 1, unit: "serving" },
    nutrients: {
      energyKcal: 80,
      proteinG: 0.4,
      carbohydrateG: 21,
      fatG: 0.2,
      fiberG: 3.6,
      totalSugarsG: 16,
      sodiumMg: 1,
    },
  },
  almonds: {
    name: "Almonds",
    basis: { amount: 100, unit: "g" },
    nutrients: {
      energyKcal: 579,
      proteinG: 21,
      carbohydrateG: 22,
      fatG: 50,
      fiberG: 12.5,
      totalSugarsG: 4.4,
      sodiumMg: 1,
    },
  },
  shake: {
    name: "Protein shake",
    basis: { amount: 1, unit: "serving" },
    nutrients: {
      energyKcal: 160,
      proteinG: 25,
      carbohydrateG: 8,
      fatG: 3,
      fiberG: 1,
      totalSugarsG: 3,
      sodiumMg: 150,
    },
  },
  chocolate: {
    name: "Dark chocolate",
    basis: { amount: 100, unit: "g" },
    nutrients: {
      energyKcal: 598,
      proteinG: 7.8,
      carbohydrateG: 46,
      fatG: 43,
      fiberG: 11,
      totalSugarsG: 24,
      sodiumMg: 20,
    },
  },
} satisfies Record<string, Food>;

type FoodKey = keyof typeof FOODS;
type Portion = [FoodKey, number];

const BREAKFASTS: Portion[][] = [
  [
    ["oats", 60],
    ["yogurt", 150],
    ["berries", 100],
  ],
  [
    ["eggs", 150],
    ["toast", 2],
  ],
  [
    ["yogurt", 200],
    ["berries", 120],
    ["almonds", 15],
  ],
];
const LUNCHES: Portion[][] = [
  [["chickenSalad", 1]],
  [
    ["lentilSoup", 1],
    ["toast", 1],
  ],
  [
    ["wrap", 1],
    ["apple", 1],
  ],
];
const DINNERS: Portion[][] = [
  [
    ["salmon", 150],
    ["rice", 180],
    ["broccoli", 120],
  ],
  [
    ["stirFry", 1],
    ["rice", 150],
  ],
  [
    ["pasta", 1],
    ["broccoli", 100],
  ],
];
const SNACKS: Portion[] = [
  ["apple", 1],
  ["almonds", 25],
  ["shake", 1],
  ["chocolate", 20],
];

const unitOf = (key: FoodKey) => (FOODS[key].basis.unit === "serving" ? "serving" : "g");

type Micronutrients = {
  calciumMg: number;
  ironMg: number;
  magnesiumMg: number;
  potassiumMg: number;
  vitaminCMg: number;
};

/**
 * A few typical label micronutrients per food basis, so the micronutrient
 * summary has rows. Every food (and the coffee) has all five, so a day's
 * totals are complete rather than "at least".
 */
const MICRONUTRIENTS: Record<FoodKey | "coffee", Micronutrients> = {
  oats: { calciumMg: 52, ironMg: 4.3, magnesiumMg: 138, potassiumMg: 362, vitaminCMg: 0 },
  yogurt: { calciumMg: 110, ironMg: 0.1, magnesiumMg: 11, potassiumMg: 141, vitaminCMg: 0 },
  berries: { calciumMg: 15, ironMg: 0.5, magnesiumMg: 15, potassiumMg: 150, vitaminCMg: 30 },
  eggs: { calciumMg: 66, ironMg: 1.3, magnesiumMg: 12, potassiumMg: 132, vitaminCMg: 0 },
  toast: { calciumMg: 40, ironMg: 0.9, magnesiumMg: 25, potassiumMg: 90, vitaminCMg: 0 },
  chickenSalad: { calciumMg: 80, ironMg: 3.5, magnesiumMg: 110, potassiumMg: 700, vitaminCMg: 20 },
  lentilSoup: { calciumMg: 50, ironMg: 4.5, magnesiumMg: 60, potassiumMg: 600, vitaminCMg: 5 },
  wrap: { calciumMg: 120, ironMg: 4, magnesiumMg: 70, potassiumMg: 450, vitaminCMg: 6 },
  salmon: { calciumMg: 15, ironMg: 0.5, magnesiumMg: 30, potassiumMg: 380, vitaminCMg: 0 },
  rice: { calciumMg: 10, ironMg: 0.4, magnesiumMg: 39, potassiumMg: 43, vitaminCMg: 0 },
  stirFry: { calciumMg: 350, ironMg: 4, magnesiumMg: 90, potassiumMg: 600, vitaminCMg: 45 },
  pasta: { calciumMg: 60, ironMg: 3.5, magnesiumMg: 110, potassiumMg: 550, vitaminCMg: 15 },
  broccoli: { calciumMg: 40, ironMg: 0.7, magnesiumMg: 21, potassiumMg: 293, vitaminCMg: 65 },
  apple: { calciumMg: 11, ironMg: 0.2, magnesiumMg: 9, potassiumMg: 195, vitaminCMg: 8 },
  almonds: { calciumMg: 269, ironMg: 3.7, magnesiumMg: 270, potassiumMg: 733, vitaminCMg: 0 },
  shake: { calciumMg: 150, ironMg: 1, magnesiumMg: 40, potassiumMg: 200, vitaminCMg: 0 },
  chocolate: { calciumMg: 73, ironMg: 11.9, magnesiumMg: 228, potassiumMg: 715, vitaminCMg: 0 },
  coffee: { calciumMg: 5, ironMg: 0.05, magnesiumMg: 7, potassiumMg: 115, vitaminCMg: 0 },
};

/**
 * `createFood` takes the core nutrients only (micronutrients come from
 * catalog foods), so the values are added to the new custom food the way a
 * catalog import stores them, before anything is logged from it.
 */
async function addMicronutrients(
  db: Database,
  actor: DemoActor,
  foodId: number,
  key: keyof typeof MICRONUTRIENTS,
): Promise<void> {
  await db
    .update(nutritionFood)
    .set(MICRONUTRIENTS[key])
    .where(
      and(eq(nutritionFood.organizationId, actor.organizationId), eq(nutritionFood.id, foodId)),
    );
}

export async function seedNutrition(
  db: Database,
  api: DemoApi,
  actor: DemoActor,
  calendar: DemoCalendar,
  random: Random,
): Promise<void> {
  const foodIds = new Map<FoodKey, number>();
  for (const [key, food] of Object.entries(FOODS) as [FoodKey, Food][]) {
    const created = await api.call<{ ref: { foodId: number } }>(
      "nutritionDiary/createFood",
      {
        clientMutationId: `demo-food-${key}`,
        name: food.name,
        nutrientBasisAmount: food.basis.amount,
        nutrientBasisUnit: food.basis.unit,
        ...(food.basis.unit === "serving" ? { servingLabel: "1 portion" } : {}),
        nutrients: food.nutrients,
      },
      actor,
    );
    await addMicronutrients(db, actor, created.ref.foodId, key);
    foodIds.set(key, created.ref.foodId);
  }

  const settings = await api.call<{ settings: { revision: number } }>(
    "nutritionTargets/get",
    { localDate: calendar.today },
    actor,
  );
  await api.call(
    "nutritionTargets/updateSettings",
    {
      expectedRevision: settings.settings.revision,
      streaksEnabled: true,
      micronutrientsEnabled: true,
      heightCm: DEMO_HEIGHT_CM,
    },
    actor,
  );
  const targetsFrom = calendar.day(89);
  for (const target of [
    { nutrient: "energyKcal", minAmount: 1700, maxAmount: 2100 },
    { nutrient: "proteinG", minAmount: 100 },
    { nutrient: "fiberG", minAmount: 25 },
    { nutrient: "sodiumMg", maxAmount: 2300 },
  ]) {
    await api.call("nutritionTargets/setTarget", { ...target, effectiveFrom: targetsFrom }, actor);
  }

  await api.call(
    "plainWater/updatePreferences",
    { enabled: true, personalGoal: 2, personalGoalUnit: "l" },
    actor,
  );

  for (const offset of calendar.offsets()) {
    const localDate = calendar.day(offset);
    // A few unlogged days earlier on; the recent weeks are logged every day.
    if (offset > 21 && random.chance(0.12)) continue;
    const meals: ["breakfast" | "lunch" | "dinner" | "snack", Portion[]][] = [
      ["breakfast", random.pick(BREAKFASTS)],
      ["lunch", random.pick(LUNCHES)],
      ["dinner", random.pick(DINNERS)],
      ["snack", [random.pick(SNACKS)]],
    ];
    let index = 0;
    for (const [slot, portions] of meals) {
      // Today's meals stop at the moment of seeding.
      const eaten = calendar.past(calendar.at(offset, SLOT_HOURS[slot]));
      for (const [key, amount] of portions) {
        const scaled = unitOf(key) === "g" ? round(amount * random.between(0.9, 1.1)) : amount;
        index += 1;
        if (!eaten) continue;
        await api.call(
          "nutritionDiary/logEntry",
          {
            clientMutationId: `demo-entry-${localDate}-${index - 1}`,
            localDate,
            timeZone: calendar.timeZone,
            slot,
            food: { kind: "custom", foodId: foodIds.get(key)! },
            amount: scaled,
            unit: unitOf(key),
            method: "manual",
          },
          actor,
        );
      }
    }
    // Today is still in progress; earlier days were marked complete.
    if (offset > 0) {
      await api.call("nutritionDiary/setDayStatus", { localDate, complete: true }, actor);
    }

    const glasses = offset === 0 ? 4 : random.int(5, 9);
    for (let glass = 0; glass < glasses; glass += 1) {
      const quantity = random.pick([250, 300, 330, 500]);
      const observedAt = calendar.at(offset, 8 + glass * 1.7);
      if (!calendar.past(observedAt)) continue;
      await api.call(
        "plainWater/add",
        {
          quantity,
          unit: "ml",
          observedAt: observedAt.toISOString(),
          timeZone: calendar.timeZone,
          clientMutationId: `demo-water-${localDate}-${glass}`,
        },
        actor,
      );
    }
  }
}

type DiaryFoods = {
  recents: { ref: { kind: string; snapshotId?: number }; name: string }[];
  customFoods: { ref: { kind: string; foodId?: number }; name: string }[];
};

/** Saved meals: the usual breakfast and dinner, from the custom foods above. */
const MEAL_TEMPLATES: { name: string; ingredients: Portion[] }[] = [
  {
    name: "Usual breakfast",
    ingredients: [
      ["oats", 60],
      ["yogurt", 150],
      ["berries", 100],
    ],
  },
  {
    name: "Salmon, rice and broccoli",
    ingredients: [
      ["salmon", 150],
      ["rice", 180],
      ["broccoli", 120],
    ],
  },
];
const FAVOURITES: FoodKey[] = ["oats", "yogurt", "salmon", "almonds"];

/**
 * What `seedNutrition` leaves out, kept apart so its draws stay as they were:
 * favourite foods, two saved meals (`nutritionTemplates`), and a morning
 * coffee with the caffeine totals turned on, so the drinks summary and the
 * sleep screen's last-caffeine note have something to show. Coffee is logged
 * on the last three weeks, which are logged every day.
 */
export async function seedNutritionExtras(
  db: Database,
  api: DemoApi,
  actor: DemoActor,
  calendar: DemoCalendar,
  random: Random,
): Promise<void> {
  const foods = await api.call<DiaryFoods>("nutritionDiary/listFoods", {}, actor);
  const customId = (key: FoodKey) => {
    const food = foods.customFoods.find((row) => row.name === FOODS[key].name);
    if (food?.ref.kind !== "custom" || !food.ref.foodId)
      throw new Error(`Demo seed: no custom food for ${key}.`);
    return food.ref.foodId;
  };
  for (const key of FAVOURITES) {
    const recent = foods.recents.find((row) => row.name === FOODS[key].name);
    if (recent?.ref.kind !== "snapshot" || !recent.ref.snapshotId) continue;
    await api.call(
      "nutritionDiary/setFavorite",
      { snapshotId: recent.ref.snapshotId, favorite: true },
      actor,
    );
  }
  for (const [index, template] of MEAL_TEMPLATES.entries()) {
    await api.call(
      "nutritionTemplates/create",
      {
        clientMutationId: `demo-template-${index}`,
        content: {
          kind: "meal",
          name: template.name,
          ingredients: template.ingredients.map(([key, amount]) => ({
            food: { kind: "custom", foodId: customId(key) },
            amount,
            unit: unitOf(key),
          })),
        },
      },
      actor,
    );
  }

  const settings = await api.call<{ settings: { revision: number } }>(
    "nutritionTargets/get",
    { localDate: calendar.today },
    actor,
  );
  await api.call(
    "nutritionTargets/updateSettings",
    { expectedRevision: settings.settings.revision, caffeineTotalsEnabled: true },
    actor,
  );
  const coffee = await api.call<{ ref: { foodId: number } }>(
    "nutritionDiary/createFood",
    {
      clientMutationId: "demo-food-coffee",
      name: "Coffee, black",
      nutrientBasisAmount: 1,
      nutrientBasisUnit: "serving",
      servingLabel: "1 mug",
      nutrients: { energyKcal: 2, proteinG: 0.3, carbohydrateG: 0, fatG: 0, caffeineMg: 95 },
    },
    actor,
  );
  await addMicronutrients(db, actor, coffee.ref.foodId, "coffee");
  for (let offset = 21; offset >= 0; offset -= 1) {
    const localDate = calendar.day(offset);
    // A second, early-afternoon cup some days (not today, which is still going).
    const second = random.chance(0.35) && offset > 0;
    const cups = second ? [7.75, 14] : [7.75];
    for (const [index, hour] of cups.entries()) {
      const consumedAt = calendar.at(offset, hour + random.between(0, 0.25));
      if (!calendar.past(consumedAt)) continue;
      await api.call(
        "nutritionDiary/logEntry",
        {
          clientMutationId: `demo-coffee-${localDate}-${index}`,
          localDate,
          timeZone: calendar.timeZone,
          slot: index === 0 ? "breakfast" : "snack",
          food: { kind: "custom", foodId: coffee.ref.foodId },
          amount: 1,
          unit: "serving",
          method: "manual",
          consumedAt: consumedAt.toISOString(),
        },
        actor,
      );
    }
  }
}

/**
 * Makes every diary entry look logged when it was eaten. The seed writes 90
 * days at once, so each entry's `created_at` is the moment of seeding, and the
 * logging streak (which counts a day only when its first entry was created by
 * the next day, `computeLoggingStreak`) would see only today and yesterday.
 * This moves each entry's and meal's write time to the entry's own time on its
 * day: when it was drunk (`consumed_at`), or its meal's usual hour
 * (`SLOT_HOURS`), never later than the moment of seeding.
 */
export async function backdateDiaryEntries(
  db: Database,
  actor: DemoActor,
  calendar: DemoCalendar,
): Promise<void> {
  const until = calendar.until.toISOString();
  const slotHour = sql.join(
    Object.entries(SLOT_HOURS).map(([slot, hour]) => sql`when ${slot} then ${hour}::float8`),
    sql` `,
  );
  await db.execute(sql`
    with logged as (
      select e."id", least(coalesce(e."consumed_at",
        (m."local_date"::date + make_interval(secs => (case m."slot" ${slotHour} else 12 end) * 3600))
          at time zone m."time_zone"), ${until}::timestamptz) as "at"
      from "nutrition_meal_entry" e
      join "nutrition_meal" m on m."organization_id" = e."organization_id" and m."id" = e."meal_id"
      where e."organization_id" = ${actor.organizationId} and e."user_id" = ${actor.userId}
    )
    update "nutrition_meal_entry" e set "created_at" = logged."at", "updated_at" = logged."at"
    from logged where e."organization_id" = ${actor.organizationId} and e."id" = logged."id"
  `);
  await db.execute(sql`
    update "nutrition_meal" m set "created_at" = first."at", "updated_at" = first."at"
    from (
      select "meal_id", min("created_at") as "at" from "nutrition_meal_entry"
      where "organization_id" = ${actor.organizationId} and "user_id" = ${actor.userId}
      group by "meal_id"
    ) first
    where m."organization_id" = ${actor.organizationId} and m."id" = first."meal_id"
  `);
}
