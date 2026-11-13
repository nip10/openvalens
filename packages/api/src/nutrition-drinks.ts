import type { Database } from "@openvalens/db";
import { nutritionCatalogFdcFood } from "@openvalens/db/schema/food-catalog";
import {
  nutritionFoodSnapshot,
  nutritionMeal,
  nutritionMealEntry,
} from "@openvalens/db/schema/nutrition";
import type { NutritionScope } from "@openvalens/nutrition";
import {
  CAFFEINE_REFERENCE,
  DRINK_PRESETS,
  alcoholTotal,
  caffeineReferenceApplies,
  caffeineTotal,
  lastCaffeineAt,
  standardDrinkDefinitionFor,
  standardDrinks,
} from "@openvalens/nutrition/drinks";
import { readNutritionTargetSettings } from "@openvalens/nutrition/targets";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type {
  DrinkPresetsWire,
  DrinkSummaryWire,
  LastCaffeineInput,
  LastCaffeineWire,
} from "./contracts/nutrition-drinks";
import { loadSafetyContext } from "./nutrition-targets";

/**
 * Drinks (Issue #443, part b). Reads the member's own entries only; nothing
 * here writes. A preset is logged through `nutritionDiary.logEntry` like any
 * catalog food, so the diary keeps one write path.
 */

/** Each preset, and whether its FDC food is in this instance's catalog. */
export async function readDrinkPresets(db: Database): Promise<DrinkPresetsWire> {
  const rows = await db
    .select({ fdcId: nutritionCatalogFdcFood.fdcId })
    .from(nutritionCatalogFdcFood)
    .where(
      inArray(
        nutritionCatalogFdcFood.fdcId,
        DRINK_PRESETS.map((entry) => String(entry.fdcId)),
      ),
    );
  const found = new Set(rows.map((row) => row.fdcId));
  return {
    presets: DRINK_PRESETS.map((entry) => ({
      key: entry.key,
      catalogId: entry.catalogId,
      volumeMl: entry.volumeMl,
      amountG: entry.amountG,
      available: found.has(String(entry.fdcId)),
    })),
  };
}

const entryColumns = {
  nutrientFactor: nutritionMealEntry.nutrientFactor,
  caffeineMg: nutritionFoodSnapshot.caffeineMg,
  alcoholG: nutritionFoodSnapshot.alcoholG,
};

function ownEntries(db: Pick<Database, "select">) {
  return {
    async onDay(scope: NutritionScope, localDate: string) {
      return db
        .select(entryColumns)
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
    },

    /** Entries eaten (or, without a picked time, logged) in `[from, to)`. */
    async between(scope: NutritionScope, from: Date, to: Date) {
      const at = sql<Date>`coalesce(${nutritionMealEntry.consumedAt}, ${nutritionMealEntry.createdAt})`;
      return db
        .select({ ...entryColumns, at: at.mapWith(nutritionMealEntry.createdAt) })
        .from(nutritionMealEntry)
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
            isNull(nutritionMealEntry.deletedAt),
            sql`${at} >= ${from.toISOString()}::timestamptz`,
            sql`${at} < ${to.toISOString()}::timestamptz`,
          ),
        );
    },
  };
}

/**
 * The day's opt-in caffeine and alcohol totals. Hide-numbers mode hides both.
 * Every entry of the day counts towards coverage, the same rule as the
 * micronutrient summary: a food that reported no caffeine is unknown, not 0.
 */
export async function readDrinkSummary(
  db: Database,
  scope: NutritionScope,
  localDate: string,
  now = new Date(),
): Promise<DrinkSummaryWire> {
  const context = await loadSafetyContext(db, scope, { now, readWeight: false });
  const { settings } = context;
  const wantCaffeine = settings.caffeineTotalsEnabled;
  const wantAlcohol = settings.alcoholTotalsEnabled;
  const off = { status: "off" as const };
  const hidden = { status: "hidden" as const };
  if (!wantCaffeine && !wantAlcohol) return { localDate, caffeine: off, alcohol: off };
  if (settings.hideNumbers)
    return {
      localDate,
      caffeine: wantCaffeine ? hidden : off,
      alcohol: wantAlcohol ? hidden : off,
    };

  const entries = await ownEntries(db).onDay(scope, localDate);
  const referenceShown = caffeineReferenceApplies({
    adultConfirmed: context.adultConfirmed,
    declarations: settings.declarations,
  });
  const definition = standardDrinkDefinitionFor(context.region);
  const alcohol = alcoholTotal(entries);
  return {
    localDate,
    caffeine: wantCaffeine
      ? {
          status: "ready",
          total: caffeineTotal(entries),
          reference: referenceShown
            ? {
                mgPerDay: CAFFEINE_REFERENCE.mgPerDay,
                org: CAFFEINE_REFERENCE.org,
                document: CAFFEINE_REFERENCE.document,
                url: CAFFEINE_REFERENCE.url,
              }
            : null,
          referenceNote: referenceShown
            ? null
            : context.adultConfirmed
              ? "not_shown"
              : "adults_only",
        }
      : off,
    alcohol: wantAlcohol
      ? {
          status: "ready",
          total: alcohol,
          definition: definition ? { ...definition } : null,
          standardDrinks:
            definition && alcohol.amount !== null
              ? standardDrinks(alcohol.amount, definition)
              : null,
        }
      : off,
  };
}

/**
 * For each night's window, when the member last had something with caffeine.
 * Shown on the sleep view only while the caffeine setting is on; a plain
 * fact, never an insight or a judgement.
 */
export async function readLastCaffeine(
  db: Database,
  scope: NutritionScope,
  input: LastCaffeineInput,
): Promise<LastCaffeineWire> {
  const settings = await readNutritionTargetSettings(db, scope);
  if (!settings.caffeineTotalsEnabled) return { status: "off" };
  if (input.nights.length === 0) return { status: "ready", nights: [] };
  const windows = input.nights.map((night) => ({
    key: night.key,
    from: new Date(night.from),
    to: new Date(night.to),
  }));
  const from = new Date(Math.min(...windows.map((window) => window.from.getTime())));
  const to = new Date(Math.max(...windows.map((window) => window.to.getTime())));
  const entries = await ownEntries(db).between(scope, from, to);
  const timed = entries.map((entry) => ({ ...entry, at: new Date(entry.at) }));
  return {
    status: "ready",
    nights: windows.map((window) => ({
      key: window.key,
      lastCaffeineAt: lastCaffeineAt(timed, window)?.toISOString() ?? null,
    })),
  };
}
