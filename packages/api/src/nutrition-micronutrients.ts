import type { Database } from "@openvalens/db";
import {
  nutritionFoodSnapshot,
  nutritionMeal,
  nutritionMealEntry,
} from "@openvalens/db/schema/nutrition";
import type { NutritionScope } from "@openvalens/nutrition";
import { micronutrientsOf } from "@openvalens/nutrition/micronutrients";
import {
  MICRONUTRIENT_POPULATIONS,
  MICRONUTRIENT_REFERENCE_DATASET,
  proposeMicronutrientReference,
} from "@openvalens/nutrition/micronutrient-references";
import { summarizeMicronutrients } from "@openvalens/nutrition/micronutrient-summary";
import { NUTRITION_EXCLUSIONS } from "@openvalens/nutrition/nutrition-safety";
import { and, eq, isNull } from "drizzle-orm";

import type { MicronutrientSummaryWire } from "./contracts/nutrition-micronutrients";
import { loadSafetyContext } from "./nutrition-targets";

/**
 * Micronutrient summary for one local day (Issue #78). Opt-in; hidden for any
 * self-declared exclusion; references only for a confirmed adult who accepted
 * a source and population. Reads the member's own entries only.
 */
export async function readMicronutrientSummary(
  db: Database,
  scope: NutritionScope,
  localDate: string,
  now = new Date(),
): Promise<MicronutrientSummaryWire> {
  const context = await loadSafetyContext(db, scope, { now, readWeight: false });
  const { settings, body } = context;
  const proposal = proposeMicronutrientReference({
    region: context.region,
    sex: body.sex,
    minAge: body.minAge,
    maxAge: body.maxAge,
  });
  const base = {
    localDate,
    datasetVersion: MICRONUTRIENT_REFERENCE_DATASET.version,
    hideNumbers: settings.hideNumbers,
    reference: null,
    referenceNote: null,
    proposal,
    totalEntries: 0,
    rows: [],
  };
  if (!settings.micronutrientsEnabled) return { ...base, status: "off" };
  if (
    settings.declarations.some((key) => (NUTRITION_EXCLUSIONS as readonly string[]).includes(key))
  )
    return { ...base, status: "hidden" };

  const entries = await db
    .select({ nutrientFactor: nutritionMealEntry.nutrientFactor, snapshot: nutritionFoodSnapshot })
    .from(nutritionMealEntry)
    .innerJoin(
      nutritionMeal,
      and(
        eq(nutritionMeal.organizationId, nutritionMealEntry.organizationId),
        eq(nutritionMeal.id, nutritionMealEntry.mealId),
      ),
    )
    .innerJoin(
      nutritionFoodSnapshot,
      and(
        eq(nutritionFoodSnapshot.organizationId, nutritionMealEntry.organizationId),
        eq(nutritionFoodSnapshot.id, nutritionMealEntry.snapshotId),
      ),
    )
    .where(
      and(
        eq(nutritionMealEntry.organizationId, scope.organizationId),
        eq(nutritionMealEntry.userId, scope.userId),
        eq(nutritionMeal.localDate, localDate),
        isNull(nutritionMealEntry.deletedAt),
      ),
    );

  const population = context.adultConfirmed ? settings.micronutrientPopulation : null;
  const summary = summarizeMicronutrients({
    entries: entries.map((entry) => ({
      nutrientFactor: entry.nutrientFactor,
      micronutrients: micronutrientsOf(entry.snapshot),
    })),
    population,
    hideNumbers: settings.hideNumbers,
  });
  const source = population ? MICRONUTRIENT_POPULATIONS[population].source : null;
  const info = source ? MICRONUTRIENT_REFERENCE_DATASET.sources[source] : null;
  return {
    ...base,
    status: "ready",
    reference:
      population && source && info
        ? {
            source,
            sourceOrg: info.org,
            sourceUrl: info.url,
            licenceNote: info.licenceNote,
            population,
            populationLabel: MICRONUTRIENT_POPULATIONS[population].label,
          }
        : null,
    referenceNote: population ? null : context.adultConfirmed ? "not_chosen" : "adults_only",
    totalEntries: entries.length,
    rows: summary.rows.map((row) => ({
      ...row,
      references: row.references.map((reference) => ({
        type: reference.type,
        value: reference.value,
        valueMax: reference.valueMax ?? null,
        appliesTo: reference.appliesTo,
        note: reference.note ?? null,
        document: reference.document,
      })),
    })),
  };
}
