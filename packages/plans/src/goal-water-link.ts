import type { DbTransaction } from "@openvalens/db";
import { goal, goalDefinition, goalWaterCutover, goalWaterLink } from "@openvalens/db/schema/plans";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { goalDateAt, goalDefinitionAt } from "./goal-calendar";
import { latestMeasurementContractSuffix } from "./goal-measurement-contract";
import { validateGoalDefinition, type GoalDefinition, type GoalRuleVersion } from "./goal-model";

export type GoalWaterScope = { organizationId: string; userId: string };
export type GoalWaterReconciliation = { linkedGoalId: number | null; targetMl: number | null };
export class GoalWaterLinkConflictError extends Error {}

export async function lockGoalOwner(tx: DbTransaction, scope: GoalWaterScope): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`goal-owner:${scope.organizationId}:${scope.userId}`}, 0))`,
  );
}

/** The single eligibility predicate for Goals-managed plain-water targets. */
export function goalWaterTargetMl(definition: unknown): number | null {
  if (!isRecord(definition) || definition.source !== "water" || definition.metric !== "water_ml")
    return null;
  if (definition.unit !== "ml" || !isRecord(definition.rule)) return null;
  const rule = definition.rule;
  if (rule.kind !== "recurring" || rule.cadence !== "daily" || !isRecord(rule.completion))
    return null;
  const completion = rule.completion;
  if (completion.kind !== "minimum" || typeof completion.value !== "number") return null;
  return Number.isFinite(completion.value) && completion.value > 0 ? completion.value : null;
}

/** Caller owns the transaction and must acquire this owner lock before goal rows. */
export async function reconcileWaterLink(
  tx: DbTransaction,
  scope: GoalWaterScope,
  options: { now: Date; requestedGoalId?: number; targetDate?: string },
): Promise<GoalWaterReconciliation> {
  await lockGoalOwner(tx, scope);

  const goals = await tx
    .select({
      id: goal.id,
      source: goal.source,
      status: goal.status,
      deletedAt: goal.deletedAt,
      definition: goal.definition,
    })
    .from(goal)
    .where(
      and(
        eq(goal.organizationId, scope.organizationId),
        eq(goal.userId, scope.userId),
        eq(goal.source, "water"),
      ),
    )
    .orderBy(asc(goal.id))
    .for("update");
  const goalIds = goals.map((row) => row.id);
  const revisions = goalIds.length
    ? await tx
        .select({
          goalId: goalDefinition.goalId,
          revision: goalDefinition.revision,
          definition: goalDefinition.definition,
          effectiveFrom: goalDefinition.effectiveFrom,
          effectiveUntil: goalDefinition.effectiveUntil,
        })
        .from(goalDefinition)
        .where(
          and(
            eq(goalDefinition.organizationId, scope.organizationId),
            eq(goalDefinition.userId, scope.userId),
            inArray(goalDefinition.goalId, goalIds),
          ),
        )
        .orderBy(asc(goalDefinition.goalId), asc(goalDefinition.revision))
    : [];

  const definitions = new Map<number, GoalDefinition>();
  const histories = new Map<number, typeof revisions>();
  for (const revision of revisions) {
    const entries = histories.get(revision.goalId) ?? [];
    entries.push(revision);
    histories.set(revision.goalId, entries);
  }
  for (const row of goals) {
    const checked = validateGoalDefinition(row.definition);
    if (!checked.ok) continue;
    const history = histories.get(row.id) ?? [];
    const suffix = latestMeasurementContractSuffix(history, checked.value);
    const validatedHistory = new Map<number, GoalDefinition>();
    const versions: GoalRuleVersion[] = [];
    let invalidHistory = false;
    for (const entry of history) {
      const revision = validateGoalDefinition(entry.definition);
      if (!revision.ok) {
        invalidHistory = true;
        break;
      }
      validatedHistory.set(entry.revision, revision.value);
    }
    if (invalidHistory) continue;
    for (const entry of suffix.slice(1)) {
      const revision = validatedHistory.get(entry.revision)!;
      versions.push({
        id: String(entry.revision),
        effectiveDate: entry.effectiveFrom,
        effectiveAt: localBoundaryInstant(
          entry.effectiveFrom,
          revision.timeZone,
          revision.dayCutoff,
        ),
        rule: revision.rule,
        timeZone: revision.timeZone,
        dayCutoff: revision.dayCutoff ?? null,
      });
    }
    const baseline = suffix[0] ? validatedHistory.get(suffix[0].revision) : undefined;
    definitions.set(row.id, {
      ...checked.value,
      ...(baseline
        ? { rule: baseline.rule, timeZone: baseline.timeZone, dayCutoff: baseline.dayCutoff }
        : {}),
      status:
        row.status === "paused"
          ? "paused"
          : row.status === "completed"
            ? "completed"
            : row.deletedAt
              ? "deleted"
              : "active",
      versions,
    });
  }

  const active = (
    await tx
      .select()
      .from(goalWaterLink)
      .where(
        and(
          eq(goalWaterLink.organizationId, scope.organizationId),
          eq(goalWaterLink.userId, scope.userId),
          isNull(goalWaterLink.endedAt),
        ),
      )
      .for("update")
      .limit(1)
  )[0];

  const eligible = goals
    .filter(
      (row) =>
        row.deletedAt === null && (row.status === "not_started" || row.status === "in_progress"),
    )
    .flatMap((row) => {
      const definition = definitions.get(row.id);
      if (!definition) return [];
      const effective = goalDefinitionAt(definition, options.now);
      if (!goalWaterTargetMl(effective) || goalDateAt(effective, options.now) < effective.startDate)
        return [];
      return [{ row, definition }];
    });

  const historicalReference =
    (active && definitions.get(active.goalId)) ||
    eligible[0]?.definition ||
    definitions.values().next().value;
  const historicalRead =
    options.targetDate !== undefined &&
    (!historicalReference || options.targetDate < goalDateAt(historicalReference, options.now));

  let linkedGoalId: number | null = null;
  if (historicalRead) {
    // A backdated diary lookup may project historical revisions for an already
    // linked goal, but must not create, reactivate, end, or cut over a link.
    linkedGoalId =
      active && active.linkedAt.slice(0, 10) <= options.targetDate! ? active.goalId : null;
  } else if (active && eligible.some((candidate) => candidate.row.id === active.goalId)) {
    linkedGoalId = active.goalId;
    if (
      options.requestedGoalId !== undefined &&
      options.requestedGoalId !== linkedGoalId &&
      eligible.some((candidate) => candidate.row.id === options.requestedGoalId)
    )
      throw new GoalWaterLinkConflictError("Another eligible daily water goal is already linked");
  } else {
    if (active) {
      await tx
        .update(goalWaterLink)
        .set({ endedAt: options.now.toISOString() })
        .where(
          and(
            eq(goalWaterLink.organizationId, scope.organizationId),
            eq(goalWaterLink.userId, scope.userId),
            eq(goalWaterLink.goalId, active.goalId),
            isNull(goalWaterLink.endedAt),
          ),
        );
    }

    const requested =
      options.requestedGoalId === undefined
        ? undefined
        : eligible.find((candidate) => candidate.row.id === options.requestedGoalId);
    const selected = requested ?? eligible[0];
    if (requested && eligible[0] && requested.row.id !== eligible[0].row.id)
      throw new GoalWaterLinkConflictError("A lower-id eligible daily water goal has priority");
    if (options.requestedGoalId !== undefined && !requested && eligible.length && !selected)
      throw new GoalWaterLinkConflictError("Requested daily water goal is not eligible");

    if (selected) {
      const ended = (
        await tx
          .select()
          .from(goalWaterLink)
          .where(
            and(
              eq(goalWaterLink.organizationId, scope.organizationId),
              eq(goalWaterLink.userId, scope.userId),
              eq(goalWaterLink.goalId, selected.row.id),
              isNotNull(goalWaterLink.endedAt),
            ),
          )
          .for("update")
          .limit(1)
      )[0];
      if (ended) {
        const restored = await tx
          .update(goalWaterLink)
          .set({ endedAt: null })
          .where(
            and(
              eq(goalWaterLink.organizationId, scope.organizationId),
              eq(goalWaterLink.userId, scope.userId),
              eq(goalWaterLink.goalId, selected.row.id),
              isNotNull(goalWaterLink.endedAt),
            ),
          )
          .returning({ goalId: goalWaterLink.goalId });
        if (!restored.length)
          throw new GoalWaterLinkConflictError("Daily water goal link changed concurrently");
      } else {
        const inserted = await tx
          .insert(goalWaterLink)
          .values({ ...scope, goalId: selected.row.id })
          .onConflictDoNothing()
          .returning({ goalId: goalWaterLink.goalId });
        if (!inserted.length) {
          const winner = (
            await tx
              .select({ goalId: goalWaterLink.goalId })
              .from(goalWaterLink)
              .where(
                and(
                  eq(goalWaterLink.organizationId, scope.organizationId),
                  eq(goalWaterLink.userId, scope.userId),
                  isNull(goalWaterLink.endedAt),
                ),
              )
              .limit(1)
          )[0];
          if (!winner)
            throw new GoalWaterLinkConflictError("Daily water goal link could not be acquired");
          if (options.requestedGoalId !== undefined && winner.goalId !== options.requestedGoalId)
            throw new GoalWaterLinkConflictError("Another daily water goal is already linked");
          linkedGoalId = winner.goalId;
        }
      }
      linkedGoalId ??= selected.row.id;
    }
  }

  if (
    options.requestedGoalId !== undefined &&
    eligible.some((candidate) => candidate.row.id === options.requestedGoalId) &&
    linkedGoalId !== options.requestedGoalId
  )
    throw new GoalWaterLinkConflictError("Another daily water goal is already linked");

  if (!historicalRead && goals.length)
    await tx.insert(goalWaterCutover).values(scope).onConflictDoNothing();
  if (linkedGoalId === null) return { linkedGoalId: null, targetMl: null };
  const linkedDefinition = definitions.get(linkedGoalId);
  if (!linkedDefinition) return { linkedGoalId, targetMl: null };
  const targetDate = options.targetDate ?? goalDateAt(linkedDefinition, options.now);
  if (targetDate < linkedDefinition.startDate) return { linkedGoalId, targetMl: null };

  const history = histories.get(linkedGoalId) ?? [];
  const contractHistory = latestMeasurementContractSuffix(history, linkedDefinition);
  const historical = contractHistory
    .filter(
      (revision) =>
        revision.effectiveFrom <= targetDate &&
        (revision.effectiveUntil === null || revision.effectiveUntil > targetDate),
    )
    .at(-1);
  if (history.length && !historical) return { linkedGoalId, targetMl: null };
  const targetDefinition = historical
    ? validateGoalDefinition(historical.definition)
    : validateGoalDefinition(linkedDefinition);
  return {
    linkedGoalId,
    targetMl: targetDefinition.ok ? goalWaterTargetMl(targetDefinition.value) : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function localBoundaryInstant(date: string, timeZone: string, cutoff: string | null | undefined) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = (cutoff ?? "00:00").split(":").map(Number);
  const desired = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  let guess = desired;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (let iteration = 0; iteration < 3; iteration++) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    const delta = desired - represented;
    if (!delta) break;
    guess += delta;
  }
  return new Date(guess).toISOString();
}
