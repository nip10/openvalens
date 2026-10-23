import { describe, expect, test } from "bun:test";

import { emptyMicronutrients, MICRONUTRIENT_KEYS } from "./micronutrients";
import {
  MICRONUTRIENT_POPULATION_IDS,
  MICRONUTRIENT_POPULATIONS,
  micronutrientReferencesFor,
  proposeMicronutrientReference,
} from "./micronutrient-references";
import { summarizeMicronutrients } from "./micronutrient-summary";

const entry = (factor: number, values: Partial<ReturnType<typeof emptyMicronutrients>>) => ({
  nutrientFactor: factor,
  micronutrients: { ...emptyMicronutrients(), ...values },
});
const row = (summary: ReturnType<typeof summarizeMicronutrients>, key: string) =>
  summary.rows.find((r) => r.nutrient === key)!;

describe("summarizeMicronutrients", () => {
  test("keeps unknown apart from zero and marks partial totals as a lower bound", () => {
    const summary = summarizeMicronutrients({
      entries: [entry(2, { calciumMg: 100, ironMg: 0 }), entry(1, { calciumMg: 50 })],
      population: "efsa_men_25_plus",
      hideNumbers: false,
    });
    expect(row(summary, "calciumMg")).toMatchObject({
      knownEntries: 2,
      totalEntries: 2,
      amount: 250,
      atLeast: false,
      // 250 of the 950 mg PRI.
      percentOfReference: 26,
    });
    // A reported zero is a known value; the other entry did not report iron.
    expect(row(summary, "ironMg")).toMatchObject({
      knownEntries: 1,
      amount: 0,
      atLeast: true,
      percentOfReference: null,
    });
    // Nobody reported zinc: unknown, not zero.
    expect(row(summary, "zincMg")).toMatchObject({ knownEntries: 0, amount: null, atLeast: false });
  });

  test("never compares a range reference, an upper level or an empty day", () => {
    const summary = summarizeMicronutrients({
      entries: [entry(1, { zincMg: 9, magnesiumMg: 400 })],
      population: "efsa_men_25_plus",
      hideNumbers: false,
    });
    // EFSA zinc depends on phytate intake: a range, so no percentage.
    expect(row(summary, "zincMg").percentOfReference).toBeNull();
    // Magnesium compares with the AI, never with the supplement-only UL.
    expect(row(summary, "magnesiumMg").percentOfReference).toBe(114);
    const empty = summarizeMicronutrients({
      entries: [],
      population: "efsa_men_25_plus",
      hideNumbers: false,
    });
    expect(empty.rows.every((r) => r.amount === null && r.percentOfReference === null)).toBe(true);
  });

  test("hide-numbers mode keeps only coverage; no population means no references", () => {
    const hidden = summarizeMicronutrients({
      entries: [entry(1, { calciumMg: 100 })],
      population: "nasem_women_31_50",
      hideNumbers: true,
    });
    expect(row(hidden, "calciumMg")).toEqual({
      nutrient: "calciumMg",
      knownEntries: 1,
      totalEntries: 1,
      amount: null,
      atLeast: false,
      percentOfReference: null,
      references: [],
    });
    const none = summarizeMicronutrients({
      entries: [entry(1, { calciumMg: 100 })],
      population: null,
      hideNumbers: false,
    });
    expect(row(none, "calciumMg")).toMatchObject({
      amount: 100,
      percentOfReference: null,
      references: [],
    });
  });

  test("is deterministic for the same entries and dataset version", () => {
    const entries = [entry(1.5, { vitaminDUg: 2 }), entry(0.5, { vitaminDUg: 4 })];
    const first = summarizeMicronutrients({
      entries,
      population: "nasem_men_71_plus",
      hideNumbers: false,
    });
    const second = summarizeMicronutrients({
      entries: [...entries].reverse(),
      population: "nasem_men_71_plus",
      hideNumbers: false,
    });
    expect(second).toEqual(first);
    expect(first.datasetVersion).toBe("micronutrient-references/v1");
    // 5 µg of the 20 µg RDA for over 70.
    expect(row(first, "vitaminDUg").percentOfReference).toBe(25);
  });
});

describe("reference dataset", () => {
  test("every population has a labelled intake reference for every supported nutrient", () => {
    for (const population of MICRONUTRIENT_POPULATION_IDS) {
      const references = micronutrientReferencesFor(population);
      const source = MICRONUTRIENT_POPULATIONS[population].source;
      for (const nutrient of MICRONUTRIENT_KEYS) {
        const own = references.filter((r) => r.nutrient === nutrient);
        expect(own.some((r) => /_(pri|rda|ai)$/.test(r.type))).toBe(true);
        for (const r of own) {
          expect(r.type.startsWith(source)).toBe(true);
          expect(r.document.length).toBeGreaterThan(10);
          expect(r.value).toBeGreaterThan(0);
        }
      }
    }
    expect(micronutrientReferencesFor("children_4_8")).toEqual([]);
  });

  test("spot-checks values against the cited tables", () => {
    const value = (population: string, nutrient: string, type: string) =>
      micronutrientReferencesFor(population).find((r) => r.nutrient === nutrient && r.type === type)
        ?.value;
    expect(value("efsa_women_25_plus", "ironMg", "efsa_pri")).toBe(16);
    expect(value("efsa_women_postmenopausal", "ironMg", "efsa_pri")).toBe(11);
    expect(value("efsa_men_18_24", "calciumMg", "efsa_pri")).toBe(1000);
    expect(value("efsa_men_25_plus", "calciumMg", "efsa_pri")).toBe(950);
    expect(value("nasem_women_51_70", "calciumMg", "nasem_rda")).toBe(1200);
    expect(value("nasem_men_51_70", "calciumMg", "nasem_rda")).toBe(1000);
    expect(value("nasem_men_51_70", "calciumMg", "nasem_ul")).toBe(2000);
    expect(value("nasem_women_19_30", "magnesiumMg", "nasem_rda")).toBe(310);
    expect(value("nasem_men_31_50", "magnesiumMg", "nasem_rda")).toBe(420);
    expect(value("nasem_women_31_50", "ironMg", "nasem_rda")).toBe(18);
    expect(value("nasem_women_51_70", "ironMg", "nasem_rda")).toBe(8);
    expect(value("nasem_women_19_30", "potassiumMg", "nasem_ai")).toBe(2600);
    expect(value("nasem_men_71_plus", "vitaminDUg", "nasem_rda")).toBe(20);
    expect(value("efsa_men_25_plus", "vitaminB12Ug", "efsa_ai")).toBe(4);
    expect(value("nasem_men_19_30", "vitaminB12Ug", "nasem_rda")).toBe(2.4);
  });

  test("proposes a source and population only from the member's answers", () => {
    expect(
      proposeMicronutrientReference({ region: "us", sex: "female", minAge: 35, maxAge: 39 }),
    ).toEqual({
      source: "nasem",
      population: "nasem_women_31_50",
    });
    expect(
      proposeMicronutrientReference({ region: "pt", sex: "male", minAge: 20, maxAge: 24 }),
    ).toEqual({
      source: "efsa",
      population: "efsa_men_18_24",
    });
    // An age range spanning two bands, an unknown sex or region: no guess.
    expect(
      proposeMicronutrientReference({ region: "us", sex: "male", minAge: 28, maxAge: 33 })
        .population,
    ).toBeNull();
    expect(
      proposeMicronutrientReference({ region: "uk", sex: null, minAge: 40, maxAge: 44 }),
    ).toEqual({
      source: "efsa",
      population: null,
    });
    expect(
      proposeMicronutrientReference({ region: null, sex: "male", minAge: 40, maxAge: 44 }),
    ).toEqual({
      source: null,
      population: null,
    });
  });
});
