import type { Database } from "@openvalens/db";
import {
  nutritionDiaryDay,
  nutritionFoodSnapshot,
  nutritionMeal,
  nutritionMealEntry,
} from "@openvalens/db/schema/nutrition";
import { and, between, eq, isNull } from "drizzle-orm";

import type { DiaryDayStatus } from "./diary";
import { NutritionError } from "./errors";
import { isLocalDate } from "./local-day";
import { nutrientsOf, scaleNutrients } from "./nutrients";
import type { NutritionScope } from "./repository";
import type { SnapshotSource } from "./snapshot";
import { summarizeEntries, type NutrientSummary, type TotalsFoodSource } from "./totals";

/**
 * Server-computed daily nutrient totals (Issue #79) for one local day or a
 * range of days, e.g. the windows later estimates (#76), observations (#84)
 * and Coach context (#86) read.
 *
 * Each entry's values are its logged snapshot's per-basis values times the
 * entry's stored nutrient factor, so history never follows later catalog or
 * custom-food edits. Only active (not deleted) entries count. Days are the
 * member's own local dates as logged (#74), never recomputed from UTC.
 *
 * Every day in the range is returned, including days with nothing logged,
 * so callers see missing days instead of zero days. Nothing here logs values.
 */

/** Longest range one call may cover (a quarter). Callers page longer windows. */
export const MAX_TOTALS_RANGE_DAYS = 92;

export type DailyTotals = NutrientSummary & {
  localDate: string;
  /** The member's explicit "day complete" marker; `unmarked` days may be partial. */
  status: DiaryDayStatus;
};

// Keeps the presenter-safe source list in step with the snapshot schema.
const sourcesMatch: [SnapshotSource] extends [TotalsFoodSource]
  ? [TotalsFoodSource] extends [SnapshotSource]
    ? true
    : never
  : never = true;
void sourcesMatch;

function dayIndex(localDate: string): number {
  const [year, month, day] = localDate.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / 86_400_000;
}

function dateAt(index: number): string {
  return new Date(index * 86_400_000).toISOString().slice(0, 10);
}

/** Every local date from `from` to `to`, inclusive; validates the range. */
export function localDateRange(from: string, to: string): string[] {
  if (!isLocalDate(from) || !isLocalDate(to))
    throw new NutritionError("INVALID_INPUT", "Local date must be a YYYY-MM-DD calendar date");
  const start = dayIndex(from);
  const end = dayIndex(to);
  if (end < start) throw new NutritionError("INVALID_INPUT", "Range must not end before it starts");
  if (end - start + 1 > MAX_TOTALS_RANGE_DAYS)
    throw new NutritionError(
      "INVALID_INPUT",
      `Range must cover at most ${MAX_TOTALS_RANGE_DAYS} days`,
    );
  return Array.from({ length: end - start + 1 }, (_, offset) => dateAt(start + offset));
}

export function createNutritionTotals(db: Database) {
  return {
    /** Totals for each local day from `from` to `to` (inclusive), oldest first. */
    async listDays(
      scope: NutritionScope,
      range: { from: string; to: string },
    ): Promise<DailyTotals[]> {
      const dates = localDateRange(range.from, range.to);
      const [rows, markers] = await Promise.all([
        db
          .select({
            localDate: nutritionMeal.localDate,
            nutrientFactor: nutritionMealEntry.nutrientFactor,
            snapshot: nutritionFoodSnapshot,
          })
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
              eq(nutritionMeal.userId, scope.userId),
              between(nutritionMeal.localDate, range.from, range.to),
              isNull(nutritionMealEntry.deletedAt),
            ),
          ),
        db
          .select({
            localDate: nutritionDiaryDay.localDate,
            completedAt: nutritionDiaryDay.completedAt,
          })
          .from(nutritionDiaryDay)
          .where(
            and(
              eq(nutritionDiaryDay.organizationId, scope.organizationId),
              eq(nutritionDiaryDay.userId, scope.userId),
              between(nutritionDiaryDay.localDate, range.from, range.to),
            ),
          ),
      ]);

      const byDate = new Map<
        string,
        { nutrients: ReturnType<typeof nutrientsOf>; source: TotalsFoodSource }[]
      >();
      for (const row of rows) {
        const list = byDate.get(row.localDate) ?? [];
        list.push({
          nutrients: scaleNutrients(nutrientsOf(row.snapshot), row.nutrientFactor),
          source: row.snapshot.source,
        });
        byDate.set(row.localDate, list);
      }
      const complete = new Set(
        markers.filter((marker) => marker.completedAt !== null).map((marker) => marker.localDate),
      );
      return dates.map((localDate) => ({
        localDate,
        status: complete.has(localDate) ? "complete" : "unmarked",
        ...summarizeEntries(byDate.get(localDate) ?? []),
      }));
    },

    /** Totals for one local day. */
    async getDay(scope: NutritionScope, localDate: string): Promise<DailyTotals> {
      const [day] = await this.listDays(scope, { from: localDate, to: localDate });
      return day!;
    },
  };
}

export type NutritionTotals = ReturnType<typeof createNutritionTotals>;
