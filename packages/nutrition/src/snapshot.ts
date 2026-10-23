import { createHash } from "node:crypto";

import { NutritionError } from "./errors";
import {
  hasAnyMicronutrient,
  MICRONUTRIENT_KEYS,
  micronutrientsOf,
  normalizeMicronutrients,
  type MicronutrientValues,
} from "./micronutrients";
import {
  NUTRIENT_KEYS,
  normalizeBasis,
  normalizeNutrients,
  nutrientsOf,
  type AmountUnit,
  type NutrientBasis,
  type NutrientValues,
  type ServingSizeUnit,
} from "./nutrients";

/**
 * Immutable food snapshots (Issue #74). An entry never points at a live food
 * or catalog row for its nutrients; it points at a snapshot copied at logging
 * time. Identical content in one organization is stored once (`content_hash`).
 */

export const SNAPSHOT_SOURCES = ["custom", "fdc", "off", "manual"] as const;
export type SnapshotSource = (typeof SNAPSHOT_SOURCES)[number];

/** Sources a caller supplies directly (custom foods are snapshotted from their row). */
export type ExternalSnapshotSource = Exclude<SnapshotSource, "custom">;

/** Everything a snapshot row stores apart from ids and timestamps. */
export type SnapshotContent = {
  source: SnapshotSource;
  sourceFoodId: string | null;
  sourceVersion: string | null;
  customFoodId: number | null;
  attribution: string | null;
  name: string;
  brand: string | null;
  barcode: string | null;
} & NutrientBasis &
  NutrientValues &
  MicronutrientValues;

/**
 * A catalog (`fdc` / `off`, resolved by #72) or one-off `manual` food, as the
 * caller has it at logging time. Omitted nutrients are stored as unknown.
 */
export type ExternalSnapshotInput = {
  source: ExternalSnapshotSource;
  /** Stable id inside the source (FDC id, OFF code). Required for fdc/off, absent for manual. */
  sourceFoodId?: string | null;
  /** Dataset release or modified timestamp of the source record. */
  sourceVersion?: string | null;
  attribution?: string | null;
  name: string;
  brand?: string | null;
  barcode?: string | null;
  nutrientBasisAmount: number;
  nutrientBasisUnit: AmountUnit;
  servingSizeAmount?: number | null;
  servingSizeUnit?: ServingSizeUnit | null;
  servingLabel?: string | null;
  nutrients?: Partial<NutrientValues>;
  /** Optional micronutrients (#78); omitted ones are stored as unknown. */
  micronutrients?: Partial<MicronutrientValues>;
};

/** Source-qualified food identity, e.g. `fdc:123456`, `off:3017620422003`, `custom:42`. */
export function sourceQualifiedId(source: SnapshotSource, sourceFoodId: string): string {
  return `${source}:${sourceFoodId}`;
}

/** Digits-only GTIN/EAN/UPC (8–14 digits) with spaces and hyphens removed; throws otherwise. */
export function normalizeBarcode(raw: string): string {
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^\d{8,14}$/.test(digits))
    throw new NutritionError("INVALID_INPUT", "Barcode must be 8 to 14 digits");
  return digits;
}

export function normalizeName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new NutritionError("INVALID_INPUT", "Food name is required");
  return name;
}

function optionalText(raw: string | null | undefined): string | null {
  return raw?.trim() || null;
}

/** Validates an external snapshot input and returns the full row content. */
export function externalSnapshotContent(input: ExternalSnapshotInput): SnapshotContent {
  if (!(["fdc", "off", "manual"] as const).includes(input.source))
    throw new NutritionError("INVALID_INPUT", "Unsupported snapshot source");
  const sourceFoodId = optionalText(input.sourceFoodId);
  if (input.source === "manual" && sourceFoodId !== null)
    throw new NutritionError("INVALID_INPUT", "Manual foods have no source id");
  if (input.source !== "manual" && sourceFoodId === null)
    throw new NutritionError("INVALID_INPUT", "Catalog foods need a source id");
  return {
    source: input.source,
    sourceFoodId,
    sourceVersion: optionalText(input.sourceVersion),
    customFoodId: null,
    attribution: optionalText(input.attribution),
    name: normalizeName(input.name),
    brand: optionalText(input.brand),
    barcode: input.barcode ? normalizeBarcode(input.barcode) : null,
    ...normalizeBasis(input),
    ...normalizeNutrients(input.nutrients),
    ...normalizeMicronutrients(input.micronutrients),
  };
}

/** Snapshot content for a custom food row at its current revision. */
export function customFoodSnapshotContent(
  food: {
    id: number;
    revision: number;
    name: string;
    brand: string | null;
    barcode: string | null;
  } & NutrientBasis &
    NutrientValues &
    MicronutrientValues,
): SnapshotContent {
  return {
    source: "custom",
    sourceFoodId: String(food.id),
    sourceVersion: String(food.revision),
    customFoodId: food.id,
    attribution: null,
    name: food.name,
    brand: food.brand,
    barcode: food.barcode,
    nutrientBasisAmount: food.nutrientBasisAmount,
    nutrientBasisUnit: food.nutrientBasisUnit,
    servingSizeAmount: food.servingSizeAmount,
    servingSizeUnit: food.servingSizeUnit,
    servingLabel: food.servingLabel,
    ...nutrientsOf(food),
    ...micronutrientsOf(food),
  };
}

const CONTENT_KEYS = [
  "source",
  "sourceFoodId",
  "sourceVersion",
  "customFoodId",
  "attribution",
  "name",
  "brand",
  "barcode",
  "nutrientBasisAmount",
  "nutrientBasisUnit",
  "servingSizeAmount",
  "servingSizeUnit",
  "servingLabel",
  ...NUTRIENT_KEYS,
] as const satisfies readonly (keyof SnapshotContent)[];

/**
 * SHA-256 over the content in a fixed key order. `null` and `0` hash
 * differently, so an unknown nutrient never dedupes into a zero one.
 * Micronutrients (#78) are appended only when at least one is known, so
 * content without them keeps the hash it had before they existed.
 */
export function snapshotContentHash(content: SnapshotContent): string {
  const micronutrients = micronutrientsOf(content);
  const entries: [string, unknown][] = CONTENT_KEYS.map((key) => [key, content[key]]);
  if (hasAnyMicronutrient(micronutrients))
    for (const key of MICRONUTRIENT_KEYS) entries.push([key, micronutrients[key]]);
  const canonical = JSON.stringify(entries);
  return createHash("sha256").update(canonical).digest("hex");
}
