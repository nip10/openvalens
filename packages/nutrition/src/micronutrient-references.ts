import type { MicronutrientKey } from "./micronutrients";

/**
 * Adult micronutrient reference values (Issue #78), as a versioned dataset.
 *
 * Two sources, never mixed in one summary:
 * - EFSA Dietary Reference Values. Re-use is authorised provided EFSA is
 *   acknowledged as the source. Values from the EFSA DRV Finder data
 *   (`multimedia.efsa.europa.eu/drvs`), each linked to its scientific opinion.
 * - NASEM Dietary Reference Intakes. Stored as per-nutrient numbers with
 *   citations only (NASEM text and tables are All Rights Reserved). Values
 *   checked against "DRI Summary Tables", Appendix J of Dietary Reference
 *   Intakes for Sodium and Potassium (2019). The NIH ODS fact sheets (public
 *   domain) are linked for reading.
 *
 * Reference types stay distinct: a PRI/RDA or AI is an intake reference for
 * healthy groups, a UL or safe level is an upper level, never a goal, and an
 * AI is never a deficiency cutoff. Only adult, non-pregnant, non-lactating
 * groups are included; children and pregnancy/lactation are out of scope.
 */

export const MICRONUTRIENT_REFERENCE_SOURCES = ["efsa", "nasem"] as const;
export type MicronutrientReferenceSource = (typeof MICRONUTRIENT_REFERENCE_SOURCES)[number];

export type MicronutrientReferenceType =
  | "efsa_pri"
  | "efsa_ai"
  | "efsa_ul"
  | "efsa_safe_level"
  | "nasem_rda"
  | "nasem_ai"
  | "nasem_ul";

export const MICRONUTRIENT_POPULATIONS = {
  efsa_men_18_24: { source: "efsa", label: "Men, 18 to 24 years" },
  efsa_men_25_plus: { source: "efsa", label: "Men, 25 years and older" },
  efsa_women_18_24: { source: "efsa", label: "Women, 18 to 24 years" },
  efsa_women_25_plus: {
    source: "efsa",
    label: "Women, 25 years and older, before menopause",
  },
  efsa_women_postmenopausal: { source: "efsa", label: "Women after menopause" },
  nasem_men_19_30: { source: "nasem", label: "Men, 19 to 30 years" },
  nasem_men_31_50: { source: "nasem", label: "Men, 31 to 50 years" },
  nasem_men_51_70: { source: "nasem", label: "Men, 51 to 70 years" },
  nasem_men_71_plus: { source: "nasem", label: "Men, 71 years and older" },
  nasem_women_19_30: { source: "nasem", label: "Women, 19 to 30 years" },
  nasem_women_31_50: { source: "nasem", label: "Women, 31 to 50 years" },
  nasem_women_51_70: { source: "nasem", label: "Women, 51 to 70 years" },
  nasem_women_71_plus: { source: "nasem", label: "Women, 71 years and older" },
} as const satisfies Record<string, { source: MicronutrientReferenceSource; label: string }>;
export type MicronutrientPopulation = keyof typeof MICRONUTRIENT_POPULATIONS;
export const MICRONUTRIENT_POPULATION_IDS = Object.keys(
  MICRONUTRIENT_POPULATIONS,
) as MicronutrientPopulation[];

export type MicronutrientReference = {
  nutrient: MicronutrientKey;
  type: MicronutrientReferenceType;
  /** Per day, in the nutrient's column unit. */
  value: number;
  /** Upper end when the reference is a range (EFSA zinc by phytate intake). */
  valueMax?: number;
  /** `supplements`: applies only to supplements and additions, never to food (magnesium UL). */
  appliesTo: "total" | "supplements";
  note?: string;
  /** Citation for this value. */
  document: string;
};

export const MICRONUTRIENT_REFERENCE_DATASET = Object.freeze({
  version: "micronutrient-references/v1",
  retrievedAt: "2026-10-23",
  sources: {
    efsa: {
      org: "European Food Safety Authority (EFSA)",
      title: "Dietary Reference Values for the EU",
      url: "https://multimedia.efsa.europa.eu/drvs/index.htm",
      licenceNote: "Re-use is authorised, provided that EFSA is acknowledged as the source.",
      regionDefault: "EU, EEA and UK",
    },
    nasem: {
      org: "National Academies of Sciences, Engineering, and Medicine (NASEM)",
      title: "Dietary Reference Intakes",
      url: "https://www.nationalacademies.org/read/25353/chapter/28",
      licenceNote:
        "Numbers only, with citations; NASEM text and tables are not reproduced. Fact sheets: NIH Office of Dietary Supplements (public domain).",
      regionDefault: "United States",
    },
  },
  /**
   * A day's amount is compared with a reference only when every logged food
   * that day reports the nutrient. Partial totals are shown as "at least".
   */
  coverageRule: "complete-day",
} as const);

const EFSA = {
  calcium:
    "EFSA NDA Panel (2015), Scientific opinion on DRVs for calcium. doi:10.2903/j.efsa.2015.4101",
  calciumUl:
    "EFSA NDA Panel (2012), Scientific opinion on the UL of calcium. doi:10.2903/j.efsa.2012.2814",
  iron: "EFSA NDA Panel (2015), Scientific opinion on DRVs for iron. doi:10.2903/j.efsa.2015.4254",
  ironSafe:
    "EFSA NDA Panel (2024), Scientific opinion on the UL for iron. doi:10.2903/j.efsa.2024.8819",
  magnesium:
    "EFSA NDA Panel (2015), Scientific opinion on DRVs for magnesium. doi:10.2903/j.efsa.2015.4186",
  potassium: "EFSA NDA Panel (2016), DRVs for potassium. doi:10.2903/j.efsa.2016.4592",
  zinc: "EFSA NDA Panel (2014), Scientific opinion on DRVs for zinc. doi:10.2903/j.efsa.2014.3844",
  vitaminC:
    "EFSA NDA Panel (2013), Scientific opinion on DRVs for vitamin C. doi:10.2903/j.efsa.2013.3418",
  vitaminD: "EFSA NDA Panel (2016), DRVs for vitamin D. doi:10.2903/j.efsa.2016.4547",
  vitaminDUl:
    "EFSA NDA Panel (2023), Scientific opinion on the UL for vitamin D. doi:10.2903/j.efsa.2023.8145",
  b12: "EFSA NDA Panel (2015), Scientific opinion on DRVs for cobalamin (vitamin B12). doi:10.2903/j.efsa.2015.4150",
  uls: "EFSA (2006), Tolerable Upper Intake Levels for Vitamins and Minerals. https://www.efsa.europa.eu/sites/default/files/assets/ndatolerableuil.pdf",
} as const;

const NASEM = {
  calciumD: "IOM (2011), Dietary Reference Intakes for Calcium and Vitamin D",
  magnesium:
    "IOM (1997), Dietary Reference Intakes for Calcium, Phosphorus, Magnesium, Vitamin D, and Fluoride",
  ironZinc:
    "IOM (2001), Dietary Reference Intakes for Vitamin A, Vitamin K, Arsenic, Boron, Chromium, Copper, Iodine, Iron, Manganese, Molybdenum, Nickel, Silicon, Vanadium, and Zinc",
  vitaminC:
    "IOM (2000), Dietary Reference Intakes for Vitamin C, Vitamin E, Selenium, and Carotenoids",
  b12: "IOM (1998), Dietary Reference Intakes for Thiamin, Riboflavin, Niacin, Vitamin B6, Folate, Vitamin B12, Pantothenic Acid, Biotin, and Choline",
  potassium: "NASEM (2019), Dietary Reference Intakes for Sodium and Potassium",
} as const;

type Row = Omit<MicronutrientReference, "appliesTo"> & { appliesTo?: "total" | "supplements" };
const row = (r: Row): MicronutrientReference => ({ appliesTo: "total", ...r });

const MAGNESIUM_UL_NOTE = "Applies only to magnesium from supplements, not to magnesium in food.";
const EFSA_ZINC_NOTE =
  "Depends on phytate intake: the lower value is for 300 mg/day of phytate, the higher for 1,200 mg/day.";

function efsa(population: MicronutrientPopulation): MicronutrientReference[] {
  const men = population.startsWith("efsa_men");
  const young = population.endsWith("18_24");
  const premenopausal = population === "efsa_women_18_24" || population === "efsa_women_25_plus";
  return [
    row({
      nutrient: "calciumMg",
      type: "efsa_pri",
      value: young ? 1000 : 950,
      document: EFSA.calcium,
    }),
    row({ nutrient: "calciumMg", type: "efsa_ul", value: 2500, document: EFSA.calciumUl }),
    row({
      nutrient: "ironMg",
      type: "efsa_pri",
      value: premenopausal ? 16 : 11,
      document: EFSA.iron,
    }),
    row({ nutrient: "ironMg", type: "efsa_safe_level", value: 40, document: EFSA.ironSafe }),
    row({
      nutrient: "magnesiumMg",
      type: "efsa_ai",
      value: men ? 350 : 300,
      document: EFSA.magnesium,
    }),
    row({
      nutrient: "magnesiumMg",
      type: "efsa_ul",
      value: 250,
      appliesTo: "supplements",
      note: MAGNESIUM_UL_NOTE,
      document: EFSA.uls,
    }),
    row({ nutrient: "potassiumMg", type: "efsa_ai", value: 3500, document: EFSA.potassium }),
    row({
      nutrient: "zincMg",
      type: "efsa_pri",
      value: men ? 9.4 : 7.5,
      valueMax: men ? 16.3 : 12.7,
      note: EFSA_ZINC_NOTE,
      document: EFSA.zinc,
    }),
    row({ nutrient: "zincMg", type: "efsa_ul", value: 25, document: EFSA.uls }),
    row({
      nutrient: "vitaminCMg",
      type: "efsa_pri",
      value: men ? 110 : 95,
      document: EFSA.vitaminC,
    }),
    row({ nutrient: "vitaminDUg", type: "efsa_ai", value: 15, document: EFSA.vitaminD }),
    row({ nutrient: "vitaminDUg", type: "efsa_ul", value: 100, document: EFSA.vitaminDUl }),
    row({ nutrient: "vitaminB12Ug", type: "efsa_ai", value: 4, document: EFSA.b12 }),
  ];
}

function nasem(population: MicronutrientPopulation): MicronutrientReference[] {
  const men = population.startsWith("nasem_men");
  const band = population.replace(/^nasem_(men|women)_/, "");
  const over50 = band === "51_70" || band === "71_plus";
  const calcium = men ? (band === "71_plus" ? 1200 : 1000) : over50 ? 1200 : 1000;
  const magnesium = men ? (band === "19_30" ? 400 : 420) : band === "19_30" ? 310 : 320;
  return [
    row({ nutrient: "calciumMg", type: "nasem_rda", value: calcium, document: NASEM.calciumD }),
    row({
      nutrient: "calciumMg",
      type: "nasem_ul",
      value: over50 ? 2000 : 2500,
      document: NASEM.calciumD,
    }),
    row({
      nutrient: "ironMg",
      type: "nasem_rda",
      value: men || over50 ? 8 : 18,
      document: NASEM.ironZinc,
    }),
    row({ nutrient: "ironMg", type: "nasem_ul", value: 45, document: NASEM.ironZinc }),
    row({
      nutrient: "magnesiumMg",
      type: "nasem_rda",
      value: magnesium,
      document: NASEM.magnesium,
    }),
    row({
      nutrient: "magnesiumMg",
      type: "nasem_ul",
      value: 350,
      appliesTo: "supplements",
      note: MAGNESIUM_UL_NOTE,
      document: NASEM.magnesium,
    }),
    row({
      nutrient: "potassiumMg",
      type: "nasem_ai",
      value: men ? 3400 : 2600,
      document: NASEM.potassium,
    }),
    row({ nutrient: "zincMg", type: "nasem_rda", value: men ? 11 : 8, document: NASEM.ironZinc }),
    row({ nutrient: "zincMg", type: "nasem_ul", value: 40, document: NASEM.ironZinc }),
    row({
      nutrient: "vitaminCMg",
      type: "nasem_rda",
      value: men ? 90 : 75,
      note: "People who smoke need 35 mg/day more.",
      document: NASEM.vitaminC,
    }),
    row({ nutrient: "vitaminCMg", type: "nasem_ul", value: 2000, document: NASEM.vitaminC }),
    row({
      nutrient: "vitaminDUg",
      type: "nasem_rda",
      value: band === "71_plus" ? 20 : 15,
      document: NASEM.calciumD,
    }),
    row({ nutrient: "vitaminDUg", type: "nasem_ul", value: 100, document: NASEM.calciumD }),
    row({ nutrient: "vitaminB12Ug", type: "nasem_rda", value: 2.4, document: NASEM.b12 }),
  ];
}

/** Every reference for one population, or `[]` for an unknown id. */
export function micronutrientReferencesFor(population: string): MicronutrientReference[] {
  if (!(population in MICRONUTRIENT_POPULATIONS)) return [];
  const id = population as MicronutrientPopulation;
  return MICRONUTRIENT_POPULATIONS[id].source === "efsa" ? efsa(id) : nasem(id);
}

export function isPopulationOf(
  source: MicronutrientReferenceSource,
  population: string,
): population is MicronutrientPopulation {
  return (
    population in MICRONUTRIENT_POPULATIONS &&
    MICRONUTRIENT_POPULATIONS[population as MicronutrientPopulation].source === source
  );
}

/**
 * A suggested source and population from the member's own profile answers,
 * shown for the member to accept or change; never applied by itself.
 * Region: US → NASEM; UK and Portugal → EFSA; otherwise no suggestion.
 */
export function proposeMicronutrientReference(profile: {
  region: string | null;
  sex: string | null;
  minAge: number | null;
  maxAge: number | null;
}): { source: MicronutrientReferenceSource | null; population: MicronutrientPopulation | null } {
  const source: MicronutrientReferenceSource | null =
    profile.region === "us"
      ? "nasem"
      : profile.region === "uk" || profile.region === "pt"
        ? "efsa"
        : null;
  if (!source || (profile.sex !== "male" && profile.sex !== "female") || profile.minAge === null)
    return { source, population: null };
  const group = profile.sex === "male" ? "men" : "women";
  const max = profile.maxAge ?? profile.minAge;
  const within = (from: number, to: number) => profile.minAge! >= from && max <= to;
  let band: string | null = null;
  if (source === "efsa") band = within(18, 24) ? "18_24" : within(25, 200) ? "25_plus" : null;
  else
    band = within(19, 30)
      ? "19_30"
      : within(31, 50)
        ? "31_50"
        : within(51, 70)
          ? "51_70"
          : within(71, 200)
            ? "71_plus"
            : null;
  const population = band ? `${source}_${group}_${band}` : null;
  return {
    source,
    population:
      population && population in MICRONUTRIENT_POPULATIONS
        ? (population as MicronutrientPopulation)
        : null,
  };
}
