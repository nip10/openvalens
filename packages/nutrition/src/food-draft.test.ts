import { describe, expect, test } from "bun:test";

import {
  candidateFromParts,
  FOOD_DRAFT_LIMITS,
  foodDraftFlags,
  parseFoodTranscript,
} from "./food-draft";

const shape = (transcript: string) => {
  const result = parseFoodTranscript(transcript);
  return result.candidates.map(({ foodText, quantity, unitText, flags }) => ({
    foodText,
    quantity,
    unitText,
    flags,
  }));
};

describe("parseFoodTranscript", () => {
  test("splits a spoken meal into candidates with stated quantities and units", () => {
    expect(
      shape("Two eggs, a slice of toast and 200g of greek yogurt with half a cup of berries"),
    ).toEqual([
      { foodText: "eggs", quantity: 2, unitText: null, flags: ["no_unit"] },
      { foodText: "toast", quantity: 1, unitText: "slice", flags: [] },
      { foodText: "greek yogurt", quantity: 200, unitText: "g", flags: [] },
      { foodText: "berries", quantity: 0.5, unitText: "cup", flags: [] },
    ]);
  });

  test("flags missing and vague quantities instead of guessing", () => {
    expect(shape("coffee; some almonds; a handful of grapes")).toEqual([
      { foodText: "coffee", quantity: null, unitText: null, flags: ["no_quantity", "no_unit"] },
      { foodText: "almonds", quantity: null, unitText: null, flags: ["vague_quantity", "no_unit"] },
      { foodText: "grapes", quantity: null, unitText: "handful", flags: ["vague_quantity"] },
    ]);
  });

  test("keeps the spoken words for review and handles fractions and decimals", () => {
    const result = parseFoodTranscript("1/2 avocado plus 1.5 tbsp olive oil.");
    expect(result.status).toBe("ready");
    expect(
      result.candidates.map((c) => [c.sourceText, c.quantity, c.unitText, c.foodText]),
    ).toEqual([
      ["1/2 avocado", 0.5, null, "avocado"],
      ["1.5 tbsp olive oil.", 1.5, "tbsp", "olive oil"],
    ]);
  });

  test("never produces nutrient values", () => {
    const result = parseFoodTranscript("200 g chicken breast and 100 g rice");
    for (const candidate of result.candidates)
      expect(Object.keys(candidate).sort()).toEqual(
        ["flags", "foodText", "id", "quantity", "quantityText", "sourceText", "unitText"].sort(),
      );
  });

  test("fails safely on empty, unrecognized and oversized input", () => {
    expect(parseFoodTranscript("   ")).toEqual({ status: "empty", candidates: [] });
    expect(parseFoodTranscript("2, 3 and 4 ...")).toEqual({
      status: "unrecognized",
      candidates: [],
    });
    expect(parseFoodTranscript("a".repeat(FOOD_DRAFT_LIMITS.maxTranscriptChars + 1))).toEqual({
      status: "too_long",
      candidates: [],
    });
    expect(parseFoodTranscript(undefined as unknown as string).status).toBe("empty");
  });

  test("caps the number of candidates", () => {
    const many = Array.from({ length: 30 }, (_, i) => `apple ${i}`).join(", ");
    expect(parseFoodTranscript(many).candidates).toHaveLength(FOOD_DRAFT_LIMITS.maxCandidates);
  });
});

describe("candidateFromParts", () => {
  test("flags an item the provider was unsure of, ahead of the quantity flags", () => {
    expect(
      candidateFromParts({ food: "curry?", quantity: null, unit: "bowl", unsure: true }, 0)?.flags,
    ).toEqual(["unsure_food", "no_quantity"]);
    expect(candidateFromParts({ food: "apple", quantity: "1", unit: null }, 1)?.flags).toEqual([
      "no_unit",
    ]);
  });
});

describe("foodDraftFlags", () => {
  test("clears flags once the member fills quantity and unit", () => {
    expect(foodDraftFlags({ quantity: null, unitText: null })).toEqual(["no_quantity", "no_unit"]);
    expect(foodDraftFlags({ quantity: 2, unitText: "slice" })).toEqual([]);
  });
});
