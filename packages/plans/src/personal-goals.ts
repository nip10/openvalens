import { createHash, randomUUID } from "node:crypto";
import type { Database, DbTransaction } from "@openvalens/db";
import {
  goal,
  goalCheckin,
  goalDefinition,
  goalLifecycle,
  goalMilestone,
  goalMutation,
  goalOwnershipAssignment,
  supplement,
  supplementIntake,
  workout,
  workoutExercise,
  workoutSet,
} from "@openvalens/db/schema/plans";
import { member } from "@openvalens/db/schema/auth";
import { exercise } from "@openvalens/db/schema/exercises";
import { plainWaterEntry } from "@openvalens/db/schema/nutrition";
import { customTracker, customTrackerEntry } from "@openvalens/db/schema/trackers";
import type { TrackerAggregation, TrackerType } from "@openvalens/trackers/model";
import { and, asc, desc, eq, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { evaluateGoal, type GoalEvaluation } from "./goal-evaluation";
import { goalDateAt, goalDefinitionAt } from "./goal-calendar";
import {
  latestMeasurementContractSuffix,
  sameMeasurementContract,
} from "./goal-measurement-contract";
import { GoalWaterLinkConflictError, lockGoalOwner, reconcileWaterLink } from "./goal-water-link";
import {
  trackerGoalEvidence,
  trackerGoalProblem,
  trackerIdFromGoalMetric,
  type TrackerGoalShape,
} from "./goal-tracker";
import {
  isIsoDate,
  isIsoInstant,
  validateGoalDefinition,
  type GoalComparator,
  type GoalDefinition,
  type GoalEvidence,
  type GoalLifecycleStatus,
  type GoalPause,
  type GoalRule,
  type GoalRuleVersion,
} from "./goal-model";

export type GoalSummary = {
  id: number;
  version: number;
  title: string;
  definition: GoalDefinition;
  evaluation: GoalEvaluation;
  /** Durable source-evidence latch; optional only for older persisted API receipts. */
  sourceLocked?: boolean;
};
export type GoalCheckinHistory = {
  id: number;
  version: number;
  date: string;
  value: number | null;
  completed: boolean | null;
  notes: string | null;
  deletedAt: string | null;
  correctedFromId: number | null;
};
export type GoalDetail = GoalSummary & {
  checkins: Array<Omit<GoalCheckinHistory, "deletedAt" | "correctedFromId">>;
  checkinHistory: GoalCheckinHistory[];
  evidence: GoalEvidence[];
  history: Array<{
    revision: number;
    definition: GoalDefinition;
    effectiveFrom: string;
    effectiveUntil: string | null;
  }>;
  replacement: { replacesId: number | null; replacedById: number | null };
};
export class PersonalGoalNotFoundError extends Error {}
export class PersonalGoalConflictError extends Error {}
export class PersonalGoalValidationError extends Error {}
export class PersonalGoalConfigurationError extends Error {}

const completionValue = (completed: boolean, value?: number) =>
  `@goal-evidence:${JSON.stringify({ completed, ...(value === undefined ? {} : { value }) })}`;
const readCheckin = (
  stored: string | null,
): { value: number | null; completed: boolean | null } => {
  if (stored?.startsWith("@goal-evidence:")) {
    try {
      const decoded = JSON.parse(stored.slice("@goal-evidence:".length)) as {
        completed?: unknown;
        value?: unknown;
      };
      return {
        value:
          typeof decoded.value === "number" && Number.isFinite(decoded.value)
            ? decoded.value
            : null,
        completed: typeof decoded.completed === "boolean" ? decoded.completed : null,
      };
    } catch {
      return { value: null, completed: null };
    }
  }
  if (stored?.startsWith("@goal-completed:"))
    return { value: null, completed: stored.endsWith("true") };
  return { value: stored == null ? null : Number(stored), completed: null };
};
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.entries(v as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
};
const fingerprint = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
type PersonalGoalTransaction = DbTransaction;
type PersonalGoalQueryDb = Database | DbTransaction;
type MutationUuid = `${string}-${string}-${string}-${string}-${string}`;
const mutationUuid = (value: string): MutationUuid => value as MutationUuid;
function plusDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function nextWeekday(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return plusDays(date, day === 1 ? 7 : (8 - day) % 7);
}
function localBoundaryInstant(
  date: string,
  zone: string,
  cutoff: string | null | undefined,
): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = (cutoff ?? "00:00").split(":").map(Number);
  const desired = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  let guess = desired;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map((p) => [p.type, p.value]),
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    guess += desired - represented;
  }
  return new Date(guess).toISOString();
}
function targetRule(rule: GoalDefinition["rule"]) {
  return rule.kind === "target" || rule.kind === "average"
    ? rule.target
    : rule.kind === "streak"
      ? rule.target
      : null;
}
function checkExactKeys(value: unknown, allowed: readonly string[], path: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length)
    throw new PersonalGoalValidationError(`${path || "definition"} contains unsupported fields`);
}
function stricterTarget(before: GoalDefinition["rule"], after: GoalDefinition["rule"]): boolean {
  if (before.kind !== after.kind) return true;
  if (before.kind === "streak" && after.kind === "streak" && after.targetDays > before.targetDays)
    return true;
  const a = targetRule(before),
    b = targetRule(after);
  if ((a && !b) || (!a && b)) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return true;
  if (a.kind === "minimum" && b.kind === "minimum") return b.value > a.value;
  if (a.kind === "maximum" && b.kind === "maximum") return b.value < a.value;
  if (a.kind === "range" && b.kind === "range")
    return (
      b.minimum >= a.minimum &&
      b.maximum <= a.maximum &&
      (b.minimum > a.minimum || b.maximum < a.maximum)
    );
  return false;
}

/** Owner-scoped repository. clientMutationId receipts and every side effect share one transaction. */
export function createPersonalGoalRepository(
  db: Database,
  organizationId: string,
  userId: string,
  sleepEvidence?: (input: {
    startDate: string;
    endDate: string;
    timeZone: string;
  }) => Promise<Array<{ date: string; minutes: number; wakeAt: string; sessionIds: string[] }>>,
  clock: () => Date = () => new Date(),
  onMutation?: (
    tx: PersonalGoalTransaction,
    operation: string,
    targetId: number | null,
  ) => Promise<void>,
) {
  if (!organizationId || !userId)
    throw new TypeError("Organization and authenticated user are required");
  const ownerWhere = (id?: number) =>
    and(
      eq(goal.organizationId, organizationId),
      eq(goal.userId, userId),
      ...(id === undefined ? [] : [eq(goal.id, id)]),
    );
  const liveGoalWhere = (id?: number) => and(ownerWhere(id), isNull(goal.deletedAt));

  async function mutate<T>(
    operation: string,
    clientMutationId: string,
    payload: unknown,
    apply: (tx: PersonalGoalTransaction) => Promise<{ result: T; targetId: number | null }>,
  ): Promise<T> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        clientMutationId,
      )
    )
      throw new PersonalGoalValidationError("clientMutationId must be a UUID");
    const receiptId = mutationUuid(clientMutationId);
    const digest = fingerprint({ operation, payload });
    try {
      return await db.transaction(async (tx) => {
        const lockKey = `${organizationId}:${userId}:${clientMutationId}`;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
        const receipt = (
          await tx
            .select()
            .from(goalMutation)
            .where(
              and(
                eq(goalMutation.organizationId, organizationId),
                eq(goalMutation.userId, userId),
                eq(goalMutation.clientMutationId, receiptId),
              ),
            )
            .limit(1)
        )[0];
        if (receipt) {
          if (receipt.operation !== operation || receipt.fingerprint !== digest)
            throw new PersonalGoalConflictError(
              "clientMutationId was already used for a different mutation",
            );
          return receipt.result as T;
        }
        await lockGoalOwner(tx, { organizationId, userId });
        await tx
          .select({ id: goal.id })
          .from(goal)
          .where(and(eq(goal.organizationId, organizationId), eq(goal.userId, userId)))
          .orderBy(asc(goal.id))
          .for("update");
        const applied = await apply(tx);
        if (
          applied.targetId !== null &&
          ["configureLegacy", "create", "delete", "setStatus", "update"].includes(operation)
        )
          await reconcileWaterLink(
            tx,
            { organizationId, userId },
            {
              now: clock(),
              requestedGoalId: applied.targetId,
            },
          );
        if (onMutation) await onMutation(tx, operation, applied.targetId);
        await tx.insert(goalMutation).values({
          organizationId,
          userId,
          clientMutationId: receiptId,
          operation,
          targetId: applied.targetId,
          fingerprint: digest,
          result: applied.result as object,
        });
        return applied.result;
      });
    } catch (error) {
      if (error instanceof GoalWaterLinkConflictError)
        throw new PersonalGoalConflictError(error.message);
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === "23505"
      )
        throw new PersonalGoalConflictError("A conflicting goal or water link already exists");
      throw error;
    }
  }

  async function readDefinition(
    row: typeof goal.$inferSelect,
    queryDb: PersonalGoalQueryDb = db,
  ): Promise<GoalDefinition> {
    const baseResult = validateGoalDefinition(row.definition);
    if (!baseResult.ok)
      throw new PersonalGoalConfigurationError(
        "Stored goal definition is invalid; contact support",
      );
    const base = baseResult.value;
    const history = await queryDb
      .select()
      .from(goalDefinition)
      .where(
        and(
          eq(goalDefinition.organizationId, organizationId),
          eq(goalDefinition.userId, userId),
          eq(goalDefinition.goalId, row.id),
        ),
      )
      .orderBy(asc(goalDefinition.revision));
    const suffix = latestMeasurementContractSuffix(history, base);
    const validatedHistory = new Map<number, GoalDefinition>();
    for (const entry of history) {
      const checked = validateGoalDefinition(entry.definition);
      if (!checked.ok)
        throw new PersonalGoalConfigurationError(
          "Stored goal revision is invalid; contact support",
        );
      validatedHistory.set(entry.revision, checked.value);
    }
    const baseline = suffix[0] ? validatedHistory.get(suffix[0].revision) : undefined;
    const versions: GoalRuleVersion[] = [];
    for (const entry of suffix.slice(1)) {
      const revision = validatedHistory.get(entry.revision)!;
      versions.push({
        id: String(entry.revision),
        effectiveDate: entry.effectiveFrom,
        rule: revision.rule,
        timeZone: revision.timeZone,
        dayCutoff: revision.dayCutoff ?? null,
        effectiveAt: localBoundaryInstant(
          entry.effectiveFrom,
          revision.timeZone,
          revision.dayCutoff,
        ),
      });
    }
    const lifecycle = await queryDb
      .select()
      .from(goalLifecycle)
      .where(
        and(
          eq(goalLifecycle.organizationId, organizationId),
          eq(goalLifecycle.userId, userId),
          eq(goalLifecycle.goalId, row.id),
        ),
      )
      .orderBy(asc(goalLifecycle.id));
    const pauses: GoalPause[] = [];
    for (const event of lifecycle) {
      if (
        event.event === "paused" &&
        event.effectiveDate &&
        !pauses.some((p) => p.endDate === null)
      )
        pauses.push({
          startDate: event.effectiveDate,
          endDate: null,
          ...(isIsoInstant(event.occurredAt) ? { pausedAt: event.occurredAt } : {}),
        });
      if ((event.event === "resumed" || event.event === "reopened") && event.effectiveDate) {
        const active = [...pauses].reverse().find((p) => p.endDate === null);
        if (active) {
          active.endDate =
            event.effectiveDate <= active.startDate
              ? active.startDate
              : plusDays(event.effectiveDate, -1);
          active.resumedOn = event.effectiveDate;
          if (isIsoInstant(event.occurredAt)) active.resumedAt = event.occurredAt;
        }
      }
    }
    const validated = validateGoalDefinition({
      ...base,
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
      pauses,
    });
    if (!validated.ok)
      throw new PersonalGoalConfigurationError("Stored goal history is invalid; contact support");
    return validated.value;
  }

  /** The member's own tracker a `tracker:<id>` metric names; never another member's. */
  async function ownTracker(
    queryDb: PersonalGoalQueryDb,
    metric: string,
  ): Promise<(TrackerGoalShape & { id: string }) | null> {
    const trackerId = trackerIdFromGoalMetric(metric);
    if (!trackerId) return null;
    const row = (
      await queryDb
        .select({
          id: customTracker.id,
          type: customTracker.type,
          unit: customTracker.unit,
          aggregation: customTracker.aggregation,
        })
        .from(customTracker)
        .where(
          and(
            eq(customTracker.organizationId, organizationId),
            eq(customTracker.userId, userId),
            eq(customTracker.id, trackerId),
          ),
        )
        .limit(1)
    )[0];
    return row
      ? {
          id: row.id,
          type: row.type as TrackerType,
          unit: row.unit,
          aggregation: row.aggregation as TrackerAggregation,
        }
      : null;
  }
  async function collectEvidence(
    queryDb: PersonalGoalQueryDb,
    def: GoalDefinition,
    id: number,
    asOf: string,
  ): Promise<GoalEvidence[]> {
    const evidence: GoalEvidence[] = [];
    if (def.source === "manual") {
      const rows = await queryDb
        .select()
        .from(goalCheckin)
        .where(
          and(
            eq(goalCheckin.organizationId, organizationId),
            eq(goalCheckin.userId, userId),
            eq(goalCheckin.goalId, id),
            isNull(goalCheckin.deletedAt),
          ),
        )
        .orderBy(asc(goalCheckin.date), asc(goalCheckin.id));
      for (const c of rows.filter((c) => c.date >= def.startDate && c.date <= asOf)) {
        const value = readCheckin(c.value);
        evidence.push({
          id: String(c.id),
          source: "manual",
          metric: def.metric,
          dateOnly: c.date,
          ...(value.value === null ? {} : { value: value.value }),
          ...(value.completed === null ? {} : { completed: value.completed }),
        });
      }
    } else if (def.source === "water" && def.metric === "water_ml") {
      const rows = await queryDb
        .select()
        .from(plainWaterEntry)
        .where(
          and(
            eq(plainWaterEntry.organizationId, organizationId),
            eq(plainWaterEntry.userId, userId),
            isNull(plainWaterEntry.deletedAt),
          ),
        );
      evidence.push(
        ...rows
          .filter((w) => {
            const date = goalDateAt(def, w.observedAt);
            return w.observedAt <= clock() && date >= def.startDate && date <= asOf;
          })
          .map((w) => ({
            id: `water:${w.id}`,
            source: "water" as const,
            metric: "water_ml",
            occurredAt: w.observedAt.toISOString(),
            value: w.quantityMl,
            sourceRecordId: String(w.id),
          })),
      );
    } else if (def.source === "supplement" && /^supplement:[1-9]\d*$/.test(def.metric)) {
      const supplementId = Number(def.metric.slice("supplement:".length));
      const rows = await queryDb
        .select()
        .from(supplementIntake)
        .where(
          and(
            eq(supplementIntake.organizationId, organizationId),
            eq(supplementIntake.userId, userId),
            eq(supplementIntake.supplementId, supplementId),
            isNull(supplementIntake.deletedAt),
          ),
        );
      evidence.push(
        ...rows
          .filter((i) => i.occurredAt <= clock() && goalDateAt(def, i.occurredAt) >= def.startDate)
          .map((i) => ({
            id: `intake:${i.id}`,
            source: "supplement" as const,
            metric: def.metric,
            occurredAt: i.occurredAt.toISOString(),
            value: 1,
            completed: true,
            sourceRecordId: String(i.id),
          })),
      );
    } else if (def.source === "workout" && /^exercise:[1-9]\d*$/.test(def.metric)) {
      const exerciseId = Number(def.metric.slice("exercise:".length));
      const sets = await queryDb
        .select({
          workoutId: workout.id,
          date: workout.date,
          setId: workoutSet.id,
          reps: workoutSet.reps,
          weightKg: workoutSet.weightKg,
        })
        .from(workout)
        .innerJoin(
          workoutExercise,
          and(
            eq(workoutExercise.organizationId, workout.organizationId),
            eq(workoutExercise.workoutId, workout.id),
          ),
        )
        .innerJoin(
          workoutSet,
          and(
            eq(workoutSet.organizationId, workout.organizationId),
            eq(workoutSet.exerciseId, workoutExercise.id),
          ),
        )
        .where(
          and(
            eq(workout.organizationId, organizationId),
            eq(workout.userId, userId),
            eq(workoutExercise.exerciseId, exerciseId),
          ),
        );
      evidence.push(
        ...sets
          .filter(
            (s) =>
              s.date >= def.startDate &&
              s.date <= asOf &&
              s.reps != null &&
              s.reps >= 1 &&
              s.weightKg != null,
          )
          .map((s) => ({
            id: `workout:${s.workoutId}:set:${s.setId}`,
            source: "workout" as const,
            metric: def.metric,
            dateOnly: s.date,
            value: s.weightKg!,
            authoritative: true,
            sourceRecordId: String(s.setId),
          })),
      );
    } else if (def.source === "tracker") {
      const tracker = await ownTracker(queryDb, def.metric);
      if (tracker) {
        const rows = await queryDb
          .select({
            id: customTrackerEntry.id,
            value: customTrackerEntry.value,
            loggedAt: customTrackerEntry.loggedAt,
            localDate: customTrackerEntry.localDate,
          })
          .from(customTrackerEntry)
          .where(
            and(
              eq(customTrackerEntry.organizationId, organizationId),
              eq(customTrackerEntry.userId, userId),
              eq(customTrackerEntry.trackerId, tracker.id),
              gte(customTrackerEntry.localDate, def.startDate),
              lte(customTrackerEntry.localDate, asOf),
              lte(customTrackerEntry.loggedAt, clock()),
            ),
          );
        evidence.push(...trackerGoalEvidence({ metric: def.metric, tracker, entries: rows }));
      }
    } else if (def.source === "sleep" && def.metric === "sleep_hours" && sleepEvidence) {
      const revisions = [
        def,
        ...(def.versions ?? []).map((v) => ({
          ...def,
          timeZone: v.timeZone ?? def.timeZone,
          dayCutoff: v.dayCutoff ?? def.dayCutoff,
        })),
      ];
      const uniqueZones = [...new Set(revisions.map((r) => r.timeZone))];
      const seen = new Set<string>();
      for (const timeZone of uniqueZones) {
        const days = await sleepEvidence({ startDate: def.startDate, endDate: asOf, timeZone });
        for (const day of days) {
          const identity = [...day.sessionIds].sort().join(",") || `${day.date}:${day.wakeAt}`;
          if (
            seen.has(identity) ||
            day.date > asOf ||
            !isIsoInstant(day.wakeAt) ||
            Date.parse(day.wakeAt) > clock().getTime()
          )
            continue;
          const wakeInstant = Date.parse(day.wakeAt);
          const activeCalendar = [...(def.versions ?? [])]
            .filter(
              (v) =>
                v.timeZone !== undefined &&
                v.effectiveAt &&
                Date.parse(v.effectiveAt) <= wakeInstant,
            )
            .sort((a, b) => Date.parse(a.effectiveAt!) - Date.parse(b.effectiveAt!))
            .at(-1);
          if (timeZone !== (activeCalendar?.timeZone ?? def.timeZone)) continue;
          seen.add(identity);
          evidence.push({
            id: `sleep:${identity}`,
            source: "sleep",
            metric: def.metric,
            occurredAt: day.wakeAt,
            value: day.minutes / 60,
            authoritative: true,
            sourceRecordId: identity,
          });
        }
      }
    }
    return evidence;
  }
  async function hadEvidence(
    queryDb: PersonalGoalQueryDb,
    def: GoalDefinition,
    id: number,
    asOf: string,
  ): Promise<boolean> {
    if (def.source === "manual")
      return (
        (
          await queryDb
            .select({ id: goalCheckin.id })
            .from(goalCheckin)
            .where(
              and(
                eq(goalCheckin.organizationId, organizationId),
                eq(goalCheckin.userId, userId),
                eq(goalCheckin.goalId, id),
                gte(goalCheckin.date, def.startDate),
                lte(goalCheckin.date, asOf),
              ),
            )
            .limit(1)
        ).length > 0
      );
    if (def.source === "water") {
      const rows = await queryDb
        .select({ observedAt: plainWaterEntry.observedAt })
        .from(plainWaterEntry)
        .where(
          and(
            eq(plainWaterEntry.organizationId, organizationId),
            eq(plainWaterEntry.userId, userId),
            lte(plainWaterEntry.observedAt, clock()),
          ),
        );
      return rows.some(
        (w) =>
          goalDateAt(def, w.observedAt) >= def.startDate && goalDateAt(def, w.observedAt) <= asOf,
      );
    }
    if (def.source === "supplement" && /^supplement:[1-9]\d*$/.test(def.metric)) {
      const rows = await queryDb
        .select({ occurredAt: supplementIntake.occurredAt })
        .from(supplementIntake)
        .where(
          and(
            eq(supplementIntake.organizationId, organizationId),
            eq(supplementIntake.userId, userId),
            eq(supplementIntake.supplementId, Number(def.metric.slice("supplement:".length))),
            lte(supplementIntake.occurredAt, clock()),
          ),
        );
      return rows.some(
        (i) =>
          goalDateAt(def, i.occurredAt) >= def.startDate && goalDateAt(def, i.occurredAt) <= asOf,
      );
    }
    if (def.source === "workout" && /^exercise:[1-9]\d*$/.test(def.metric)) {
      const rows = await queryDb
        .select({ id: workoutSet.id })
        .from(workout)
        .innerJoin(
          workoutExercise,
          and(
            eq(workoutExercise.organizationId, workout.organizationId),
            eq(workoutExercise.workoutId, workout.id),
          ),
        )
        .innerJoin(
          workoutSet,
          and(
            eq(workoutSet.organizationId, workout.organizationId),
            eq(workoutSet.exerciseId, workoutExercise.id),
          ),
        )
        .where(
          and(
            eq(workout.organizationId, organizationId),
            eq(workout.userId, userId),
            eq(workoutExercise.exerciseId, Number(def.metric.slice("exercise:".length))),
            gte(workout.date, def.startDate),
            lte(workout.date, asOf),
            gte(workoutSet.reps, 1),
            isNotNull(workoutSet.weightKg),
          ),
        )
        .limit(1);
      return rows.length > 0;
    }
    if (def.source === "tracker") {
      const tracker = await ownTracker(queryDb, def.metric);
      if (!tracker) return false;
      const rows = await queryDb
        .select({ id: customTrackerEntry.id })
        .from(customTrackerEntry)
        .where(
          and(
            eq(customTrackerEntry.organizationId, organizationId),
            eq(customTrackerEntry.userId, userId),
            eq(customTrackerEntry.trackerId, tracker.id),
            gte(customTrackerEntry.localDate, def.startDate),
            lte(customTrackerEntry.localDate, asOf),
            lte(customTrackerEntry.loggedAt, clock()),
          ),
        )
        .limit(1);
      return rows.length > 0;
    }
    if (def.source === "sleep" && sleepEvidence)
      return (
        (await sleepEvidence({ startDate: def.startDate, endDate: asOf, timeZone: def.timeZone }))
          .length > 0
      );
    return false;
  }
  async function summarize(
    row: typeof goal.$inferSelect,
    queryDb: PersonalGoalQueryDb = db,
  ): Promise<GoalSummary> {
    // Keep the persisted baseline and its immutable revisions for evaluation.
    // The public definition is a separate editor view of the currently effective
    // rule/calendar so consumers don't mistake the original baseline for today.
    const evaluationDefinition = await readDefinition(row, queryDb);
    const now = clock();
    const asOf = goalDateAt(evaluationDefinition, now);
    const evidence = await collectEvidence(queryDb, evaluationDefinition, row.id, asOf);
    const sourceLocked =
      row.everHadEvidence ||
      evidence.length > 0 ||
      (await hadEvidence(queryDb, evaluationDefinition, row.id, asOf));
    if (sourceLocked && !row.everHadEvidence)
      await queryDb.update(goal).set({ everHadEvidence: true }).where(liveGoalWhere(row.id));
    const definition = goalDefinitionAt(evaluationDefinition, now);
    return {
      id: row.id,
      version: row.version,
      title: row.title,
      definition,
      evaluation: evaluateGoal(evaluationDefinition, evidence, asOf),
      sourceLocked,
    };
  }
  function validDefinition(input: unknown): GoalDefinition {
    const checked = validateGoalDefinition(input);
    if (!checked.ok)
      throw new PersonalGoalValidationError(
        checked.issues.map((x) => `${x.path}: ${x.message}`).join("; "),
      );
    checkExactKeys(
      input,
      [
        "id",
        "title",
        "source",
        "metric",
        "unit",
        "rule",
        "startDate",
        "timeZone",
        "dayCutoff",
        "status",
        "milestones",
        "versions",
        "pauses",
      ],
      "definition",
    );
    const candidate = input as GoalDefinition;
    checkExactKeys(
      candidate.rule,
      candidate.rule.kind === "target"
        ? ["kind", "target", "targetDate"]
        : candidate.rule.kind === "average"
          ? ["kind", "target", "windowDays"]
          : candidate.rule.kind === "streak"
            ? ["kind", "target", "targetDays"]
            : ["kind", "cadence", "weekdays", "daysPerWeek", "completion"],
      "rule",
    );
    const comparator =
      candidate.rule.kind === "target" ||
      candidate.rule.kind === "average" ||
      candidate.rule.kind === "streak"
        ? candidate.rule.target
        : candidate.rule.kind === "recurring"
          ? candidate.rule.completion
          : undefined;
    if (comparator)
      checkExactKeys(
        comparator,
        comparator.kind === "range" ? ["kind", "minimum", "maximum"] : ["kind", "value"],
        "rule.comparator",
      );
    for (const milestone of candidate.milestones ?? []) {
      checkExactKeys(milestone, ["id", "value", "targetDate", "comparator"], "milestone");
      if (milestone.comparator)
        checkExactKeys(
          milestone.comparator,
          milestone.comparator.kind === "range"
            ? ["kind", "minimum", "maximum"]
            : ["kind", "value"],
          "milestone.comparator",
        );
    }
    for (const version of candidate.versions ?? []) {
      checkExactKeys(
        version,
        ["id", "effectiveDate", "effectiveAt", "rule", "timeZone", "dayCutoff"],
        "version",
      );
      checkExactKeys(
        version.rule,
        version.rule.kind === "target"
          ? ["kind", "target", "targetDate"]
          : version.rule.kind === "average"
            ? ["kind", "target", "windowDays"]
            : version.rule.kind === "streak"
              ? ["kind", "target", "targetDays"]
              : ["kind", "cadence", "weekdays", "daysPerWeek", "completion"],
        "version.rule",
      );
    }
    for (const pause of candidate.pauses ?? [])
      checkExactKeys(
        pause,
        ["startDate", "endDate", "resumedOn", "pausedAt", "resumedAt"],
        "pause",
      );
    if (
      (candidate.unit !== undefined &&
        candidate.unit !== null &&
        typeof candidate.unit !== "string") ||
      candidate.title.length > 200 ||
      candidate.metric.length > 120 ||
      (candidate.unit?.length ?? 0) > 40
    )
      throw new PersonalGoalValidationError(
        "Goal title, metric, or unit exceeds the supported length",
      );
    return checked.value;
  }
  function editorDefinition(
    definition: GoalDefinition,
    id: string = randomUUID(),
    status: GoalLifecycleStatus = "active",
  ): GoalDefinition {
    const comparator = (value: GoalComparator): GoalComparator =>
      value.kind === "range"
        ? { kind: "range", minimum: value.minimum, maximum: value.maximum }
        : { kind: value.kind, value: value.value };
    const rule: GoalRule =
      definition.rule.kind === "target"
        ? {
            kind: "target",
            target: comparator(definition.rule.target),
            ...(definition.rule.targetDate !== undefined
              ? { targetDate: definition.rule.targetDate }
              : {}),
          }
        : definition.rule.kind === "average"
          ? {
              kind: "average",
              target: comparator(definition.rule.target),
              ...(definition.rule.windowDays !== undefined
                ? { windowDays: definition.rule.windowDays }
                : {}),
            }
          : definition.rule.kind === "streak"
            ? {
                kind: "streak",
                target: comparator(definition.rule.target),
                targetDays: definition.rule.targetDays,
              }
            : {
                kind: "recurring",
                cadence: definition.rule.cadence,
                ...(definition.rule.weekdays ? { weekdays: [...definition.rule.weekdays] } : {}),
                ...(definition.rule.daysPerWeek !== undefined
                  ? { daysPerWeek: definition.rule.daysPerWeek }
                  : {}),
                ...(definition.rule.completion
                  ? { completion: comparator(definition.rule.completion) }
                  : {}),
              };
    return {
      id,
      title: definition.title,
      source: definition.source,
      metric: definition.metric,
      unit: definition.unit ?? null,
      rule,
      startDate: definition.startDate,
      timeZone: definition.timeZone,
      dayCutoff: definition.dayCutoff ?? null,
      status,
      versions: [],
      pauses: [],
      milestones: definition.milestones?.map((m) => ({
        value: m.value,
        targetDate: m.targetDate,
        ...(m.comparator ? { comparator: comparator(m.comparator) } : {}),
        id: randomUUID(),
      })),
    };
  }
  function checkSource(def: GoalDefinition) {
    if (def.source === "water" && (def.metric !== "water_ml" || def.unit !== "ml"))
      throw new PersonalGoalValidationError("Water source requires water_ml in ml");
    if (
      def.source === "water" &&
      def.rule.kind === "recurring" &&
      def.rule.cadence === "daily" &&
      (def.rule.completion?.kind !== "minimum" || def.rule.completion.value <= 0)
    )
      throw new PersonalGoalValidationError(
        "Daily water goals require a positive minimum completion target",
      );
    if (def.source === "sleep" && (def.metric !== "sleep_hours" || def.unit !== "h"))
      throw new PersonalGoalValidationError("Sleep source requires sleep_hours in h");
    if (
      def.source === "supplement" &&
      (!/^supplement:[1-9]\d*$/.test(def.metric) ||
        def.rule.kind !== "recurring" ||
        (def.unit != null && def.unit !== "completion"))
    )
      throw new PersonalGoalValidationError(
        "Supplement source requires a selected supplement and recurring completion rule",
      );
    if (def.source === "tracker" && !trackerIdFromGoalMetric(def.metric))
      throw new PersonalGoalValidationError("Tracker source requires a selected tracker");
    if (def.source === "workout" && (!/^exercise:[1-9]\d*$/.test(def.metric) || def.unit !== "kg"))
      throw new PersonalGoalValidationError(
        "Workout source requires a catalog exercise metric in kg",
      );
  }
  /**
   * A tracker goal names one of the member's own trackers, and its rules,
   * unit and milestones fit the tracker type. On an edit that keeps the same
   * tracker, a tracker deleted since is tolerated so the goal stays editable.
   */
  async function validateTrackerGoal(
    tx: PersonalGoalTransaction,
    def: GoalDefinition,
    previousMetric?: string,
  ) {
    if (def.source !== "tracker") return;
    const tracker = await ownTracker(tx, def.metric);
    if (!tracker) {
      if (previousMetric === def.metric) return;
      throw new PersonalGoalValidationError("Selected tracker does not exist");
    }
    const problem = trackerGoalProblem(def, tracker);
    if (problem) throw new PersonalGoalValidationError(problem);
  }
  async function validateSourceExists(tx: PersonalGoalTransaction, def: GoalDefinition) {
    await validateTrackerGoal(tx, def);
    if (def.source === "supplement") {
      const item = await tx
        .select({ id: supplement.id })
        .from(supplement)
        .where(eq(supplement.id, Number(def.metric.slice("supplement:".length))))
        .limit(1);
      if (!item.length) throw new PersonalGoalValidationError("Selected supplement does not exist");
    }
    if (def.source === "workout") {
      const item = await tx
        .select({ id: exercise.id })
        .from(exercise)
        .where(
          and(
            eq(exercise.id, Number(def.metric.slice("exercise:".length))),
            or(eq(exercise.organizationId, organizationId), isNull(exercise.organizationId)),
          ),
        )
        .limit(1);
      if (!item.length)
        throw new PersonalGoalValidationError("Selected exercise is not in the catalog");
    }
  }
  return {
    async listUnassignedLegacy() {
      return db.transaction(async (tx) => {
        await lockGoalOwner(tx, { organizationId, userId });
        await reconcileWaterLink(tx, { organizationId, userId }, { now: clock() });
        return tx
          .select({
            id: goal.id,
            title: goal.title,
            category: goal.category,
            version: goal.version,
          })
          .from(goal)
          .where(
            and(
              eq(goal.organizationId, organizationId),
              isNull(goal.userId),
              isNull(goal.deletedAt),
            ),
          )
          .orderBy(desc(goal.id));
      });
    },
    async listNeedsConfiguration() {
      return db.transaction(async (tx) => {
        await lockGoalOwner(tx, { organizationId, userId });
        await reconcileWaterLink(tx, { organizationId, userId }, { now: clock() });
        return tx
          .select({
            id: goal.id,
            title: goal.title,
            category: goal.category,
            version: goal.version,
          })
          .from(goal)
          .where(
            and(
              eq(goal.organizationId, organizationId),
              eq(goal.userId, userId),
              isNull(goal.definition),
              isNull(goal.deletedAt),
            ),
          )
          .orderBy(desc(goal.id));
      });
    },
    async configureLegacy(input: {
      id: number;
      version: number;
      definition: unknown;
      clientMutationId: string;
    }): Promise<GoalSummary> {
      const requestedInput = validDefinition(input.definition);
      const requested = editorDefinition(requestedInput);
      checkSource(requested);
      const result = await mutate(
        "configureLegacy",
        input.clientMutationId,
        { id: input.id, version: input.version, definition: input.definition },
        async (tx) => {
          const row = (
            await tx
              .select()
              .from(goal)
              .where(
                and(
                  ownerWhere(input.id),
                  eq(goal.version, input.version),
                  isNull(goal.deletedAt),
                  isNull(goal.definition),
                ),
              )
              .for("update")
              .limit(1)
          )[0];
          if (!row)
            throw new PersonalGoalConflictError(
              "Legacy goal not found, already configured, or version changed",
            );
          const prior = await tx
            .select({ id: goalCheckin.id, value: goalCheckin.value })
            .from(goalCheckin)
            .where(
              and(
                eq(goalCheckin.organizationId, organizationId),
                eq(goalCheckin.userId, userId),
                eq(goalCheckin.goalId, row.id),
                isNull(goalCheckin.deletedAt),
              ),
            );
          if (prior.length && requested.source !== "manual")
            throw new PersonalGoalConflictError(
              "Legacy check-ins require manual-source configuration",
            );
          if (prior.some((c) => c.value !== null && !Number.isFinite(Number(c.value))))
            throw new PersonalGoalConflictError(
              "Legacy check-in values need numeric correction before configuration",
            );
          await validateSourceExists(tx, requested);
          const definition: GoalDefinition = {
            ...requested,
            status: row.status === "paused" ? "paused" : "active",
          };
          const updated = await tx
            .update(goal)
            .set({
              title: definition.title,
              definition,
              source: definition.source,
              status: definition.status === "paused" ? "paused" : "in_progress",
              timezone: definition.timeZone,
              startDate: definition.startDate,
              cutoffTime: definition.dayCutoff ?? null,
              everHadEvidence: prior.length > 0,
              version: row.version + 1,
            })
            .where(
              and(
                eq(goal.organizationId, organizationId),
                eq(goal.userId, userId),
                eq(goal.id, row.id),
                eq(goal.version, input.version),
                isNull(goal.deletedAt),
                isNull(goal.definition),
              ),
            )
            .returning();
          if (!updated.length)
            throw new PersonalGoalConflictError("Legacy goal was concurrently configured");
          await tx.insert(goalDefinition).values({
            organizationId,
            userId,
            goalId: row.id,
            revision: 1,
            definition,
            effectiveFrom: definition.startDate,
          });
          if (definition.milestones?.length)
            await tx.insert(goalMilestone).values(
              definition.milestones.map((m) => ({
                organizationId,
                userId,
                goalId: row.id,
                value: String(m.value),
                targetDate: m.targetDate,
              })),
            );
          await tx.insert(goalLifecycle).values({
            organizationId,
            userId,
            goalId: row.id,
            event: "created",
            occurredAt: clock().toISOString(),
            effectiveDate: definition.startDate,
            details: { configuredFromLegacy: true },
          });
          return { result: await summarize(updated[0]!, tx), targetId: row.id };
        },
      );
      return result;
    },
    async assignLegacy(input: {
      id: number;
      assigneeUserId: string;
      reason: string;
      clientMutationId: string;
    }) {
      const reason = input.reason.trim();
      if (reason.length < 5 || reason.length > 500)
        throw new PersonalGoalValidationError("Assignment reason must contain 5 to 500 characters");
      return mutate(
        "assignLegacy",
        input.clientMutationId,
        { id: input.id, assigneeUserId: input.assigneeUserId, reason },
        async (tx) => {
          const targetMember = await tx
            .select({ userId: member.userId })
            .from(member)
            .where(
              and(
                eq(member.organizationId, organizationId),
                eq(member.userId, input.assigneeUserId),
              ),
            )
            .limit(1);
          if (!targetMember.length)
            throw new PersonalGoalValidationError(
              "Assignee must be an active member of this organization",
            );
          const legacy = (
            await tx
              .select()
              .from(goal)
              .where(
                and(
                  eq(goal.organizationId, organizationId),
                  eq(goal.id, input.id),
                  isNull(goal.userId),
                  isNull(goal.deletedAt),
                ),
              )
              .for("update")
              .limit(1)
          )[0];
          if (!legacy) throw new PersonalGoalNotFoundError("Unassigned legacy goal not found");
          await tx.insert(goalOwnershipAssignment).values({
            organizationId,
            goalId: legacy.id,
            assignedUserId: input.assigneeUserId,
            assignedByUserId: userId,
            reason,
          });
          const updated = await tx
            .update(goal)
            .set({ userId: input.assigneeUserId, version: legacy.version + 1 })
            .where(
              and(
                eq(goal.organizationId, organizationId),
                eq(goal.id, legacy.id),
                eq(goal.version, legacy.version),
                isNull(goal.userId),
                isNull(goal.deletedAt),
              ),
            )
            .returning();
          if (!updated.length)
            throw new PersonalGoalConflictError("Legacy goal was concurrently assigned");
          await tx
            .update(goalCheckin)
            .set({ userId: input.assigneeUserId })
            .where(
              and(
                eq(goalCheckin.organizationId, organizationId),
                eq(goalCheckin.goalId, legacy.id),
                isNull(goalCheckin.userId),
              ),
            );
          return {
            result: {
              id: legacy.id,
              version: legacy.version + 1,
              needsConfiguration: true as const,
            },
            targetId: legacy.id,
          };
        },
      );
    },
    async list(): Promise<GoalSummary[]> {
      return db.transaction(async (tx) => {
        await lockGoalOwner(tx, { organizationId, userId });
        await reconcileWaterLink(tx, { organizationId, userId }, { now: clock() });
        const rows = await tx
          .select()
          .from(goal)
          .where(
            and(
              eq(goal.organizationId, organizationId),
              eq(goal.userId, userId),
              isNull(goal.deletedAt),
            ),
          )
          .orderBy(desc(goal.id));
        const result: GoalSummary[] = [];
        for (const row of rows) if (row.definition) result.push(await summarize(row, tx));
        return result;
      });
    },
    async detail(id: number): Promise<GoalDetail> {
      return db.transaction(async (tx) => {
        await lockGoalOwner(tx, { organizationId, userId });
        await reconcileWaterLink(tx, { organizationId, userId }, { now: clock() });
        const row = (await tx.select().from(goal).where(liveGoalWhere(id)).limit(1))[0];
        if (!row?.definition) throw new PersonalGoalNotFoundError("Goal not found");
        const summary = await summarize(row, tx);
        const checkins = await tx
          .select()
          .from(goalCheckin)
          .where(
            and(
              eq(goalCheckin.organizationId, organizationId),
              eq(goalCheckin.userId, userId),
              eq(goalCheckin.goalId, id),
            ),
          )
          .orderBy(asc(goalCheckin.date), asc(goalCheckin.id));
        const history = await tx
          .select()
          .from(goalDefinition)
          .where(
            and(
              eq(goalDefinition.organizationId, organizationId),
              eq(goalDefinition.userId, userId),
              eq(goalDefinition.goalId, id),
            ),
          )
          .orderBy(asc(goalDefinition.revision));
        const definitionRows = [];
        for (const h of history)
          definitionRows.push({
            revision: h.revision,
            definition: validDefinition(h.definition),
            effectiveFrom: h.effectiveFrom,
            effectiveUntil: h.effectiveUntil,
          });
        const evidence = await collectEvidence(tx, summary.definition, id, summary.evaluation.asOf);
        const checkinHistory: GoalCheckinHistory[] = checkins.map((c) => ({
          id: c.id,
          version: c.version,
          date: c.date,
          ...readCheckin(c.value),
          notes: c.notes,
          deletedAt: c.deletedAt ?? null,
          correctedFromId: c.correctedFromId,
        }));
        const lifecycle = await tx
          .select()
          .from(goalLifecycle)
          .where(
            and(
              eq(goalLifecycle.organizationId, organizationId),
              eq(goalLifecycle.userId, userId),
              eq(goalLifecycle.goalId, id),
            ),
          )
          .orderBy(asc(goalLifecycle.id));
        const relationId = (
          event: (typeof lifecycle)[number] | undefined,
          key: string,
        ): number | null => {
          const details = event?.details;
          if (!details || typeof details !== "object" || Array.isArray(details)) return null;
          const value = (details as Record<string, unknown>)[key];
          return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
        };
        return {
          ...summary,
          checkins: checkinHistory
            .filter((c) => c.deletedAt === null)
            .map((c) => ({
              id: c.id,
              version: c.version,
              date: c.date,
              value: c.value,
              completed: c.completed,
              notes: c.notes,
            })),
          checkinHistory,
          evidence,
          history: definitionRows,
          replacement: {
            replacesId: relationId(
              lifecycle.find((e) => e.event === "created"),
              "replacesId",
            ),
            replacedById: relationId(
              [...lifecycle].reverse().find((e) => e.event === "cancelled"),
              "replacedById",
            ),
          },
        };
      });
    },
    async create(input: {
      definition: unknown;
      clientMutationId: string;
      replacesId?: number;
      replacesVersion?: number;
    }): Promise<GoalSummary> {
      if ((input.replacesId === undefined) !== (input.replacesVersion === undefined))
        throw new PersonalGoalValidationError(
          "Replacement goal id and version must be provided together",
        );
      const requestedInput = validDefinition(input.definition);
      const requested = editorDefinition(requestedInput);
      checkSource(requested);
      const created = await mutate(
        "create",
        input.clientMutationId,
        {
          definition: input.definition,
          replacesId: input.replacesId ?? null,
          replacesVersion: input.replacesVersion ?? null,
        },
        async (tx) => {
          await validateSourceExists(tx, requested);
          let replacedGoalId: number | null = null;
          let replacementEventId: number | null = null;
          if (input.replacesId !== undefined) {
            const replaced = (
              await tx
                .select()
                .from(goal)
                .where(
                  and(
                    eq(goal.organizationId, organizationId),
                    eq(goal.userId, userId),
                    eq(goal.id, input.replacesId),
                    isNull(goal.deletedAt),
                  ),
                )
                .for("update")
                .limit(1)
            )[0];
            if (!replaced?.definition)
              throw new PersonalGoalNotFoundError("Replacement goal not found");
            if (replaced.version !== input.replacesVersion)
              throw new PersonalGoalConflictError("Replacement goal version changed");
            replacedGoalId = replaced.id;
            const endedAt = clock().toISOString();
            const ended = await tx
              .update(goal)
              .set({ status: "completed", version: replaced.version + 1 })
              .where(
                and(
                  eq(goal.organizationId, organizationId),
                  eq(goal.userId, userId),
                  eq(goal.id, replaced.id),
                  eq(goal.version, replaced.version),
                  isNull(goal.deletedAt),
                ),
              )
              .returning();
            if (!ended.length)
              throw new PersonalGoalConflictError("Replacement goal changed concurrently");
            const [replacementEvent] = await tx
              .insert(goalLifecycle)
              .values({
                organizationId,
                userId,
                goalId: replaced.id,
                event: "cancelled",
                occurredAt: endedAt,
                details: { replacedBy: true },
              })
              .returning({ id: goalLifecycle.id });
            replacementEventId = replacementEvent?.id ?? null;
          }
          const definition: GoalDefinition = requested;
          const inserted = await tx
            .insert(goal)
            .values({
              organizationId,
              userId,
              title: definition.title,
              category: "personal",
              status: "in_progress",
              source: definition.source,
              definition,
              timezone: definition.timeZone,
              startDate: definition.startDate,
              cutoffTime: definition.dayCutoff ?? null,
              version: 1,
            })
            .returning();
          const row = inserted[0]!;
          if (replacedGoalId !== null && replacementEventId !== null)
            await tx
              .update(goalLifecycle)
              .set({ details: { replacedById: row.id } })
              .where(
                and(
                  eq(goalLifecycle.organizationId, organizationId),
                  eq(goalLifecycle.userId, userId),
                  eq(goalLifecycle.goalId, replacedGoalId),
                  eq(goalLifecycle.id, replacementEventId),
                ),
              );
          await tx.insert(goalDefinition).values({
            organizationId,
            userId,
            goalId: row.id,
            revision: 1,
            definition,
            effectiveFrom: definition.startDate,
          });
          if (definition.milestones?.length)
            await tx.insert(goalMilestone).values(
              definition.milestones.map((m) => ({
                organizationId,
                userId,
                goalId: row.id,
                value: String(m.value),
                targetDate: m.targetDate,
              })),
            );
          await tx.insert(goalLifecycle).values({
            organizationId,
            userId,
            goalId: row.id,
            event: "created",
            occurredAt: clock().toISOString(),
            effectiveDate: definition.startDate,
            details: input.replacesId === undefined ? null : { replacesId: input.replacesId },
          });
          return { result: await summarize(row, tx), targetId: row.id };
        },
      );
      return created;
    },
    async update(input: {
      id: number;
      version: number;
      definition: unknown;
      clientMutationId: string;
    }): Promise<GoalSummary> {
      const requestedInput = validDefinition(input.definition);
      const result = await mutate(
        "update",
        input.clientMutationId,
        { id: input.id, version: input.version, definition: input.definition },
        async (tx) => {
          const row = (
            await tx
              .select()
              .from(goal)
              .where(and(liveGoalWhere(input.id), eq(goal.version, input.version)))
              .for("update")
              .limit(1)
          )[0];
          if (!row) {
            const current = (
              await tx.select({ id: goal.id }).from(goal).where(liveGoalWhere(input.id)).limit(1)
            )[0];
            if (current) throw new PersonalGoalConflictError("Goal version changed");
            throw new PersonalGoalNotFoundError("Goal not found");
          }
          if (!row.definition)
            throw new PersonalGoalConflictError(
              "Legacy goal requires configuration before editing",
            );
          const previous = await readDefinition(row, tx);
          const requested = editorDefinition(requestedInput, previous.id, previous.status);
          checkSource(requested);
          await validateTrackerGoal(
            tx,
            requested,
            previous.source === "tracker" ? previous.metric : undefined,
          );
          const now = clock();
          const asOf = goalDateAt(previous, now);
          const evidence = await collectEvidence(tx, previous, row.id, asOf);
          const previousLocked =
            row.everHadEvidence ||
            evidence.length > 0 ||
            (await hadEvidence(tx, previous, row.id, asOf));
          if (previousLocked && !row.everHadEvidence) {
            await tx
              .update(goal)
              .set({ everHadEvidence: true })
              .where(
                and(
                  eq(goal.organizationId, organizationId),
                  eq(goal.userId, userId),
                  eq(goal.id, row.id),
                  isNull(goal.deletedAt),
                ),
              );
          }
          const contractChanged = !sameMeasurementContract(previous, requested);
          if (contractChanged && previousLocked)
            throw new PersonalGoalConflictError(
              "Measurement contract changes after evidence require a replacement goal",
            );
          const currentDefinition = goalDefinitionAt(previous, now);
          const currentRule = currentDefinition.rule;
          if (
            !contractChanged &&
            evaluateGoal(previous, evidence, asOf).achieved &&
            stricterTarget(currentRule, requested.rule)
          )
            throw new PersonalGoalConflictError(
              "A stricter target after achievement requires a replacement goal",
            );
          if (requested.startDate !== previous.startDate)
            throw new PersonalGoalConflictError("Start date is fixed; create a replacement goal");
          const currentDate = goalDateAt(previous, now);
          const weeklyChange =
            (currentRule.kind === "recurring" && currentRule.cadence === "any-days-per-week") ||
            (requested.rule.kind === "recurring" && requested.rule.cadence === "any-days-per-week");
          const effectiveDate = contractChanged
            ? previous.startDate
            : weeklyChange
              ? nextWeekday(currentDate)
              : plusDays(currentDate, 1);
          const priorHistory = await tx
            .select()
            .from(goalDefinition)
            .where(
              and(
                eq(goalDefinition.organizationId, organizationId),
                eq(goalDefinition.userId, userId),
                eq(goalDefinition.goalId, row.id),
              ),
            )
            .orderBy(asc(goalDefinition.revision));
          const revision = priorHistory.length + 1;
          const historyInput = requested;
          const priorCurrent = validDefinition(row.definition);
          const openRevision = priorHistory.filter((item) => item.effectiveUntil === null).at(-1);
          const previousRevisionEnd = contractChanged
            ? openRevision && openRevision.effectiveFrom > currentDate
              ? openRevision.effectiveFrom
              : currentDate
            : effectiveDate;
          await tx
            .update(goalDefinition)
            .set({ effectiveUntil: previousRevisionEnd })
            .where(
              and(
                eq(goalDefinition.organizationId, organizationId),
                eq(goalDefinition.userId, userId),
                eq(goalDefinition.goalId, row.id),
                isNull(goalDefinition.effectiveUntil),
              ),
            );
          await tx.insert(goalDefinition).values({
            organizationId,
            userId,
            goalId: row.id,
            revision,
            definition: historyInput,
            effectiveFrom: effectiveDate,
          });
          const versions: GoalRuleVersion[] = contractChanged
            ? []
            : [
                ...(previous.versions ?? []),
                {
                  id: String(revision),
                  effectiveDate,
                  effectiveAt: localBoundaryInstant(
                    effectiveDate,
                    requested.timeZone,
                    requested.dayCutoff,
                  ),
                  rule: requested.rule,
                  timeZone: requested.timeZone,
                  dayCutoff: requested.dayCutoff ?? null,
                },
              ];
          const definition: GoalDefinition = contractChanged
            ? {
                ...requested,
                id: previous.id,
                status: previous.status,
                pauses: previous.pauses ?? [],
                versions,
              }
            : {
                ...priorCurrent,
                title: requested.title,
                source: requested.source,
                metric: requested.metric,
                unit: requested.unit,
                rule: previous.rule,
                milestones: requested.milestones,
                versions,
              };
          await tx
            .delete(goalMilestone)
            .where(
              and(
                eq(goalMilestone.organizationId, organizationId),
                eq(goalMilestone.userId, userId),
                eq(goalMilestone.goalId, row.id),
              ),
            );
          if (requested.milestones?.length)
            await tx.insert(goalMilestone).values(
              requested.milestones.map((m) => ({
                organizationId,
                userId,
                goalId: row.id,
                value: String(m.value),
                targetDate: m.targetDate,
              })),
            );
          const updated = await tx
            .update(goal)
            .set({
              title: definition.title,
              definition,
              source: definition.source,
              version: row.version + 1,
            })
            .where(
              and(
                eq(goal.organizationId, organizationId),
                eq(goal.userId, userId),
                eq(goal.id, row.id),
                eq(goal.version, input.version),
                isNull(goal.deletedAt),
              ),
            )
            .returning();
          if (!updated.length) throw new PersonalGoalConflictError("Goal version changed");
          return { result: await summarize(updated[0]!, tx), targetId: row.id };
        },
      );
      return result;
    },
    async setStatus(input: {
      id: number;
      version: number;
      status: "active" | "paused" | "completed";
      clientMutationId: string;
    }): Promise<GoalSummary> {
      const result = await mutate("setStatus", input.clientMutationId, input, async (tx) => {
        const row = (
          await tx
            .select()
            .from(goal)
            .where(and(liveGoalWhere(input.id), eq(goal.version, input.version)))
            .for("update")
            .limit(1)
        )[0];
        if (!row) {
          const current = (
            await tx.select({ id: goal.id }).from(goal).where(liveGoalWhere(input.id)).limit(1)
          )[0];
          if (current) throw new PersonalGoalConflictError("Goal version changed");
          throw new PersonalGoalNotFoundError("Goal not found");
        }
        if (!row.definition)
          throw new PersonalGoalConflictError(
            "Legacy goal requires configuration before changing status",
          );
        const definition = await readDefinition(row, tx);
        const now = clock();
        const currentEffectiveDefinition = goalDefinitionAt(definition, now);
        const currentDate = goalDateAt(definition, now);
        const storedStatus =
          row.status === "paused" ? "paused" : row.status === "completed" ? "completed" : "active";
        if (storedStatus === input.status)
          return { result: await summarize(row, tx), targetId: row.id };
        const lifecycleRows = await tx
          .select()
          .from(goalLifecycle)
          .where(
            and(
              eq(goalLifecycle.organizationId, organizationId),
              eq(goalLifecycle.userId, userId),
              eq(goalLifecycle.goalId, row.id),
            ),
          )
          .orderBy(asc(goalLifecycle.id));
        const pauses = lifecycleRows.reduce<GoalPause[]>((all, event) => {
          if (
            event.event === "paused" &&
            event.effectiveDate &&
            !all.some((p) => p.endDate === null)
          )
            all.push({
              startDate: event.effectiveDate,
              endDate: null,
              ...(isIsoInstant(event.occurredAt) ? { pausedAt: event.occurredAt } : {}),
            });
          if ((event.event === "resumed" || event.event === "reopened") && event.effectiveDate) {
            const open = [...all].reverse().find((p) => p.endDate === null);
            if (open) {
              open.endDate =
                event.effectiveDate <= open.startDate
                  ? open.startDate
                  : plusDays(event.effectiveDate, -1);
              open.resumedOn = event.effectiveDate;
              if (isIsoInstant(event.occurredAt)) open.resumedAt = event.occurredAt;
            }
          }
          return all;
        }, []);
        const weeklyResume =
          input.status === "active" &&
          currentEffectiveDefinition.rule.kind === "recurring" &&
          currentEffectiveDefinition.rule.cadence === "any-days-per-week" &&
          pauses.some((p) => p.endDate === null);
        const effectiveDate = weeklyResume ? nextWeekday(currentDate) : currentDate;
        if (input.status === "paused" && !pauses.some((p) => p.endDate === null))
          pauses.push({ startDate: effectiveDate, endDate: null, pausedAt: now.toISOString() });
        if (input.status === "active") {
          const open = [...pauses].reverse().find((p) => p.endDate === null);
          if (open) {
            open.endDate =
              effectiveDate <= open.startDate ? open.startDate : plusDays(effectiveDate, -1);
            open.resumedOn = effectiveDate;
            open.resumedAt = now.toISOString();
          }
        }
        const next = { ...definition, status: input.status as GoalLifecycleStatus, pauses };
        const updated = await tx
          .update(goal)
          .set({
            definition: next,
            status: input.status === "active" ? "in_progress" : input.status,
            version: row.version + 1,
          })
          .where(
            and(
              eq(goal.organizationId, organizationId),
              eq(goal.userId, userId),
              eq(goal.id, row.id),
              eq(goal.version, input.version),
              isNull(goal.deletedAt),
            ),
          )
          .returning();
        if (!updated.length) throw new PersonalGoalConflictError("Goal version changed");
        await tx.insert(goalLifecycle).values({
          organizationId,
          userId,
          goalId: row.id,
          event:
            input.status === "active"
              ? definition.status === "completed"
                ? "reopened"
                : "resumed"
              : input.status,
          occurredAt: now.toISOString(),
          effectiveDate,
        });
        return { result: await summarize(updated[0]!, tx), targetId: row.id };
      });
      return result;
    },
    async delete(input: { id: number; version: number; clientMutationId: string }) {
      return mutate("delete", input.clientMutationId, input, async (tx) => {
        const row = (
          await tx
            .select()
            .from(goal)
            .where(and(liveGoalWhere(input.id), eq(goal.version, input.version)))
            .for("update")
            .limit(1)
        )[0];
        if (!row) {
          const current = (
            await tx.select({ id: goal.id }).from(goal).where(liveGoalWhere(input.id)).limit(1)
          )[0];
          if (current) throw new PersonalGoalConflictError("Goal version changed");
          throw new PersonalGoalNotFoundError("Goal not found");
        }
        const now = clock().toISOString();
        const updated = await tx
          .update(goal)
          .set({ deletedAt: now, version: row.version + 1, status: "cancelled" })
          .where(
            and(
              eq(goal.organizationId, organizationId),
              eq(goal.userId, userId),
              eq(goal.id, row.id),
              eq(goal.version, input.version),
              isNull(goal.deletedAt),
            ),
          )
          .returning();
        if (!updated.length) throw new PersonalGoalConflictError("Goal version changed");
        await tx
          .insert(goalLifecycle)
          .values({ organizationId, userId, goalId: row.id, event: "deleted", occurredAt: now });
        return {
          result: { id: row.id, version: row.version + 1, deleted: true as const },
          targetId: row.id,
        };
      });
    },
    async createCheckin(input: {
      goalId: number;
      date: string;
      value?: number;
      completed?: boolean;
      notes?: string | null;
      clientMutationId: string;
    }) {
      if (
        !isIsoDate(input.date) ||
        (input.value !== undefined && !Number.isFinite(input.value)) ||
        (input.value === undefined && input.completed === undefined) ||
        (input.value !== undefined && input.completed === true)
      )
        throw new PersonalGoalValidationError(
          "Provide a valid date and a truthful numeric value or completion assertion",
        );
      const result = await mutate("createCheckin", input.clientMutationId, input, async (tx) => {
        const row = (
          await tx.select().from(goal).where(liveGoalWhere(input.goalId)).for("update").limit(1)
        )[0];
        if (!row) throw new PersonalGoalNotFoundError("Goal not found");
        if (!row.definition)
          throw new PersonalGoalConflictError(
            "Legacy goal requires configuration before check-ins",
          );
        const def = validDefinition(row.definition);
        if (def.source !== "manual")
          throw new PersonalGoalConflictError("External-source evidence is read-only");
        if (input.date > goalDateAt(def, clock()))
          throw new PersonalGoalValidationError("Manual check-ins cannot be dated in the future");
        const inserted = await tx
          .insert(goalCheckin)
          .values({
            organizationId,
            userId,
            goalId: input.goalId,
            date: input.date,
            value:
              input.completed === undefined
                ? String(input.value)
                : completionValue(input.completed, input.value),
            notes: input.notes ?? null,
          })
          .returning();
        await tx
          .update(goal)
          .set({ everHadEvidence: true })
          .where(
            and(
              eq(goal.organizationId, organizationId),
              eq(goal.userId, userId),
              eq(goal.id, input.goalId),
              isNull(goal.deletedAt),
            ),
          );
        return {
          result: { id: inserted[0]!.id, version: inserted[0]!.version },
          targetId: inserted[0]!.id,
        };
      });
      return result;
    },
    async updateCheckin(input: {
      id: number;
      goalId: number;
      version: number;
      date: string;
      value?: number;
      completed?: boolean;
      notes?: string | null;
      clientMutationId: string;
    }) {
      if (
        !isIsoDate(input.date) ||
        (input.value !== undefined && !Number.isFinite(input.value)) ||
        (input.value === undefined && input.completed === undefined) ||
        (input.value !== undefined && input.completed === true)
      )
        throw new PersonalGoalValidationError(
          "Provide a valid date and a truthful numeric value or completion assertion",
        );
      return mutate("updateCheckin", input.clientMutationId, input, async (tx) => {
        const parent = (
          await tx.select().from(goal).where(liveGoalWhere(input.goalId)).for("update").limit(1)
        )[0];
        if (!parent) throw new PersonalGoalNotFoundError("Goal not found");
        if (!parent.definition)
          throw new PersonalGoalConflictError(
            "Legacy goal requires configuration before check-ins",
          );
        const parentDefinition = validDefinition(parent.definition);
        if (parentDefinition.source !== "manual")
          throw new PersonalGoalConflictError("External-source evidence is read-only");
        if (input.date > goalDateAt(parentDefinition, clock()))
          throw new PersonalGoalValidationError("Manual check-ins cannot be dated in the future");
        const existing = (
          await tx
            .select()
            .from(goalCheckin)
            .where(
              and(
                eq(goalCheckin.organizationId, organizationId),
                eq(goalCheckin.userId, userId),
                eq(goalCheckin.goalId, input.goalId),
                eq(goalCheckin.id, input.id),
                isNull(goalCheckin.deletedAt),
              ),
            )
            .for("update")
            .limit(1)
        )[0];
        if (!existing) throw new PersonalGoalNotFoundError("Check-in not found");
        if (existing.version !== input.version)
          throw new PersonalGoalConflictError("Check-in version changed");
        const now = clock().toISOString();
        const retired = await tx
          .update(goalCheckin)
          .set({ deletedAt: now, version: existing.version + 1 })
          .where(
            and(
              eq(goalCheckin.organizationId, organizationId),
              eq(goalCheckin.userId, userId),
              eq(goalCheckin.goalId, input.goalId),
              eq(goalCheckin.id, input.id),
              eq(goalCheckin.version, input.version),
              isNull(goalCheckin.deletedAt),
            ),
          )
          .returning();
        if (!retired.length) throw new PersonalGoalConflictError("Check-in version changed");
        const value =
          input.completed === undefined
            ? String(input.value)
            : completionValue(input.completed, input.value);
        const inserted = await tx
          .insert(goalCheckin)
          .values({
            organizationId,
            userId,
            goalId: input.goalId,
            date: input.date,
            value,
            notes: input.notes ?? null,
            correctedFromId: existing.id,
          })
          .returning();
        return {
          result: { id: inserted[0]!.id, version: inserted[0]!.version },
          targetId: inserted[0]!.id,
        };
      });
    },
    async deleteCheckin(input: {
      id: number;
      goalId: number;
      version: number;
      clientMutationId: string;
    }) {
      return mutate("deleteCheckin", input.clientMutationId, input, async (tx) => {
        const existing = (
          await tx
            .select()
            .from(goalCheckin)
            .where(
              and(
                eq(goalCheckin.organizationId, organizationId),
                eq(goalCheckin.userId, userId),
                eq(goalCheckin.goalId, input.goalId),
                eq(goalCheckin.id, input.id),
              ),
            )
            .for("update")
            .limit(1)
        )[0];
        if (!existing) throw new PersonalGoalNotFoundError("Check-in not found");
        if (existing.deletedAt)
          return { result: { id: input.id, deleted: true as const }, targetId: input.id };
        if (existing.version !== input.version)
          throw new PersonalGoalConflictError("Check-in version changed");
        const updated = await tx
          .update(goalCheckin)
          .set({ deletedAt: clock().toISOString(), version: existing.version + 1 })
          .where(
            and(
              eq(goalCheckin.organizationId, organizationId),
              eq(goalCheckin.userId, userId),
              eq(goalCheckin.goalId, input.goalId),
              eq(goalCheckin.id, input.id),
              eq(goalCheckin.version, input.version),
              isNull(goalCheckin.deletedAt),
            ),
          )
          .returning();
        if (!updated.length) throw new PersonalGoalConflictError("Check-in version changed");
        return { result: { id: input.id, deleted: true as const }, targetId: input.id };
      });
    },
  };
}
