import { describe, expect, test } from "bun:test";

import { englishI18n, inEnglish } from "@openvalens/i18n/testing";

import type { CustomFood } from "../contracts/nutrition-custom-foods";
import { createCustomFoodInput, updateCustomFoodInput } from "../contracts/nutrition-custom-foods";
import {
  CUSTOM_FOOD_COPY,
  EMPTY_CUSTOM_FOOD_FIELDS,
  describeBasis,
  describeCoverage,
  fieldsFromCustomFood,
  nutrientFieldLabel,
  parseCustomFood,
} from "./custom-foods";

const food: CustomFood = {
  id: 7,
  sourceQualifiedId: "custom:7",
  provenance: "user_entered",
  name: "Synthetic rye bread",
  brand: null,
  barcode: "4006381333931",
  basis: {
    nutrientBasisAmount: 100,
    nutrientBasisUnit: "g",
    servingSizeAmount: 40,
    servingSizeUnit: "g",
    servingLabel: "1 slice",
  },
  nutrientsPerBasis: {
    energyKcal: 250,
    energyKj: null,
    proteinG: 8,
    carbohydrateG: null,
    fatG: null,
    saturatedFatG: null,
    fiberG: null,
    totalSugarsG: null,
    addedSugarsG: 0,
    freeSugarsG: null,
    sodiumMg: null,
    saltG: null,
    caffeineMg: null,
    alcoholG: null,
  },
  revision: 2,
  archived: false,
  archivedAt: null,
  createdAt: "2026-10-12T08:00:00.000Z",
  updatedAt: "2026-10-12T08:00:00.000Z",
};

describe("custom food form", () => {
  test("round-trips a saved food: unknown stays blank, zero stays zero", () => {
    const fields = fieldsFromCustomFood(food);
    expect(fields.nutrients.addedSugarsG).toBe("0");
    expect(fields.nutrients.fiberG).toBeUndefined();
    expect(fields.brand).toBe("");
    const parsed = parseCustomFood(fields);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.food).toMatchObject({
      name: "Synthetic rye bread",
      brand: null,
      barcode: "4006381333931",
      nutrientBasisAmount: 100,
      nutrientBasisUnit: "g",
      servingSizeAmount: 40,
      servingSizeUnit: "g",
      servingLabel: "1 slice",
    });
    expect(parsed.food.nutrients).toMatchObject({ energyKcal: 250, addedSugarsG: 0, fiberG: null });
    // The parsed form is a valid wire payload for both create and update.
    expect(
      createCustomFoodInput.safeParse({ clientMutationId: "c-1", food: parsed.food }).success,
    ).toBe(true);
    expect(
      updateCustomFoodInput.safeParse({ foodId: 7, expectedRevision: 2, food: parsed.food })
        .success,
    ).toBe(true);
  });

  test("caffeine and alcohol are optional fields with a decimal comma (#443)", () => {
    const base = {
      ...EMPTY_CUSTOM_FOOD_FIELDS,
      name: "Synthetic cold brew",
      basisUnit: "ml" as const,
    };
    const parsed = parseCustomFood({ ...base, nutrients: { caffeineMg: "48,5", alcoholG: "0" } });
    expect(parsed).toMatchObject({
      ok: true,
      food: { nutrients: { caffeineMg: 48.5, alcoholG: 0, energyKcal: null } },
    });
    // Blank stays unknown and is sent explicitly, so an edit can clear it.
    expect(parseCustomFood(base)).toMatchObject({
      ok: true,
      food: { nutrients: { caffeineMg: null, alcoholG: null } },
    });
    expect(parseCustomFood({ ...base, nutrients: { alcoholG: "-1" } })).toMatchObject({
      ok: false,
    });
    expect(inEnglish(nutrientFieldLabel("caffeineMg"))).toBe("Caffeine (mg, optional)");
    expect(inEnglish(nutrientFieldLabel("alcoholG"))).toBe("Alcohol (g, optional)");
    // A food cached by an app from before #443 lacks both keys: they read as unknown.
    const { caffeineMg: _c, alcoholG: _a, ...older } = food.nutrientsPerBasis;
    const cached = { ...food, nutrientsPerBasis: older } as unknown as CustomFood;
    expect(fieldsFromCustomFood(cached).nutrients.caffeineMg).toBeUndefined();
    expect(parseCustomFood(fieldsFromCustomFood(cached)).ok).toBe(true);
    expect(inEnglish(describeCoverage(cached))).toBe("3 of 14 values entered");
  });

  test("blank optional fields are sent as null so an edit can clear them", () => {
    const parsed = parseCustomFood({ ...EMPTY_CUSTOM_FOOD_FIELDS, name: "Plain" });
    expect(parsed).toMatchObject({
      ok: true,
      food: { brand: null, barcode: null, servingSizeAmount: null, servingSizeUnit: null },
    });
  });

  test("rejects invalid portions and values with a plain message", () => {
    const base = { ...EMPTY_CUSTOM_FOOD_FIELDS, name: "Food" };
    expect(parseCustomFood({ ...base, name: " " }).ok).toBe(false);
    expect(parseCustomFood({ ...base, basisAmount: "0" }).ok).toBe(false);
    expect(parseCustomFood({ ...base, servingSizeAmount: "-3" }).ok).toBe(false);
    expect(parseCustomFood({ ...base, nutrients: { proteinG: "-1" } }).ok).toBe(false);
    expect(parseCustomFood({ ...base, barcode: "12ab" }).ok).toBe(false);
    expect(parseCustomFood({ ...base, name: "x".repeat(201) }).ok).toBe(false);
  });

  test("a decimal comma is a decimal in every amount (#448)", () => {
    const base = { ...EMPTY_CUSTOM_FOOD_FIELDS, name: "Food" };
    for (const raw of ["82,4", "82.4", " 82,4 "])
      expect(
        parseCustomFood({
          ...base,
          basisAmount: raw,
          servingSizeAmount: raw,
          nutrients: { proteinG: raw },
        }),
      ).toMatchObject({
        ok: true,
        food: { nutrientBasisAmount: 82.4, servingSizeAmount: 82.4, nutrients: { proteinG: 82.4 } },
      });
    expect(parseCustomFood({ ...base, servingSizeAmount: "1,5" })).toMatchObject({
      ok: true,
      food: { servingSizeAmount: 1.5 },
    });
    for (const raw of ["1.234,5", "abc"]) {
      expect(parseCustomFood({ ...base, servingSizeAmount: raw }).ok).toBe(false);
      expect(parseCustomFood({ ...base, basisAmount: raw }).ok).toBe(false);
    }
  });

  test("summaries state the basis and how much was entered", () => {
    expect(describeBasis(food.basis, englishI18n)).toBe("Values per 100 g (1 slice = 40 g)");
    expect(
      describeBasis({ ...food.basis, servingSizeAmount: null, servingSizeUnit: null }, englishI18n),
    ).toBe("Values per 100 g (serving: 1 slice)");
    expect(inEnglish(describeCoverage(food))).toBe("3 of 14 values entered");
  });

  test("copy is neutral and states privacy", () => {
    const BANNED =
      /\b(good|bad|healthy|unhealthy|junk|clean|cheat|guilt\w*|sin\w*|naughty|over|under|exceed\w*|too much|missed|streak\w*|fail\w*|warning|danger\w*|violat\w*|budget|allowance|earn\w*)\b/i;
    for (const text of Object.values(CUSTOM_FOOD_COPY)) expect(inEnglish(text)).not.toMatch(BANNED);
    expect(inEnglish(CUSTOM_FOOD_COPY.privacy)).toMatch(/private to you/);
  });
});
