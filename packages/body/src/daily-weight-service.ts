import { lockNutritionSafetyUser, type Database } from "@openvalens/db";
import {
  dailyWeight,
  dailyWeightOverride,
  weightCheckin,
  weightEvent,
} from "@openvalens/db/schema/body";
import { calendarEvent } from "@openvalens/db/schema/plans";
import { isNull } from "drizzle-orm";

export type WriteManualDailyWeightInput = {
  organizationId: string;
  userId: string;
  date: string;
  weightKg: number;
  bodyFatPct: number | null;
  notes: string | null;
  useAsDailyWeight: boolean;
};

/** All four/five writes share the caller's database transaction. No PHI is logged. */
export function createDailyWeightService(db: Database) {
  return {
    async writeManualWeight(input: WriteManualDailyWeightInput) {
      return db.transaction(async (tx) => {
        await lockNutritionSafetyUser(tx, input.userId);
        const [entry] = await tx
          .insert(weightCheckin)
          .values({
            organizationId: input.organizationId,
            date: input.date,
            weightKg: input.weightKg,
            bodyFatPct: input.bodyFatPct,
            notes: input.notes,
          })
          .returning();
        if (!entry) throw new Error("Weight check-in insert did not return a row");

        await tx.insert(calendarEvent).values({
          organizationId: input.organizationId,
          date: input.date,
          type: "weight",
          category: "tracking",
          title: `Weight: ${input.weightKg} kg`,
          referenceTable: "weight_checkin",
          referenceId: entry.id,
        });

        const [createdEvent] = await tx
          .insert(weightEvent)
          .values({
            organizationId: input.organizationId,
            userId: input.userId,
            source: "manual",
            measuredAt: `${input.date}T12:00:00.000Z`,
            date: input.date,
            weightKg: input.weightKg,
            confidence: 0.5,
            metadataJson: { from: "api.weight.manual", weightCheckinId: entry.id },
          })
          .returning({ id: weightEvent.id });
        if (!createdEvent) throw new Error("Weight event insert did not return a row");

        if (input.useAsDailyWeight) {
          await tx
            .insert(dailyWeightOverride)
            .values({
              organizationId: input.organizationId,
              userId: input.userId,
              date: input.date,
              weightKg: input.weightKg,
              reason: "Manual override via /api/weight",
              createdByUserId: input.userId,
              revokedAt: null,
            })
            .onConflictDoUpdate({
              target: [
                dailyWeightOverride.organizationId,
                dailyWeightOverride.userId,
                dailyWeightOverride.date,
              ],
              targetWhere: isNull(dailyWeightOverride.revokedAt),
              set: {
                weightKg: input.weightKg,
                reason: "Manual override via /api/weight",
                createdByUserId: input.userId,
                revokedAt: null,
              },
            });
          await tx
            .insert(dailyWeight)
            .values({
              organizationId: input.organizationId,
              userId: input.userId,
              date: input.date,
              weightKg: input.weightKg,
              source: "override",
              resolvedFromEventId: createdEvent.id,
            })
            .onConflictDoUpdate({
              target: [dailyWeight.organizationId, dailyWeight.userId, dailyWeight.date],
              set: {
                weightKg: input.weightKg,
                source: "override",
                resolvedFromEventId: createdEvent.id,
                updatedAt: new Date().toISOString(),
              },
            });
        }
        return entry;
      });
    },
  };
}
