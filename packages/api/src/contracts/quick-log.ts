import { z } from "zod";

import { DRINK_PRESET_KEYS, type DrinkPresetKey } from "./nutrition-drinks";

/**
 * `quickLog.*` wire contract (#440). Shared by the server router, the web
 * command palette and the mobile log picker, so this file imports only `zod`.
 */

/** Single-value metric kinds a recent entry can repeat (`LOG_KINDS` ids). */
export const RECENT_METRIC_KINDS = [
  "weight",
  "heart_rate",
  "resting_heart_rate",
  "steps",
  "active_calories",
  "distance",
] as const;
export type RecentMetricKind = (typeof RECENT_METRIC_KINDS)[number];

/** Drink preset kinds (#443): `drink:<preset key>`; a test keeps them equal to the presets. */
export const RECENT_DRINK_KINDS = [
  "drink:espresso",
  "drink:filter_coffee",
  "drink:tea",
  "drink:cola",
  "drink:energy_drink",
  "drink:beer",
  "drink:wine",
  "drink:spirits",
] as const satisfies readonly `drink:${DrinkPresetKey}`[];
export type RecentDrinkKind = (typeof RECENT_DRINK_KINDS)[number];

const at = z.string();

/**
 * One of the member's own recent entries, repeatable as is with the time set
 * to now. Values are in the stored unit (kg, bpm, count, kcal, m, ml).
 */
export const recentLogEntry = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(RECENT_METRIC_KINDS),
    at,
    value: z.number(),
    unit: z.string(),
  }),
  z.object({
    kind: z.literal("blood_pressure"),
    at,
    systolic: z.number(),
    diastolic: z.number(),
    pulse: z.number().nullable(),
  }),
  z.object({ kind: z.literal("water"), at, quantityMl: z.number() }),
  z.object({
    kind: z.literal("supplement_intake"),
    at,
    supplementId: z.number().int().positive(),
    supplementName: z.string(),
    dose: z.string(),
  }),
  /** A drink preset logged before (#443), repeated as the same preset and volume. */
  z.object({
    kind: z.enum(RECENT_DRINK_KINDS),
    at,
    preset: z.enum(DRINK_PRESET_KEYS),
    volumeMl: z.number(),
  }),
]);
export type RecentLogEntry = z.infer<typeof recentLogEntry>;

export const quickLogRecentsInput = z
  .strictObject({ limit: z.number().int().min(1).max(10).optional() })
  .optional();
export const quickLogRecentsOutput = z.object({
  entries: z.array(recentLogEntry),
  /**
   * How many recent typed-in entries each kind has (same window and sources),
   * so a bare number typed in the palette offers the most-logged kinds first.
   */
  kindCounts: z.record(z.string(), z.number().int().nonnegative()),
});
export type QuickLogRecents = z.infer<typeof quickLogRecentsOutput>;

export const supplementsDueInput = z.strictObject({ timeZone: z.string().min(1).max(100) });

/**
 * A supplement whose scheduled time has come today and that has not been
 * taken as many times as it was due. `dose` is the schedule's quantity, or
 * the supplement's own dose; `null` when neither is set (open the full form).
 */
export const dueSupplement = z.object({
  supplementId: z.number().int().positive(),
  name: z.string(),
  dose: z.string().nullable(),
  scheduleId: z.number().int().positive(),
  timeOfDay: z.string(),
  /** Doses still due today, counting this one. */
  pending: z.number().int().positive(),
});
export type DueSupplement = z.infer<typeof dueSupplement>;

export const supplementsDueOutput = z.object({
  /** The member's local date the answer is for (`YYYY-MM-DD`). */
  localDate: z.string(),
  items: z.array(dueSupplement),
});
export type SupplementsDue = z.infer<typeof supplementsDueOutput>;
