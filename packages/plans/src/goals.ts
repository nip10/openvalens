import type { Database } from "@openvalens/db";
import { goal, goalCheckin } from "@openvalens/db/schema/plans";
import { and, asc, desc, eq } from "drizzle-orm";

/**
 * Goals — public type surface + repository (Issue #23).
 *
 * Mirrors the OpenValens tables in `packages/db/src/schema/plans.ts`:
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

/**
 * Issue #95 — which way counts as progress. A weight goal of 70 kg from 80 kg
 * is a `decrease`; a 5 km run goal from 2 km is an `increase`. Stored
 * nullable: goals created before #95 have none.
 */
export const GOAL_DIRECTIONS = ["increase", "decrease"] as const;
export type GoalDirection = (typeof GOAL_DIRECTIONS)[number];

/** Issue #95 — the person's own weighting for goal progress. Unset = normal. */
export const GOAL_PRIORITIES = ["low", "normal", "high"] as const;
export type GoalPriority = (typeof GOAL_PRIORITIES)[number];

export function isGoalDirection(value: unknown): value is GoalDirection {
  return typeof value === "string" && (GOAL_DIRECTIONS as readonly string[]).includes(value);
}

export function isGoalPriority(value: unknown): value is GoalPriority {
  return typeof value === "string" && (GOAL_PRIORITIES as readonly string[]).includes(value);
}

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
  direction: string | null;
  baselineValue: string | null;
  priority: string | null;
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
      direction?: GoalDirection | null;
      baselineValue?: string | null;
      priority?: GoalPriority | null;
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
      direction?: GoalDirection | null;
      baselineValue?: string | null;
      priority?: GoalPriority | null;
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
 * "24.1%", "9000", "10 000 steps", "1,234" and "72,5 kg" all parse.
 * Returns `null` when no leading number is present — callers should fall
 * back to the raw string.
 *
 * Separators (#313): with both `,` and `.` the last one is the decimal; a
 * separator repeated is grouping; a single one is a decimal unless exactly
 * three digits follow, which is grouping for `,` in en (the default) and for
 * `.` in pt-PT.
 */
export function parseGoalNumeric(
  value: string | null,
  locale: "en" | "pt-PT" = "en",
): number | null {
  if (value === null) return null;
  // Spaces group thousands ("10 000"); the trailing unit is not matched.
  const match = /^[-+]?\d[\d.,]*/.exec(value.trim().replace(/\s+/g, ""));
  if (!match) return null;
  const token = match[0].replace(/[.,]+$/, "");
  const lastComma = token.lastIndexOf(",");
  const lastDot = token.lastIndexOf(".");
  let decimal: "," | "." | null = null;
  if (lastComma !== -1 && lastDot !== -1) {
    decimal = lastComma > lastDot ? "," : ".";
  } else if (lastComma !== -1 || lastDot !== -1) {
    const separator = lastComma !== -1 ? "," : ".";
    const repeated = token.indexOf(separator) !== token.lastIndexOf(separator);
    const threeDigitGroup = /^[-+]?\d{1,3}[.,]\d{3}$/.test(token);
    const groupingSeparator = locale === "pt-PT" ? "." : ",";
    if (!repeated && !(threeDigitGroup && separator === groupingSeparator)) decimal = separator;
  }
  const [whole, fraction] = decimal
    ? [token.slice(0, token.lastIndexOf(decimal)), token.slice(token.lastIndexOf(decimal) + 1)]
    : [token, ""];
  const cleaned =
    whole.replace(/[.,]/g, "") + (fraction ? `.${fraction.replace(/[.,]/g, "")}` : "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export type GoalProgress = {
  /** 0..1; null when it cannot be computed honestly (see `deriveGoalProgress`). */
  percent: number | null;
  /** Numeric current value, or null. */
  currentNumeric: number | null;
  /** Numeric target value, or null. */
  targetNumeric: number | null;
  /** Numeric baseline used for the calculation, or null when none was usable. */
  baselineNumeric: number | null;
  /** Resolved direction, or null when neither set nor inferable. */
  direction: GoalDirection | null;
  /** `set` = stored on the goal; `inferred` = from baseline vs target. */
  directionSource: "set" | "inferred" | null;
  /**
   * True when an `increase` goal has no usable baseline and progress is
   * measured from zero (`current / target`). Callers should say so.
   */
  baselineAssumedZero: boolean;
  /** Status-derived hint: "achieved" / "behind" / "tracking" / null. */
  hint: "achieved" | "behind" | "tracking" | null;
};

/**
 * The direction a goal counts as progress: the stored `direction` when set,
 * otherwise inferred from a baseline on one side of the target (baseline 80,
 * target 70 → `decrease`). Null when neither is available — the caller must
 * not guess, because "current ≥ target" means opposite things for a weight
 * loss and a strength goal.
 */
export function resolveGoalDirection(
  direction: string | null | undefined,
  baselineNumeric: number | null,
  targetNumeric: number | null,
): { direction: GoalDirection | null; source: "set" | "inferred" | null } {
  if (isGoalDirection(direction)) return { direction, source: "set" };
  if (baselineNumeric === null || targetNumeric === null || baselineNumeric === targetNumeric) {
    return { direction: null, source: null };
  }
  return {
    direction: targetNumeric > baselineNumeric ? "increase" : "decrease",
    source: "inferred",
  };
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Compute progress for a goal. Pure — no DB calls.
 *
 * Issue #95 fixed a direction bug: the old rule treated every goal with
 * `current >= target` as achieved, so a weight goal of 70 kg at 80 kg showed
 * as achieved. Progress now needs a direction (stored, or inferred from a
 * baseline). Without one, `percent` and `hint` are null.
 *
 * - With a baseline on the far side of the target, progress is
 *   `(current − baseline) / (target − baseline)`, clamped to [0, 1] (going
 *   past the target counts as 100%, never more).
 * - An `increase` goal without a usable baseline is measured from zero
 *   (`current / target`) and flagged `baselineAssumedZero`.
 * - A `decrease` goal without a usable baseline has no defined starting
 *   point: it is either achieved (current ≤ target) or unscored.
 *
 * `hint` is `achieved` once the target is reached in the goal's direction,
 * `behind` under 50% and `tracking` otherwise.
 */
export function deriveGoalProgress(
  goal: Pick<Goal, "currentValue" | "targetValue" | "status"> &
    Partial<Pick<Goal, "direction" | "baselineValue">>,
): GoalProgress {
  const currentNumeric = parseGoalNumeric(goal.currentValue);
  const targetNumeric = parseGoalNumeric(goal.targetValue);
  const rawBaseline = parseGoalNumeric(goal.baselineValue ?? null);
  const resolved = resolveGoalDirection(goal.direction, rawBaseline, targetNumeric);
  const empty: GoalProgress = {
    percent: null,
    currentNumeric,
    targetNumeric,
    baselineNumeric: null,
    direction: resolved.direction,
    directionSource: resolved.source,
    baselineAssumedZero: false,
    hint: null,
  };
  if (currentNumeric === null || targetNumeric === null || resolved.direction === null) {
    return empty;
  }

  const increase = resolved.direction === "increase";
  // A baseline only defines a starting point when it sits on the far side of
  // the target for this direction.
  const baselineNumeric =
    rawBaseline !== null && (increase ? rawBaseline < targetNumeric : rawBaseline > targetNumeric)
      ? rawBaseline
      : null;
  const achieved = increase ? currentNumeric >= targetNumeric : currentNumeric <= targetNumeric;

  let percent: number | null;
  let baselineAssumedZero = false;
  if (baselineNumeric !== null) {
    percent = clamp01((currentNumeric - baselineNumeric) / (targetNumeric - baselineNumeric));
  } else if (increase && targetNumeric > 0 && currentNumeric >= 0) {
    percent = clamp01(currentNumeric / targetNumeric);
    baselineAssumedZero = true;
  } else {
    percent = achieved ? 1 : null;
  }

  let hint: GoalProgress["hint"] = null;
  if (achieved) hint = "achieved";
  else if (percent !== null) hint = percent < 0.5 ? "behind" : "tracking";

  return { ...empty, percent, baselineNumeric, baselineAssumedZero, hint };
}

export type GoalTrend = "toward_target" | "away_from_target" | "unchanged";

/**
 * Direction of the most recent change between the last two numeric
 * check-ins (date-ascending input). Null with fewer than two numeric values
 * or no direction. `away_from_target` is what goal progress flags as a
 * setback so it cannot hide behind another goal's success.
 */
export function deriveGoalTrend(
  checkins: ReadonlyArray<Pick<GoalCheckin, "value">>,
  direction: GoalDirection | null,
): GoalTrend | null {
  if (direction === null) return null;
  const values = checkins
    .map((checkin) => parseGoalNumeric(checkin.value))
    .filter((value): value is number => value !== null);
  if (values.length < 2) return null;
  const delta = values[values.length - 1]! - values[values.length - 2]!;
  if (delta === 0) return "unchanged";
  return (direction === "increase" ? delta > 0 : delta < 0) ? "toward_target" : "away_from_target";
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
        if (input.direction !== undefined) update.direction = input.direction ?? null;
        if (input.baselineValue !== undefined) update.baselineValue = input.baselineValue ?? null;
        if (input.priority !== undefined) update.priority = input.priority ?? null;

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
          direction: input.direction ?? null,
          baselineValue: input.baselineValue ?? null,
          priority: input.priority ?? null,
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
