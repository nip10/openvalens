/**
 * Held-out evaluation set for the local food-draft parser (Issue #73).
 * Utterances were written as people say them and the expected items edited
 * by hand. Run `bun packages/nutrition/src/food-draft.eval.ts` to print the
 * measured outcome; docs/food-drafts.md records the latest run. This is a
 * measurement, not an accuracy promise.
 */
import { parseFoodTranscript } from "./food-draft";

type Expected = { food: string; quantity: number | null; unit: string | null };

export const FOOD_DRAFT_EVAL: { utterance: string; expected: Expected[] }[] = [
  {
    utterance: "two scrambled eggs and a slice of sourdough",
    expected: [
      { food: "scrambled eggs", quantity: 2, unit: null },
      { food: "sourdough", quantity: 1, unit: "slice" },
    ],
  },
  {
    utterance: "a bowl of porridge with a banana",
    expected: [
      { food: "porridge", quantity: 1, unit: "bowl" },
      { food: "banana", quantity: 1, unit: null },
    ],
  },
  {
    utterance: "150 grams of chicken breast, 200 g rice and some broccoli",
    expected: [
      { food: "chicken breast", quantity: 150, unit: "g" },
      { food: "rice", quantity: 200, unit: "g" },
      { food: "broccoli", quantity: null, unit: null },
    ],
  },
  { utterance: "a flat white", expected: [{ food: "flat white", quantity: 1, unit: null }] },
  {
    utterance: "half an avocado on toast",
    expected: [{ food: "avocado on toast", quantity: 0.5, unit: null }],
  },
  {
    utterance: "a glass of orange juice and two croissants",
    expected: [
      { food: "orange juice", quantity: 1, unit: "glass" },
      { food: "croissants", quantity: 2, unit: null },
    ],
  },
  {
    utterance: "3 tbsp peanut butter",
    expected: [{ food: "peanut butter", quantity: 3, unit: "tbsp" }],
  },
  {
    utterance: "a handful of almonds then an apple",
    expected: [
      { food: "almonds", quantity: null, unit: "handful" },
      { food: "apple", quantity: 1, unit: null },
    ],
  },
  {
    utterance: "chicken caesar salad",
    expected: [{ food: "chicken caesar salad", quantity: null, unit: null }],
  },
  {
    utterance: "one can of tuna plus a cup of pasta",
    expected: [
      { food: "tuna", quantity: 1, unit: "can" },
      { food: "pasta", quantity: 1, unit: "cup" },
    ],
  },
  {
    utterance: "250ml semi skimmed milk",
    expected: [{ food: "semi skimmed milk", quantity: 250, unit: "ml" }],
  },
  {
    utterance: "pizza, about three slices",
    expected: [{ food: "pizza", quantity: 3, unit: "slice" }],
  },
  {
    utterance: "fish and chips",
    expected: [{ food: "fish and chips", quantity: null, unit: null }],
  },
  {
    utterance: "a couple of biscuits with tea",
    expected: [
      { food: "biscuits", quantity: 2, unit: null },
      { food: "tea", quantity: null, unit: null },
    ],
  },
  {
    utterance: "2 slices of ham and a yoghurt",
    expected: [
      { food: "ham", quantity: 2, unit: "slice" },
      { food: "yoghurt", quantity: 1, unit: null },
    ],
  },
];

export function evaluateFoodDrafts() {
  let items = 0;
  let exact = 0;
  let utterancesExact = 0;
  for (const { utterance, expected } of FOOD_DRAFT_EVAL) {
    const got = parseFoodTranscript(utterance).candidates;
    items += expected.length;
    let all = got.length === expected.length;
    expected.forEach((want, index) => {
      const candidate = got[index];
      const match =
        candidate?.foodText === want.food &&
        candidate.quantity === want.quantity &&
        candidate.unitText === want.unit;
      if (match) exact++;
      else all = false;
    });
    if (all) utterancesExact++;
  }
  return { utterances: FOOD_DRAFT_EVAL.length, utterancesExact, items, itemsExact: exact };
}

if (import.meta.main) console.log(evaluateFoodDrafts());
