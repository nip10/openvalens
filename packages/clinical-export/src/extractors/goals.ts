// Source: anchovy/apps/web/src/lib/export/extractors/goals.ts
// Goals extractor — joins goals with their check-ins. The plans repository
// already returns goals + checkins via `listGoalsWithCheckins` style aggregations,
// but here we project the anchor's row shape directly: each goal with its
// `checkins` array.
import type { Database } from "@openvalens/db";
import { goal, goalCheckin } from "@openvalens/db/schema/plans";
import { desc, eq, inArray } from "drizzle-orm";
import type { ExportPayloadDataByDomain } from "../types";
import type { ExportPayloadScope } from "../build-payload";

export async function extractGoals(
  db: Database,
  scope: ExportPayloadScope,
): Promise<ExportPayloadDataByDomain["goals"]> {
  const goals = await db
    .select()
    .from(goal)
    .where(eq(goal.organizationId, scope.organizationId))
    .orderBy(desc(goal.id));

  if (goals.length === 0) return [];

  const goalIds = goals.map((item) => item.id);
  const checkins = await db
    .select({
      id: goalCheckin.id,
      goalId: goalCheckin.goalId,
      date: goalCheckin.date,
      value: goalCheckin.value,
      notes: goalCheckin.notes,
    })
    .from(goalCheckin)
    .where(inArray(goalCheckin.goalId, goalIds))
    .orderBy(desc(goalCheckin.date), desc(goalCheckin.id));

  const checkinsByGoalId = new Map<
    number,
    Array<{ id: number; date: string; value: string | null; notes: string | null }>
  >();
  for (const checkin of checkins) {
    const value = {
      id: checkin.id,
      date: checkin.date,
      value: checkin.value,
      notes: checkin.notes,
    };
    const bucket = checkinsByGoalId.get(checkin.goalId);
    if (bucket) {
      bucket.push(value);
    } else {
      checkinsByGoalId.set(checkin.goalId, [value]);
    }
  }

  return goals.map((item) => ({
    id: item.id,
    title: item.title,
    category: item.category,
    horizon: item.horizon,
    status: item.status,
    currentValue: item.currentValue,
    targetValue: item.targetValue,
    targetDate: item.targetDate,
    notes: item.notes,
    checkins: checkinsByGoalId.get(item.id) ?? [],
  }));
}
