import type { Database } from "@openhealth/db";
import { dailyWeight, weightCheckin, weightEvent } from "@openhealth/db/schema/body";
import { and, desc, eq } from "drizzle-orm";

/** Historical check-ins, intentionally independent of the materialized daily canonical view. */
export async function listLegacyCheckins(db: Database, organizationId: string, limit: number) {
  return db
    .select()
    .from(weightCheckin)
    .where(eq(weightCheckin.organizationId, organizationId))
    .orderBy(desc(weightCheckin.date), desc(weightCheckin.id))
    .limit(limit);
}

/** Reads the materialized canonical daily rows, not raw events or the legacy check-in table. */
export async function listCanonicalDailyWeights(
  db: Database,
  organizationId: string,
  userId: string,
  limit: number,
) {
  return db
    .select({
      id: dailyWeight.id,
      date: dailyWeight.date,
      weightKg: dailyWeight.weightKg,
      source: dailyWeight.source,
      resolvedFromEventId: dailyWeight.resolvedFromEventId,
      confidence: weightEvent.confidence,
      createdAt: dailyWeight.createdAt,
      updatedAt: dailyWeight.updatedAt,
    })
    .from(dailyWeight)
    .leftJoin(
      weightEvent,
      and(
        eq(dailyWeight.resolvedFromEventId, weightEvent.id),
        eq(dailyWeight.organizationId, weightEvent.organizationId),
      ),
    )
    .where(and(eq(dailyWeight.organizationId, organizationId), eq(dailyWeight.userId, userId)))
    .orderBy(desc(dailyWeight.date), desc(dailyWeight.id))
    .limit(limit);
}
