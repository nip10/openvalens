import {
  MICRONUTRIENT_KEYS,
  type MicronutrientKey,
  type MicronutrientValues,
} from "./micronutrients";
import {
  MICRONUTRIENT_REFERENCE_DATASET,
  micronutrientReferencesFor,
  type MicronutrientReference,
} from "./micronutrient-references";

/**
 * Micronutrient summary for one day (Issue #78). Pure, so a client can
 * compute the same result from cached entries with the same dataset version.
 *
 * - An unknown value is never counted as zero. Each nutrient reports how many
 *   of the day's entries had a value (`knownEntries` of `totalEntries`).
 * - The amount is the sum of the known values: a lower bound when coverage
 *   is incomplete, marked `atLeast`.
 * - A day is compared with an intake reference (PRI/RDA/AI) only when every
 *   entry reported the nutrient and the reference is a single number. There
 *   are no low or deficiency flags at all; upper levels are shown as numbers.
 * - Hide-numbers mode drops amounts and percentages, keeping only coverage.
 */

export type MicronutrientEntryInput = {
  /** Multiplier from the snapshot's per-basis values to the logged amount. */
  nutrientFactor: number;
  micronutrients: MicronutrientValues;
};

export type MicronutrientSummaryRow = {
  nutrient: MicronutrientKey;
  knownEntries: number;
  totalEntries: number;
  /** Sum of the known values; `null` when no entry had a value (or numbers are hidden). */
  amount: number | null;
  /** True when some entries had no value, so `amount` is a lower bound. */
  atLeast: boolean;
  /** Share of the intake reference; only for a complete day and a single-number reference. */
  percentOfReference: number | null;
  references: MicronutrientReference[];
};

export type MicronutrientSummary = {
  datasetVersion: string;
  rows: MicronutrientSummaryRow[];
};

const INTAKE_TYPES = new Set(["efsa_pri", "efsa_ai", "nasem_rda", "nasem_ai"]);

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function summarizeMicronutrients(input: {
  entries: readonly MicronutrientEntryInput[];
  /** Accepted population id, or `null` for no references. */
  population: string | null;
  hideNumbers: boolean;
}): MicronutrientSummary {
  const references = input.population ? micronutrientReferencesFor(input.population) : [];
  const rows = MICRONUTRIENT_KEYS.map((nutrient): MicronutrientSummaryRow => {
    let known = 0;
    let sum = 0;
    for (const entry of input.entries) {
      const value = entry.micronutrients[nutrient];
      if (value === null) continue;
      known += 1;
      sum += value * entry.nutrientFactor;
    }
    const total = input.entries.length;
    const own = references.filter((reference) => reference.nutrient === nutrient);
    const intake = own.find(
      (reference) => INTAKE_TYPES.has(reference.type) && reference.valueMax === undefined,
    );
    const complete = total > 0 && known === total;
    const amount = known > 0 ? round(sum) : null;
    return {
      nutrient,
      knownEntries: known,
      totalEntries: total,
      amount: input.hideNumbers ? null : amount,
      atLeast: known > 0 && known < total,
      percentOfReference:
        input.hideNumbers || !complete || !intake || amount === null
          ? null
          : Math.round((amount / intake.value) * 100),
      references: input.hideNumbers ? [] : own,
    };
  });
  return { datasetVersion: MICRONUTRIENT_REFERENCE_DATASET.version, rows };
}
