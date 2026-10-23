import { z } from "zod";

/**
 * `nutritionMicronutrients.*` wire contract (Issue #78). Shared by the server
 * router, `apps/web` and `apps/native`, so this file imports only `zod`. The
 * id lists mirror `@openvalens/nutrition/micronutrient-references`; a test
 * keeps them equal.
 */

export const MICRONUTRIENT_SOURCES = ["efsa", "nasem"] as const;
export const MICRONUTRIENT_POPULATION_KEYS = [
  "efsa_men_18_24",
  "efsa_men_25_plus",
  "efsa_women_18_24",
  "efsa_women_25_plus",
  "efsa_women_postmenopausal",
  "nasem_men_19_30",
  "nasem_men_31_50",
  "nasem_men_51_70",
  "nasem_men_71_plus",
  "nasem_women_19_30",
  "nasem_women_31_50",
  "nasem_women_51_70",
  "nasem_women_71_plus",
] as const;
export const MICRONUTRIENT_WIRE_KEYS = [
  "calciumMg",
  "ironMg",
  "magnesiumMg",
  "potassiumMg",
  "zincMg",
  "vitaminCMg",
  "vitaminDUg",
  "vitaminB12Ug",
] as const;

export const micronutrientSummaryInput = z.strictObject({
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
});

const reference = z.object({
  type: z.enum([
    "efsa_pri",
    "efsa_ai",
    "efsa_ul",
    "efsa_safe_level",
    "nasem_rda",
    "nasem_ai",
    "nasem_ul",
  ]),
  value: z.number(),
  valueMax: z.number().nullable(),
  appliesTo: z.enum(["total", "supplements"]),
  note: z.string().nullable(),
  document: z.string(),
});

export const micronutrientSummaryOutput = z.object({
  /**
   * `off`: not opted in. `hidden`: a self-declared exclusion hides the
   * summary. `ready`: rows below.
   */
  status: z.enum(["off", "hidden", "ready"]),
  localDate: z.string(),
  datasetVersion: z.string(),
  hideNumbers: z.boolean(),
  /** The accepted reference, or `null` when none is accepted (or not an adult). */
  reference: z
    .object({
      source: z.enum(MICRONUTRIENT_SOURCES),
      sourceOrg: z.string(),
      sourceUrl: z.string(),
      licenceNote: z.string(),
      population: z.enum(MICRONUTRIENT_POPULATION_KEYS),
      populationLabel: z.string(),
    })
    .nullable(),
  /** Why references are not shown, when they are not. */
  referenceNote: z.enum(["not_chosen", "adults_only"]).nullable(),
  /** A suggestion from the profile, for the member to accept; never applied by itself. */
  proposal: z.object({
    source: z.enum(MICRONUTRIENT_SOURCES).nullable(),
    population: z.enum(MICRONUTRIENT_POPULATION_KEYS).nullable(),
  }),
  totalEntries: z.number().int(),
  rows: z.array(
    z.object({
      nutrient: z.enum(MICRONUTRIENT_WIRE_KEYS),
      knownEntries: z.number().int(),
      totalEntries: z.number().int(),
      amount: z.number().nullable(),
      atLeast: z.boolean(),
      percentOfReference: z.number().nullable(),
      references: z.array(reference),
    }),
  ),
});
export type MicronutrientSummaryWire = z.infer<typeof micronutrientSummaryOutput>;
