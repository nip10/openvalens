import type { Database } from "@openvalens/db";
import { goalWaterCutover } from "@openvalens/db/schema/plans";
import { and, eq } from "drizzle-orm";

import {
  GoalWaterLinkConflictError,
  lockGoalOwner,
  reconcileWaterLink,
} from "@openvalens/plans/goal-water-link";
import { NutritionError } from "./errors";
import type { NutritionScope } from "./repository";
import { plainWaterPreference } from "@openvalens/db/schema/nutrition";

/** Resolve current link state under the shared owner lock, then project its
 * effective target onto the requested diary date without changing activation. */
export async function resolvePlainWaterGoal(
  db: Database,
  scope: NutritionScope,
  localDate?: string,
) {
  return db.transaction(async (tx) => {
    await lockGoalOwner(tx, scope);
    let water;
    try {
      water = await reconcileWaterLink(tx, scope, {
        now: new Date(),
        ...(localDate ? { targetDate: localDate } : {}),
      });
    } catch (error) {
      if (error instanceof GoalWaterLinkConflictError)
        throw new NutritionError("CONFLICT", error.message);
      throw error;
    }
    const [preference] = await tx
      .select({
        enabled: plainWaterPreference.enabled,
        personalGoalMl: plainWaterPreference.personalGoalMl,
      })
      .from(plainWaterPreference)
      .where(
        and(
          eq(plainWaterPreference.organizationId, scope.organizationId),
          eq(plainWaterPreference.userId, scope.userId),
        ),
      )
      .limit(1);
    const [cutover] = await tx
      .select({ userId: goalWaterCutover.userId })
      .from(goalWaterCutover)
      .where(
        and(
          eq(goalWaterCutover.organizationId, scope.organizationId),
          eq(goalWaterCutover.userId, scope.userId),
        ),
      )
      .limit(1);

    return {
      enabled: preference?.enabled ?? false,
      legacyPersonalGoalMl: preference?.personalGoalMl ?? null,
      personalGoalMl: water.targetMl,
      personalGoalManagedByGoals: Boolean(cutover) || water.linkedGoalId !== null,
      linkedGoalId: water.linkedGoalId,
    };
  });
}
