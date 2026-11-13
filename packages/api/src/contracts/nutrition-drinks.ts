import { z } from "zod";

/**
 * `nutritionDrinks.*` wire contract (Issue #443, part b). Shared by the server
 * router, `apps/web` and `apps/native`, so this file imports only `zod`. The
 * preset keys mirror `@openvalens/nutrition/drinks`; a test keeps them equal.
 *
 * There is no limit, guideline or "over" field anywhere in this contract. The
 * caffeine reference is a number with its source; standard drinks are a unit
 * conversion with a cited definition.
 */

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

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const instant = z.string().datetime({ offset: true });

export const drinkPresetsInput = z.strictObject({});
export const drinkPresetsOutput = z.object({
  presets: z.array(
    z.object({
      key: z.enum(DRINK_PRESET_KEYS),
      /** `fdc:<id>`: log it with `nutritionDiary.logEntry` as a catalog food. */
      catalogId: z.string(),
      volumeMl: z.number(),
      amountG: z.number(),
      /** False until the operator imports the FDC catalog (`deploy/setup.sh catalogs --source fdc`). */
      available: z.boolean(),
    }),
  ),
});
export type DrinkPresetsWire = z.infer<typeof drinkPresetsOutput>;

export const drinkSummaryInput = z.strictObject({ localDate });

const drinkTotal = z.object({
  knownEntries: z.number().int(),
  totalEntries: z.number().int(),
  /** Sum of the known values; `null` when no entry reported one. */
  amount: z.number().nullable(),
  /** Some entries reported no value, so `amount` is a lower bound. */
  atLeast: z.boolean(),
});
export type DrinkTotalWire = z.infer<typeof drinkTotal>;

const source = { org: z.string(), document: z.string(), url: z.string() };

export const drinkSummaryOutput = z.object({
  localDate: z.string(),
  /**
   * `off`: not opted in. `hidden`: hide-numbers mode is on, so no amount is
   * sent. `ready`: the total below.
   */
  caffeine: z.discriminatedUnion("status", [
    z.object({ status: z.literal("off") }),
    z.object({ status: z.literal("hidden") }),
    z.object({
      status: z.literal("ready"),
      total: drinkTotal,
      /** EFSA's adult reference, a number only; `null` when it does not apply. */
      reference: z.object({ mgPerDay: z.number(), ...source }).nullable(),
      /** Why the reference is not shown, when it is not. */
      referenceNote: z.enum(["adults_only", "not_shown"]).nullable(),
    }),
  ]),
  alcohol: z.discriminatedUnion("status", [
    z.object({ status: z.literal("off") }),
    z.object({ status: z.literal("hidden") }),
    z.object({
      status: z.literal("ready"),
      total: drinkTotal,
      /** The region's cited definition; `null` (grams only) without one. */
      definition: z
        .object({
          region: z.enum(["us", "uk", "pt"]),
          grams: z.number(),
          unit: z.enum(["standard_drink", "uk_unit"]),
          ...source,
        })
        .nullable(),
      /** `total.amount` in the definition's unit; `null` without a definition or an amount. */
      standardDrinks: z.number().nullable(),
    }),
  ]),
});
export type DrinkSummaryWire = z.infer<typeof drinkSummaryOutput>;

/** At most this many hours per window, and this many windows per call. */
export const LAST_CAFFEINE_MAX_HOURS = 36;
export const LAST_CAFFEINE_MAX_NIGHTS = 31;

export const lastCaffeineInput = z.strictObject({
  nights: z
    .array(
      z.strictObject({ key: z.string().min(1).max(32), from: instant, to: instant }).refine(
        (night) => {
          const span = Date.parse(night.to) - Date.parse(night.from);
          return span > 0 && span <= LAST_CAFFEINE_MAX_HOURS * 3_600_000;
        },
        { message: `Each window must be positive and at most ${LAST_CAFFEINE_MAX_HOURS} hours` },
      ),
    )
    .max(LAST_CAFFEINE_MAX_NIGHTS),
});
export type LastCaffeineInput = z.infer<typeof lastCaffeineInput>;

export const lastCaffeineOutput = z.discriminatedUnion("status", [
  /** The caffeine setting is off: show nothing on the sleep view. */
  z.object({ status: z.literal("off") }),
  z.object({
    status: z.literal("ready"),
    nights: z.array(z.object({ key: z.string(), lastCaffeineAt: instant.nullable() })),
  }),
]);
export type LastCaffeineWire = z.infer<typeof lastCaffeineOutput>;
