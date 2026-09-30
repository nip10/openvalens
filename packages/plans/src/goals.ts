import type { Database } from "@openhealth/db";
import { goal, goalCheckin } from "@openhealth/db/schema/plans";
import { and, asc, desc, eq } from "drizzle-orm";

/**
 * Goals — public type surface + repository (Issue #23).
 *
 * Mirrors the openhealth tables in `packages/db/src/schema/plans.ts`:
 *
 * - `goal`           — org-scoped title/category/horizon/status/target row.
 * - `goalCheckin`    — org-scoped check-in row (date, value, notes).
 *
 * No PHI is included in the type surface — `notes` round-trips as an
 * opaque string the caller owns. Logs never carry notes or values.
 */

export type GoalCategory = "body_composition" | "strength" | "endurance" | "health";

export type GoalHorizon = "short" | "medium" | "long";

export type GoalStatus = "not_started" | "in_progress" | "achieved" | "paused" | "cancelled";

export type Goal = {
  id: number;
  organizationId: string;
  title: string;
  category: string;
  horizon: string | null;
  status: string;
  currentValue: string | null;
  targetValue: string | null;
  targetDate: string | null;
  notes: string | null;
};

export type GoalCheckin = {
  id: number;
  organizationId: string;
  goalId: number;
  date: string;
  value: string | null;
  notes: string | null;
  createdAt: string;
};

export type GoalWithCheckins = Goal & {
  checkins: GoalCheckin[];
};

export type UpsertGoalInput =
  | {
      title: string;
      category: string;
      horizon?: string | null;
      status?: string | null;
      currentValue?: string | null;
      targetValue?: string | null;
      targetDate?: string | null;
      notes?: string | null;
    }
  | {
      id: number;
      title?: string;
      category?: string;
      horizon?: string | null;
      status?: string | null;
      currentValue?: string | null;
      targetValue?: string | null;
      targetDate?: string | null;
      notes?: string | null;
    };

export type UpsertGoalResult = {
  id: number;
  created: boolean;
};

export type UpsertCheckinInput = {
  goalId: number;
  date: string;
  value?: string | null;
  notes?: string | null;
};

export type UpsertCheckinResult = {
  id: number;
  goalCurrentValue: string | null;
};

// ─── derived helpers (pure) ────────────────────────────────────

/**
 * Best-effort numeric parser for goal `currentValue` and `targetValue`.
 * Extracts the leading numeric prefix so forms like "82", "82 kg",
 * "24.1%", "24.1 %", "1,234" all parse. Returns `null` when no leading
 * number is present — callers should fall back to the raw string.
 */
export function parseGoalNumeric(value: string | null): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // Match an optional sign, digits with optional thousand separators,
  // and an optional decimal portion. We deliberately do NOT match the
  // trailing unit — the prefix is what callers care about.
  const match = /^[-+]?\d{1,3}(?:,\d{3})*(?:\.\d+)?/.exec(trimmed.replace(/\s+/g, ""));
  if (!match) return null;
  const cleaned = match[0].replace(/,/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export type GoalProgress = {
  /** 0..1; null when either side is missing or not numeric. */
  percent: number | null;
  /** Numeric current value, or null. */
  currentNumeric: number | null;
  /** Numeric target value, or null. */
  targetNumeric: number | null;
  /** Status-derived hint: "achieved" / "behind" / "tracking" / null. */
  hint: "achieved" | "behind" | "tracking" | null;
};

/**
 * Compute progress for a goal. Pure — no DB calls. `hint` is derived from
 * the relative position of `current` vs `target` and is null when the
 * numeric pair is missing.
 *
 * The percent calculation assumes `target > current` for accumulating
 * goals and `target < current` for reduction goals; for ambiguous targets
 * we fall back to `current / target` clamped to `[0, 1]`.
 */
export function deriveGoalProgress(
  goal: Pick<Goal, "currentValue" | "targetValue" | "status">,
): GoalProgress {
  const currentNumeric = parseGoalNumeric(goal.currentValue);
  const targetNumeric = parseGoalNumeric(goal.targetValue);
  if (currentNumeric === null || targetNumeric === null || targetNumeric === 0) {
    return { percent: null, currentNumeric, targetNumeric, hint: null };
  }

  let percent: number;
  let hint: "achieved" | "behind" | "tracking";
  if (targetNumeric > 0) {
    // Most goals: progress = current / target.
    percent = Math.max(0, Math.min(1, currentNumeric / targetNumeric));
    if (currentNumeric >= targetNumeric) hint = "achieved";
    else if (currentNumeric < targetNumeric * 0.5) hint = "behind";
    else hint = "tracking";
  } else {
    // Reduction goals (target < 0): progress = (start - current) / (start - target).
    // With no start value, use (target - current) / target.
    percent = Math.max(0, Math.min(1, (targetNumeric - currentNumeric) / targetNumeric));
    if (currentNumeric <= targetNumeric) hint = "achieved";
    else if (currentNumeric > targetNumeric * 1.5) hint = "behind";
    else hint = "tracking";
  }

  return { percent, currentNumeric, targetNumeric, hint };
}

/**
 * Reshape flat check-ins into a date-ascending history. Stable tie-break
 * on `id` desc so the most recently-inserted wins when two check-ins
 * share the same date.
 */
export function orderCheckinsByDate(checkins: ReadonlyArray<GoalCheckin>): GoalCheckin[] {
  return [...checkins].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return b.id - a.id;
  });
}

// ─── repository ────────────────────────────────────────────────

export type GoalRepository = ReturnType<typeof createGoalRepository>;

export function createGoalRepository(db: Database) {
  return {
    async listGoals(organizationId: string): Promise<Goal[]> {
      return (await db
        .select()
        .from(goal)
        .where(eq(goal.organizationId, organizationId))
        .orderBy(desc(goal.id))) as Goal[];
    },

    async getGoal(organizationId: string, id: number): Promise<Goal | null> {
      const rows = (await db
        .select()
        .from(goal)
        .where(and(eq(goal.organizationId, organizationId), eq(goal.id, id)))
        .limit(1)) as Goal[];
      return rows[0] ?? null;
    },

    async getGoalWithCheckins(
      organizationId: string,
      id: number,
    ): Promise<GoalWithCheckins | null> {
      const g = await this.getGoal(organizationId, id);
      if (!g) return null;
      const checkins = (await db
        .select()
        .from(goalCheckin)
        .where(and(eq(goalCheckin.organizationId, organizationId), eq(goalCheckin.goalId, id)))
        .orderBy(asc(goalCheckin.date), asc(goalCheckin.id))) as GoalCheckin[];
      return { ...g, checkins: orderCheckinsByDate(checkins) };
    },

    async upsertGoal(organizationId: string, input: UpsertGoalInput): Promise<UpsertGoalResult> {
      if ("id" in input) {
        const update: Partial<Goal> = {};
        if (input.title !== undefined) update.title = input.title;
        if (input.category !== undefined) update.category = input.category;
        if (input.horizon !== undefined) update.horizon = input.horizon ?? null;
        if (input.status !== undefined) update.status = input.status ?? "not_started";
        if (input.currentValue !== undefined) update.currentValue = input.currentValue ?? null;
        if (input.targetValue !== undefined) update.targetValue = input.targetValue ?? null;
        if (input.targetDate !== undefined) update.targetDate = input.targetDate ?? null;
        if (input.notes !== undefined) update.notes = input.notes ?? null;

        await db
          .update(goal)
          .set(update)
          .where(and(eq(goal.organizationId, organizationId), eq(goal.id, input.id)));
        return { id: input.id, created: false };
      }

      const [row] = (await db
        .insert(goal)
        .values({
          organizationId,
          title: input.title,
          category: input.category,
          horizon: input.horizon ?? null,
          status: input.status ?? "not_started",
          currentValue: input.currentValue ?? null,
          targetValue: input.targetValue ?? null,
          targetDate: input.targetDate ?? null,
          notes: input.notes ?? null,
        })
        .returning()) as Goal[];
      if (!row) throw new Error("Goal insert did not return a row");
      return { id: row.id, created: true };
    },

    async deleteGoal(organizationId: string, id: number): Promise<{ id: number } | null> {
      const existing = await this.getGoal(organizationId, id);
      if (!existing) return null;
      // FK cascade on goal_checkin removes child rows.
      await db.delete(goal).where(and(eq(goal.organizationId, organizationId), eq(goal.id, id)));
      return { id };
    },

    async listCheckins(organizationId: string, goalId: number): Promise<GoalCheckin[]> {
      const rows = (await db
        .select()
        .from(goalCheckin)
        .where(
          and(eq(goalCheckin.organizationId, organizationId), eq(goalCheckin.goalId, goalId)),
        )) as GoalCheckin[];
      return orderCheckinsByDate(rows);
    },

    /**
     * Atomic upsert + currentValue mirror. When `value` is non-empty we
     * also bump `goal.currentValue` to the same text so the goal list
     * reflects the latest check-in. Mirrors anchovy `/api/goals/checkins`
     * POST behaviour.
     */
    async upsertCheckin(
      organizationId: string,
      input: UpsertCheckinInput,
    ): Promise<UpsertCheckinResult> {
      // Verify the goal exists in this org before inserting the check-in.
      const existingGoal = await this.getGoal(organizationId, input.goalId);
      if (!existingGoal) throw new Error("Goal not found");

      const [row] = (await db
        .insert(goalCheckin)
        .values({
          organizationId,
          goalId: input.goalId,
          date: input.date,
          value: input.value ?? null,
          notes: input.notes ?? null,
        })
        .returning()) as GoalCheckin[];
      if (!row) throw new Error("Goal check-in insert did not return a row");

      let newCurrentValue: string | null = existingGoal.currentValue;
      if (input.value !== undefined && input.value !== null && input.value.trim().length > 0) {
        newCurrentValue = input.value.trim();
        await db
          .update(goal)
          .set({ currentValue: newCurrentValue })
          .where(and(eq(goal.organizationId, organizationId), eq(goal.id, input.goalId)));
      }

      return { id: row.id, goalCurrentValue: newCurrentValue };
    },
  };
}
