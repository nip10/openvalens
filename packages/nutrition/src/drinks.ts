/**
 * Drinks (Issue #443, part b): presets that point at catalog foods, the
 * opt-in caffeine and alcohol day totals, and the "last caffeine" time a
 * sleep night shows. Pure and client-safe (no database imports), so web and
 * native show the same presets and the same sources.
 *
 * - Drinks are foods. A preset is a known USDA FoodData Central food and an
 *   amount; logging it saves a normal diary entry, so every value has a
 *   source and nothing is double-counted.
 * - Unknown is never zero: like the micronutrient summary, a total counts
 *   only the entries that reported the value, says how many did, and is
 *   marked "at least" when some did not.
 * - There are no alcohol limits or guidelines anywhere. Standard drinks are a
 *   unit conversion with a cited definition, shown only for a region that
 *   has one. The only caffeine figure is EFSA's adult reference, shown as a
 *   number, never as a flag.
 */

/** One fluid ounce in millilitres (US customary), used to read FDC portion weights. */
export const ML_PER_FL_OZ = 29.5735;

export const DRINK_PRESET_KEYS = [
  "espresso",
  "filter_coffee",
  "tea",
  "cola",
  "energy_drink",
  "beer",
  "wine",
  "spirits",
] as const;
export type DrinkPresetKey = (typeof DRINK_PRESET_KEYS)[number];

export type DrinkPreset = {
  key: DrinkPresetKey;
  /** `fdc:<fdcId>`, resolved server-side like any catalog food (#69). */
  catalogId: string;
  fdcId: number;
  /** The FDC description, so the source can be checked by hand. */
  fdcDescription: string;
  /** The drink's volume as members think of it. */
  volumeMl: number;
  /** FDC's own weight of 1 fl oz of this food (its `foodPortions`), in g. */
  gramsPerFlOz: number;
  /** Logged amount: `volumeMl × gramsPerFlOz / 29.5735`, rounded to whole grams. */
  amountG: number;
};

/**
 * Every preset is an FDC SR Legacy (2018-04) food, the generic-food dataset
 * `deploy/setup.sh catalogs --source fdc` imports. FDC values are per 100 g,
 * so the volume is converted to grams with FDC's own fl oz portion weight for
 * that food; no density is guessed. The FDC values per 100 g at the time of
 * writing are noted for review only; the logged entry always copies the
 * catalog row.
 */
export const DRINK_PRESETS: readonly DrinkPreset[] = Object.freeze([
  // 212 mg caffeine / 100 g.
  preset("espresso", 171891, "Beverages, coffee, brewed, espresso, restaurant-prepared", 30, 29.6),
  // 40 mg caffeine / 100 g.
  preset("filter_coffee", 171890, "Beverages, coffee, brewed, prepared with tap water", 250, 29.6),
  // 20 mg caffeine / 100 g.
  preset("tea", 173227, "Beverages, tea, black, brewed, prepared with tap water", 250, 29.6),
  // 9 mg caffeine / 100 g.
  preset("cola", 174852, "Beverages, carbonated, cola, regular", 330, 30.7),
  // 38 mg caffeine / 100 g. FDC lists 8 fl oz as 240 g.
  preset(
    "energy_drink",
    174821,
    "Beverages, Energy Drink with carbonated water and high fructose corn syrup",
    250,
    30,
  ),
  // 3.9 g alcohol / 100 g.
  preset("beer", 168746, "Alcoholic beverage, beer, regular, all", 330, 29.7),
  // 10.4 g alcohol / 100 g.
  preset("wine", 173185, "Alcoholic beverage, wine, table, all", 150, 29.5),
  // 33.4 g alcohol / 100 g (40 % vol).
  preset(
    "spirits",
    174815,
    "Alcoholic beverage, distilled, all (gin, rum, vodka, whiskey) 80 proof",
    40,
    27.8,
  ),
]);

function preset(
  key: DrinkPresetKey,
  fdcId: number,
  fdcDescription: string,
  volumeMl: number,
  gramsPerFlOz: number,
): DrinkPreset {
  return {
    key,
    catalogId: `fdc:${fdcId}`,
    fdcId,
    fdcDescription,
    volumeMl,
    gramsPerFlOz,
    amountG: presetGrams(volumeMl, gramsPerFlOz),
  };
}

export function presetGrams(volumeMl: number, gramsPerFlOz: number): number {
  return Math.round((volumeMl * gramsPerFlOz) / ML_PER_FL_OZ);
}

export function drinkPreset(key: string): DrinkPreset | null {
  return DRINK_PRESETS.find((entry) => entry.key === key) ?? null;
}

/** The regions the wellness profile records (#98), the same setting preventive care uses. */
export type DrinkRegion = "us" | "uk" | "pt";

export type StandardDrinkDefinition = {
  region: DrinkRegion;
  /** Grams of pure alcohol in one. */
  grams: number;
  /** The UK counts "units"; the US and Portugal count "standard drinks". */
  unit: "standard_drink" | "uk_unit";
  org: string;
  document: string;
  url: string;
};

/**
 * Cited definitions only, checked against each source on 2026-11-13. These
 * pages also contain drinking guidelines; OpenValens takes the definition
 * from them and nothing else.
 */
export const STANDARD_DRINK_DEFINITIONS: Readonly<Record<DrinkRegion, StandardDrinkDefinition>> =
  Object.freeze({
    pt: {
      region: "pt",
      grams: 10,
      unit: "standard_drink",
      org: "DGS",
      // "Define-se bebida padrão como o volume de bebida alcoólica contendo 10g de álcool puro."
      document: "Norma 030/2012",
      url: "https://ordemdosmedicos.pt/files/pdfs/du2r-30-2012-detecao-precoce-e-intervencao-breve-no-consumo-excessivo-do-alcool-no-adulto.pdf",
    },
    uk: {
      region: "uk",
      grams: 8,
      unit: "uk_unit",
      org: "NHS",
      // "One unit equals 10ml or 8g of pure alcohol"
      document: "Calculating alcohol units",
      url: "https://www.nhs.uk/live-well/alcohol-advice/calculating-alcohol-units/",
    },
    us: {
      region: "us",
      grams: 14,
      unit: "standard_drink",
      org: "NIAAA",
      // "… any beverage containing 0.6 fl oz or 14 grams of pure alcohol."
      document: "What is a standard drink?",
      url: "https://www.niaaa.nih.gov/alcohols-effects-health/what-standard-drink",
    },
  });

export function standardDrinkDefinitionFor(
  region: DrinkRegion | null,
): StandardDrinkDefinition | null {
  return region ? STANDARD_DRINK_DEFINITIONS[region] : null;
}

/**
 * EFSA's reference for healthy adults: habitual caffeine intakes up to
 * 400 mg a day do not raise safety concerns, except in pregnancy. Shown as a
 * number beside the total, never as a limit or a flag, and only for a
 * confirmed adult without the pregnancy declaration.
 */
export const CAFFEINE_REFERENCE = Object.freeze({
  mgPerDay: 400,
  org: "EFSA",
  document: "Scientific Opinion on the safety of caffeine (2015)",
  url: "https://www.efsa.europa.eu/en/topics/topic/caffeine",
});

export function caffeineReferenceApplies(input: {
  adultConfirmed: boolean;
  declarations: readonly string[];
}): boolean {
  return input.adultConfirmed && !input.declarations.includes("pregnant_or_breastfeeding");
}

export type DrinkEntryInput = {
  /** Multiplier from the snapshot's per-basis values to the logged amount. */
  nutrientFactor: number;
  caffeineMg: number | null;
  alcoholG: number | null;
};

export type DrinkTotal = {
  knownEntries: number;
  totalEntries: number;
  /** Sum of the known values; `null` when no entry reported one. */
  amount: number | null;
  /** True when some entries reported no value, so `amount` is a lower bound. */
  atLeast: boolean;
};

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function total(entries: readonly DrinkEntryInput[], key: "caffeineMg" | "alcoholG"): DrinkTotal {
  let known = 0;
  let sum = 0;
  for (const entry of entries) {
    const value = entry[key];
    if (value === null) continue;
    known += 1;
    sum += value * entry.nutrientFactor;
  }
  return {
    knownEntries: known,
    totalEntries: entries.length,
    amount: known > 0 ? round(sum, key === "caffeineMg" ? 0 : 1) : null,
    atLeast: known > 0 && known < entries.length,
  };
}

export function caffeineTotal(entries: readonly DrinkEntryInput[]): DrinkTotal {
  return total(entries, "caffeineMg");
}

export function alcoholTotal(entries: readonly DrinkEntryInput[]): DrinkTotal {
  return total(entries, "alcoholG");
}

/** Grams of alcohol in standard drinks (or UK units), to one decimal. */
export function standardDrinks(alcoholG: number, definition: StandardDrinkDefinition): number {
  return round(alcoholG / definition.grams, 1);
}

/** Longest window `lastCaffeineAt` looks back over, in hours. */
export const CAFFEINE_WINDOW_MAX_HOURS = 36;

export type TimedCaffeineEntry = DrinkEntryInput & {
  /** When the food was eaten, or when it was logged when no time was picked. */
  at: Date;
};

/**
 * The latest entry in `[from, to)` that reported caffeine above zero. An
 * entry with an unknown value is skipped: it is not known to have caffeine.
 */
export function lastCaffeineAt(
  entries: readonly TimedCaffeineEntry[],
  window: { from: Date; to: Date },
): Date | null {
  let latest: Date | null = null;
  for (const entry of entries) {
    if (entry.caffeineMg === null || entry.caffeineMg * entry.nutrientFactor <= 0) continue;
    const time = entry.at.getTime();
    if (time < window.from.getTime() || time >= window.to.getTime()) continue;
    if (!latest || time > latest.getTime()) latest = entry.at;
  }
  return latest;
}
