import { describe, expect, test } from "bun:test";

import { parseFdcFood } from "./fdc";
import { readJsonArrayItems, readJsonLines } from "./jsonl";
import { parseOffProduct } from "./off";

// Synthetic fixtures shaped like the upstream formats; no real records.

const fdcNutrient = (number: string, unitName: string, amount: unknown) => ({
  type: "FoodNutrient",
  nutrient: { id: 1, number, name: "synthetic", unitName },
  amount,
});

const fdcFoundation = {
  fdcId: 900101,
  description: "Synthetic lentils, cooked",
  dataType: "Foundation",
  publicationDate: "4/1/2026",
  foodNutrients: [
    fdcNutrient("208", "KCAL", 116),
    fdcNutrient("268", "kJ", 485),
    fdcNutrient("203", "G", 9),
    fdcNutrient("204", "G", 0.4),
    fdcNutrient("291", "G", 7.9),
    fdcNutrient("269", "G", 0),
    fdcNutrient("307", "MG", 2),
    fdcNutrient("606", "MG", 50), // saturated fat reported in mg → 0.05 g
  ],
  foodPortions: [{ gramWeight: 198, portionDescription: "1 cup" }],
};

const fdcBranded = {
  fdcId: "900202",
  description: "Synthetic oat drink",
  dataType: "Branded",
  brandOwner: "Synthetic Owner Co",
  gtinUpc: "0001234-567895",
  servingSize: 250,
  servingSizeUnit: "MLT",
  householdServingFullText: "1 glass",
  foodNutrients: [
    { nutrientNumber: "208", unitName: "KCAL", value: 46 },
    { nutrientNumber: "269", unitName: "G", value: 4 },
    { nutrientNumber: "539", unitName: "G", value: 0 },
    { nutrientNumber: "307", unitName: "MG", value: 40 },
  ],
};

const offProduct = {
  code: "4006381333931",
  product_name: "Synthetic hazelnut spread",
  brands: "Synthetic Brand",
  last_modified_t: 1_780_000_000,
  serving_size: "15 g",
  serving_quantity: 15,
  image_front_url: "https://example.test/image.jpg",
  nutriments: {
    "energy-kcal_100g": 540,
    "energy-kj_100g": 2260,
    fat_100g: 31,
    "saturated-fat_100g": 10.5,
    carbohydrates_100g: "57.5",
    sugars_100g: 56,
    proteins_100g: 6.3,
    salt_100g: 0.1,
    sodium_100g: 0.04,
    fiber_100g: -1,
  },
};

describe("FDC adapter", () => {
  test("maps nutrients by number, keeps unknowns null and records the data type", () => {
    const record = parseFdcFood(fdcFoundation);
    expect(record).toMatchObject({
      source: "fdc",
      fdcId: "900101",
      dataType: "Foundation",
      name: "Synthetic lentils, cooked",
      brand: null,
      barcode: null,
      nutrientBasisAmount: 100,
      nutrientBasisUnit: "g",
      servingSizeAmount: null,
      energyKcal: 116,
      energyKj: 485,
      proteinG: 9,
      fatG: 0.4,
      fiberG: 7.9,
      totalSugarsG: 0,
      sodiumMg: 2,
      saturatedFatG: 0.05,
    });
    // Not provided by FDC: unknown, never zero; salt is never derived from sodium.
    expect(record?.carbohydrateG).toBeNull();
    expect(record?.saltG).toBeNull();
    expect(record?.freeSugarsG).toBeNull();
    expect(record?.addedSugarsG).toBeNull();
  });

  test("branded liquids are per 100 ml with a labeled serving and normalized GTIN", () => {
    expect(parseFdcFood(fdcBranded)).toMatchObject({
      fdcId: "900202",
      brand: "Synthetic Owner Co",
      barcode: "0001234567895",
      nutrientBasisUnit: "ml",
      servingSizeAmount: 250,
      servingSizeUnit: "ml",
      servingLabel: "1 glass",
      energyKcal: 46,
      addedSugarsG: 0,
      sodiumMg: 40,
    });
  });

  test("energy with an unexpected unit is unknown, not converted", () => {
    const record = parseFdcFood({
      ...fdcFoundation,
      foodNutrients: [fdcNutrient("208", "kJ", 485)],
    });
    expect(record?.energyKcal).toBeNull();
  });

  test("rejects items without a stable id, name or data type", () => {
    expect(parseFdcFood(null)).toBeNull();
    expect(parseFdcFood({ ...fdcFoundation, fdcId: "abc" })).toBeNull();
    expect(parseFdcFood({ ...fdcFoundation, description: " " })).toBeNull();
    expect(parseFdcFood({ ...fdcFoundation, dataType: undefined })).toBeNull();
  });
});

describe("Open Food Facts adapter", () => {
  test("maps core nutrients, converts sodium g → mg and ignores images", () => {
    const record = parseOffProduct(offProduct);
    expect(record).toMatchObject({
      source: "off",
      code: "4006381333931",
      barcode: "4006381333931",
      name: "Synthetic hazelnut spread",
      brand: "Synthetic Brand",
      nutrientBasisAmount: 100,
      nutrientBasisUnit: "g",
      servingSizeAmount: 15,
      servingSizeUnit: "g",
      servingLabel: "15 g",
      energyKcal: 540,
      energyKj: 2260,
      carbohydrateG: 57.5,
      sodiumMg: 40,
      saltG: 0.1,
    });
    expect(record?.lastModifiedAt.toISOString()).toBe(new Date(1_780_000_000 * 1000).toISOString());
    // Invalid upstream value → unknown; absent → unknown.
    expect(record?.fiberG).toBeNull();
    expect(record?.addedSugarsG).toBeNull();
    expect(JSON.stringify(record)).not.toContain("image");
  });

  test("volume products are per 100 ml; nameless products keep a null name", () => {
    const record = parseOffProduct({
      code: "12345678",
      last_modified_t: 1_780_000_000,
      product_quantity_unit: "ml",
      nutriments: {},
    });
    expect(record?.nutrientBasisUnit).toBe("ml");
    expect(record?.name).toBeNull();
    expect(record?.energyKcal).toBeNull();
  });

  test("non-GTIN codes are kept but carry no barcode", () => {
    expect(parseOffProduct({ ...offProduct, code: "2001234" })?.barcode).toBeNull();
  });

  test("rejects products without a numeric code or modification time", () => {
    expect(parseOffProduct({ ...offProduct, code: "abc" })).toBeNull();
    expect(parseOffProduct({ ...offProduct, last_modified_t: undefined })).toBeNull();
  });
});

describe("readJsonLines", () => {
  test("splits across chunk boundaries and yields null for malformed lines", async () => {
    async function* chunks() {
      yield '{"a":1}\n{"b"';
      yield new TextEncoder().encode(':2}\nnot json\n\n{"c":3}');
    }
    const items: unknown[] = [];
    for await (const item of readJsonLines(chunks())) items.push(item);
    expect(items).toEqual([{ a: 1 }, { b: 2 }, null, { c: 3 }]);
  });
});

describe("readJsonArrayItems", () => {
  const collect = async (chunks: AsyncIterable<Uint8Array | string>) => {
    const items: unknown[] = [];
    for await (const item of readJsonArrayItems(chunks)) items.push(item);
    return items;
  };
  async function* oneCharAtATime(text: string) {
    for (const ch of text) yield new TextEncoder().encode(ch);
  }

  const document = `{"FoundationFoods": [
{"fdcId":1,"description":"Bracket ] and brace } in \\"text\\"","foodNutrients":[{"amount":[1,2]}]},
{"fdcId":2,"description":"Ünïcode ✓","inputFoods":[{"fdcId":3,"dataType":"Sample"}]},
{"broken": },
null
]}`;
  const expected = [
    {
      fdcId: 1,
      description: 'Bracket ] and brace } in "text"',
      foodNutrients: [{ amount: [1, 2] }],
    },
    { fdcId: 2, description: "Ünïcode ✓", inputFoods: [{ fdcId: 3, dataType: "Sample" }] },
    null,
    null,
  ];

  test("yields the items of the top-level object's array, keeping nested arrays inside", async () => {
    expect(await collect(oneCharAtATime(document))).toEqual(expected);
    async function* whole() {
      yield document;
    }
    expect(await collect(whole())).toEqual(expected);
  });

  test("reads a top-level array and ignores anything after it", async () => {
    async function* chunks() {
      yield '[{"a":1}, "x", 2';
      yield ', {"b":[3]}] {"ignored": true}';
    }
    expect(await collect(chunks())).toEqual([{ a: 1 }, "x", 2, { b: [3] }]);
  });
});

describe("micronutrients (#78)", () => {
  test("FDC maps micronutrients by number and unit, and never uses the vitamin D IU value", () => {
    const record = parseFdcFood({
      ...fdcFoundation,
      foodNutrients: [
        ...fdcFoundation.foodNutrients,
        fdcNutrient("301", "MG", 19),
        fdcNutrient("303", "MG", 3.33),
        fdcNutrient("304", "MG", 36),
        fdcNutrient("306", "MG", 369),
        fdcNutrient("309", "MG", 1.27),
        fdcNutrient("401", "MG", 0),
        fdcNutrient("418", "UG", 0),
        fdcNutrient("324", "IU", 40), // IU: ignored
      ],
    });
    expect(record).toMatchObject({
      calciumMg: 19,
      ironMg: 3.33,
      magnesiumMg: 36,
      potassiumMg: 369,
      zincMg: 1.27,
      vitaminCMg: 0,
      vitaminB12Ug: 0,
      vitaminDUg: null,
    });
    expect(parseFdcFood(fdcBranded)).toMatchObject({ calciumMg: null, vitaminDUg: null });
  });

  test("FDC converts mass units for micronutrients", () => {
    const record = parseFdcFood({
      ...fdcFoundation,
      foodNutrients: [fdcNutrient("328", "UG", 2.5), fdcNutrient("301", "G", 0.12)],
    });
    expect(record).toMatchObject({ vitaminDUg: 2.5, calciumMg: 120 });
  });

  test("OFF converts gram values to mg and µg and keeps missing values unknown", () => {
    const record = parseOffProduct({
      ...offProduct,
      nutriments: {
        ...offProduct.nutriments,
        calcium_100g: 0.12,
        iron_100g: 0.0042,
        "vitamin-c_100g": 0,
        "vitamin-d_100g": 0.0000025,
        "vitamin-b12_100g": "not a number",
      },
    });
    expect(record).toMatchObject({
      calciumMg: 120,
      ironMg: 4.2,
      vitaminCMg: 0,
      vitaminDUg: 2.5,
      vitaminB12Ug: null,
      magnesiumMg: null,
      potassiumMg: null,
      zincMg: null,
    });
  });
});
