import { describe, expect, test } from "bun:test";

import {
  CAFFEINE_REFERENCE,
  DRINK_PRESET_KEYS,
  DRINK_PRESETS,
  STANDARD_DRINK_DEFINITIONS,
  alcoholTotal,
  caffeineReferenceApplies,
  caffeineTotal,
  drinkPreset,
  lastCaffeineAt,
  presetGrams,
  standardDrinkDefinitionFor,
  standardDrinks,
} from "./drinks";

describe("drink presets (#443)", () => {
  test("one preset per key, each an FDC catalog food", () => {
    expect(DRINK_PRESETS.map((entry) => entry.key)).toEqual([...DRINK_PRESET_KEYS]);
    for (const entry of DRINK_PRESETS) {
      expect(entry.catalogId).toBe(`fdc:${entry.fdcId}`);
      expect(entry.amountG).toBeGreaterThan(0);
    }
  });

  test("grams come from the volume and FDC's own fl oz weight, never a guessed density", () => {
    expect(presetGrams(30, 29.6)).toBe(30);
    expect(presetGrams(330, 29.7)).toBe(331);
    expect(drinkPreset("cola")?.amountG).toBe(343);
    expect(drinkPreset("spirits")?.amountG).toBe(38);
    expect(drinkPreset("wine")?.amountG).toBe(150);
    expect(drinkPreset("nope")).toBeNull();
  });
});

describe("drink totals (#443)", () => {
  const espresso = { nutrientFactor: 0.3, caffeineMg: 212, alcoholG: 0 };
  const wine = { nutrientFactor: 1.5, caffeineMg: 0, alcoholG: 10.4 };
  const custom = { nutrientFactor: 1, caffeineMg: null, alcoholG: null };

  test("sums known values with full coverage", () => {
    expect(caffeineTotal([espresso, wine])).toEqual({
      knownEntries: 2,
      totalEntries: 2,
      amount: 64,
      atLeast: false,
    });
    expect(alcoholTotal([espresso, wine])).toEqual({
      knownEntries: 2,
      totalEntries: 2,
      amount: 15.6,
      atLeast: false,
    });
  });

  test("an unknown value is not zero: coverage and an at-least total", () => {
    expect(caffeineTotal([espresso, custom])).toEqual({
      knownEntries: 1,
      totalEntries: 2,
      amount: 64,
      atLeast: true,
    });
    expect(caffeineTotal([custom])).toEqual({
      knownEntries: 0,
      totalEntries: 1,
      amount: null,
      atLeast: false,
    });
    expect(caffeineTotal([])).toEqual({
      knownEntries: 0,
      totalEntries: 0,
      amount: null,
      atLeast: false,
    });
  });

  test("standard drinks use the region's cited definition only", () => {
    const pt = standardDrinkDefinitionFor("pt")!;
    expect(pt.grams).toBe(10);
    expect(standardDrinks(15.6, pt)).toBe(1.6);
    expect(standardDrinks(15.6, STANDARD_DRINK_DEFINITIONS.us)).toBe(1.1);
    expect(STANDARD_DRINK_DEFINITIONS.uk).toMatchObject({ grams: 8, unit: "uk_unit" });
    expect(standardDrinkDefinitionFor(null)).toBeNull();
    for (const definition of Object.values(STANDARD_DRINK_DEFINITIONS))
      expect(definition.url).toStartWith("https://");
  });

  test("the caffeine reference needs a confirmed adult and no pregnancy declaration", () => {
    expect(CAFFEINE_REFERENCE.mgPerDay).toBe(400);
    expect(caffeineReferenceApplies({ adultConfirmed: true, declarations: [] })).toBe(true);
    expect(caffeineReferenceApplies({ adultConfirmed: false, declarations: [] })).toBe(false);
    expect(
      caffeineReferenceApplies({
        adultConfirmed: true,
        declarations: ["pregnant_or_breastfeeding"],
      }),
    ).toBe(false);
  });
});

describe("last caffeine before a night (#443)", () => {
  const at = (iso: string) => new Date(iso);
  const window = { from: at("2026-11-12T07:00:00Z"), to: at("2026-11-12T23:00:00Z") };

  test("the latest entry with caffeine in the window", () => {
    expect(
      lastCaffeineAt(
        [
          { at: at("2026-11-12T09:00:00Z"), nutrientFactor: 0.3, caffeineMg: 212, alcoholG: 0 },
          { at: at("2026-11-12T16:40:00Z"), nutrientFactor: 2.5, caffeineMg: 40, alcoholG: 0 },
          // Wine: no caffeine.
          { at: at("2026-11-12T20:00:00Z"), nutrientFactor: 1.5, caffeineMg: 0, alcoholG: 10.4 },
          // Unknown caffeine is not known to be caffeine.
          { at: at("2026-11-12T21:00:00Z"), nutrientFactor: 1, caffeineMg: null, alcoholG: null },
          // After sleep started.
          { at: at("2026-11-12T23:30:00Z"), nutrientFactor: 1, caffeineMg: 40, alcoholG: 0 },
        ],
        window,
      )?.toISOString(),
    ).toBe("2026-11-12T16:40:00.000Z");
  });

  test("nothing in the window", () => {
    expect(
      lastCaffeineAt(
        [{ at: at("2026-11-11T16:00:00Z"), nutrientFactor: 1, caffeineMg: 40, alcoholG: 0 }],
        window,
      ),
    ).toBeNull();
  });
});
