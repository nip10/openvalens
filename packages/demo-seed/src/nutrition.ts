import type { DemoApi, DemoActor } from "./api";
import type { DemoCalendar } from "./dates";
import { round, type Random } from "./random";

/**
 * Meal diary, plain water and nutrition targets (Issue #301), through the
 * same `nutritionDiary`, `plainWater` and `nutritionTargets` procedures the
 * apps call. Foods are the person's own custom foods with typical label
 * values per 100 g or per serving; nothing comes from an external catalog.
 */

const TIMEZONE = "Europe/London";

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

export async function seedNutrition(
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
    foodIds.set(key, created.ref.foodId);
  }

  const settings = await api.call<{ settings: { revision: number } }>(
    "nutritionTargets/get",
    { localDate: calendar.today },
    actor,
  );
  await api.call(
    "nutritionTargets/updateSettings",
    { expectedRevision: settings.settings.revision, streaksEnabled: true },
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
      for (const [key, amount] of portions) {
        const scaled = unitOf(key) === "g" ? round(amount * random.between(0.9, 1.1)) : amount;
        await api.call(
          "nutritionDiary/logEntry",
          {
            clientMutationId: `demo-entry-${localDate}-${index}`,
            localDate,
            timeZone: TIMEZONE,
            slot,
            food: { kind: "custom", foodId: foodIds.get(key)! },
            amount: scaled,
            unit: unitOf(key),
            method: "manual",
          },
          actor,
        );
        index += 1;
      }
    }
    // Today is still in progress; earlier days were marked complete.
    if (offset > 0) {
      await api.call("nutritionDiary/setDayStatus", { localDate, complete: true }, actor);
    }

    const glasses = offset === 0 ? 4 : random.int(5, 9);
    for (let glass = 0; glass < glasses; glass += 1) {
      await api.call(
        "plainWater/add",
        {
          quantity: random.pick([250, 300, 330, 500]),
          unit: "ml",
          observedAt: calendar.at(offset, 8 + glass * 1.7).toISOString(),
          timeZone: TIMEZONE,
          clientMutationId: `demo-water-${localDate}-${glass}`,
        },
        actor,
      );
    }
  }
}
