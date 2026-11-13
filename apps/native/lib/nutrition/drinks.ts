import type { MealSlot } from "@openvalens/api/contracts/nutrition-diary";
import type {
  DrinkPresetsWire,
  DrinkSummaryWire,
  LastCaffeineWire,
} from "@openvalens/api/contracts/nutrition-drinks";

import type { EnqueueInput } from "./outbox";

/**
 * Drinks on mobile (Issue #443). Pure, so it is unit tested without React
 * Native. A preset is a known catalog food, so it is queued at once as a
 * normal diary log through the durable outbox, with method `preset`.
 */

export type DrinkPreset = DrinkPresetsWire["presets"][number];

/** Presets the server can log now; none until the operator imports FDC. */
export function availablePresets(data: DrinkPresetsWire | undefined): DrinkPreset[] {
  return data?.presets.filter((entry) => entry.available) ?? [];
}

/**
 * The outbox change for one tap on a preset. Only the catalog id and amount
 * go on the wire; the server reads the food's values. The preview carries
 * no nutrients, because the presets list does not send them.
 */
export function presetLogInput(
  preset: DrinkPreset,
  options: {
    clientMutationId: string;
    localDate: string;
    timeZone: string;
    slot: MealSlot;
    name: string;
  },
): EnqueueInput {
  return {
    op: {
      kind: "log",
      input: {
        clientMutationId: options.clientMutationId,
        localDate: options.localDate,
        timeZone: options.timeZone,
        slot: options.slot,
        food: { kind: "catalog", id: preset.catalogId },
        amount: preset.amountG,
        unit: "g",
        method: "preset",
      },
    },
    preview: { name: options.name, source: "fdc", nutrients: null },
  };
}

/**
 * What the totals card shows. Both off: nothing. Hide-numbers on (locally or
 * on the server) or a total marked hidden: a note only, never an amount.
 */
export function drinkTotalsState(
  summary: DrinkSummaryWire | undefined,
  hideNumbers: boolean,
): "none" | "hidden" | "ready" {
  if (!summary) return "none";
  const { caffeine, alcohol } = summary;
  if (caffeine.status === "off" && alcohol.status === "off") return "none";
  if (hideNumbers || caffeine.status === "hidden" || alcohol.status === "hidden") return "hidden";
  return "ready";
}

/** Last caffeine per night key, or `null` while the caffeine setting is off or unknown. */
export function lastCaffeineByNight(
  data: LastCaffeineWire | undefined,
): Map<string, string | null> | null {
  if (data?.status !== "ready") return null;
  return new Map(data.nights.map((night) => [night.key, night.lastCaffeineAt]));
}
