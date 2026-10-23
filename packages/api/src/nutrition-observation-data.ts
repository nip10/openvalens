import type { Database } from "@openvalens/db";
import { healthEvent, dataSource } from "@openvalens/db/schema/health-record";
import {
  nutritionDiaryDay,
  nutritionMeal,
  nutritionMealEntry,
} from "@openvalens/db/schema/nutrition";
import { providerConnection } from "@openvalens/db/schema/ingestion";
import { readUserLocale, serverI18n } from "@openvalens/i18n/server";
import { and, eq, gte, inArray, isNull, lt, isNotNull } from "drizzle-orm";

import {
  buildNutritionObservations,
  type MemberMealRecord,
  type MemberSleepRecord,
  type MemberWorkoutRecord,
  type NutritionObservation,
  type ObservationWindow,
} from "./nutrition-observations";

export type NutritionObservationScope = { organizationId: string; userId: string };
export type NutritionObservationAccess = {
  optedIn: boolean;
  nutrition: boolean;
  sleep: boolean;
  activity: boolean;
  hideNumbers: boolean;
};

/**
 * Reads only permitted modules and always applies both organization and member
 * scope. Health events without an explicitly user-owned provider connection
 * are excluded because their member ownership cannot be established.
 */
export async function loadNutritionObservations(
  db: Database,
  scope: NutritionObservationScope,
  window: ObservationWindow,
  access: NutritionObservationAccess,
): Promise<NutritionObservation[]> {
  if (!access.optedIn || !access.nutrition) return [];
  const from = new Date(`${window.from}T00:00:00.000Z`);
  const until = new Date(`${window.to}T00:00:00.000Z`);
  until.setUTCDate(until.getUTCDate() + 1);
  const meals: MemberMealRecord[] = [];
  const sleep: MemberSleepRecord[] = [];
  const workouts: MemberWorkoutRecord[] = [];

  if (access.sleep || access.activity) {
    const types = [
      ...(access.sleep ? ["sleep_session"] : []),
      ...(access.activity ? ["workout"] : []),
    ];
    const events = await db
      .select({
        eventType: healthEvent.eventType,
        eventAt: healthEvent.eventAt,
        payloadJson: healthEvent.payloadJson,
      })
      .from(healthEvent)
      .innerJoin(
        dataSource,
        and(
          eq(dataSource.organizationId, healthEvent.organizationId),
          eq(dataSource.id, healthEvent.dataSourceId),
        ),
      )
      .innerJoin(
        providerConnection,
        and(
          eq(providerConnection.organizationId, dataSource.organizationId),
          eq(providerConnection.id, dataSource.providerConnectionId),
        ),
      )
      .where(
        and(
          eq(healthEvent.organizationId, scope.organizationId),
          eq(providerConnection.userId, scope.userId),
          isNull(healthEvent.supersededAt),
          gte(healthEvent.eventAt, from),
          lt(healthEvent.eventAt, until),
          // Constructed only from the trusted access flags above.
          inArray(healthEvent.eventType, types),
        ),
      );
    for (const event of events) {
      const payload = event.payloadJson;
      const endAt =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>).endAt
          : undefined;
      const eventTime = event.eventAt.getTime();
      const endTime =
        typeof endAt === "string" && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(endAt)
          ? Date.parse(endAt)
          : Number.NaN;
      if (
        event.eventType === "sleep_session" &&
        access.sleep &&
        Number.isFinite(eventTime) &&
        Number.isFinite(endTime) &&
        endTime > eventTime
      )
        sleep.push({
          memberId: scope.userId,
          startedAt: event.eventAt.toISOString(),
          complete: true,
        });
      const activity =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>).activity
          : undefined;
      if (
        event.eventType === "workout" &&
        access.activity &&
        Number.isFinite(eventTime) &&
        Number.isFinite(endTime) &&
        endTime > eventTime &&
        typeof activity === "string" &&
        activity.trim().length > 0
      )
        workouts.push({
          memberId: scope.userId,
          startedAt: event.eventAt.toISOString(),
          complete: true,
        });
    }
  }

  if (access.nutrition) {
    const rows = await db
      .select({ consumedAt: nutritionMealEntry.consumedAt })
      .from(nutritionMealEntry)
      .innerJoin(
        nutritionMeal,
        and(
          eq(nutritionMeal.organizationId, nutritionMealEntry.organizationId),
          eq(nutritionMeal.userId, nutritionMealEntry.userId),
          eq(nutritionMeal.id, nutritionMealEntry.mealId),
        ),
      )
      .innerJoin(
        nutritionDiaryDay,
        and(
          eq(nutritionDiaryDay.organizationId, nutritionMeal.organizationId),
          eq(nutritionDiaryDay.userId, nutritionMeal.userId),
          eq(nutritionDiaryDay.localDate, nutritionMeal.localDate),
        ),
      )
      .where(
        and(
          eq(nutritionMealEntry.organizationId, scope.organizationId),
          eq(nutritionMealEntry.userId, scope.userId),
          isNull(nutritionMealEntry.deletedAt),
          isNotNull(nutritionMealEntry.consumedAt),
          isNotNull(nutritionDiaryDay.completedAt),
          gte(nutritionMealEntry.consumedAt, from),
          lt(nutritionMealEntry.consumedAt, until),
        ),
      );
    for (const row of rows)
      meals.push({
        memberId: scope.userId,
        consumedAt: row.consumedAt?.toISOString() ?? null,
        complete: true,
      });
  }

  return buildNutritionObservations({
    i18n: serverI18n(await readUserLocale(db, scope.userId)),
    memberId: scope.userId,
    window,
    optedIn: access.optedIn,
    permissions: { nutrition: access.nutrition, sleep: access.sleep, activity: access.activity },
    hideNumbers: access.hideNumbers,
    meals,
    sleep,
    workouts,
  });
}
