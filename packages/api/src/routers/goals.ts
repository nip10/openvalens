import { writeAuditLog } from "@openvalens/audit-security";
import { AuthzHttpError, requirePermission } from "@openvalens/auth/authz/guard";
import {
  createPersonalGoalRepository,
  PersonalGoalConfigurationError,
  PersonalGoalConflictError,
  PersonalGoalNotFoundError,
  PersonalGoalValidationError,
  validateGoalDefinition,
  type GoalDefinition,
  type GoalDetail,
  type GoalEvaluation,
  type GoalSummary,
} from "@openvalens/plans";
import { getPersonalSleepDailyEvidence } from "@openvalens/sleep/queries";
import { z } from "zod";
import type { Context } from "../context";
import { permissionedProcedure, protectedProcedure, raiseApiError, validateInput } from "../index";

/** Stable canonical client contract; ownership and external evidence are server-derived. */
export interface PersonalGoalsApiContract {
  list(input?: Record<string, never>): Promise<GoalSummary[]>;
  detail(input: { id: number }): Promise<GoalDetail>;
  create(input: {
    definition: GoalDefinition;
    clientMutationId: string;
    replacesId?: number;
    replacesVersion?: number;
  }): Promise<GoalSummary>;
  update(input: {
    id: number;
    version: number;
    definition: GoalDefinition;
    clientMutationId: string;
  }): Promise<GoalSummary>;
  setStatus(input: {
    id: number;
    version: number;
    status: "active" | "paused" | "completed";
    clientMutationId: string;
  }): Promise<GoalSummary>;
  delete(input: {
    id: number;
    version: number;
    clientMutationId: string;
  }): Promise<{ id: number; version: number; deleted: true }>;
  createCheckin(input: {
    goalId: number;
    date: string;
    value?: number;
    completed?: boolean;
    notes?: string;
    clientMutationId: string;
  }): Promise<{ id: number; version: number }>;
  updateCheckin(input: {
    id: number;
    goalId: number;
    version: number;
    date: string;
    value?: number;
    completed?: boolean;
    notes?: string;
    clientMutationId: string;
  }): Promise<{ id: number; version: number }>;
  deleteCheckin(input: {
    id: number;
    goalId: number;
    version: number;
    clientMutationId: string;
  }): Promise<{ id: number; deleted: true }>;
  listNeedsConfiguration(
    input?: Record<string, never>,
  ): Promise<Array<{ id: number; title: string; category: string; version: number }>>;
  configureLegacy(input: {
    id: number;
    version: number;
    definition: GoalDefinition;
    clientMutationId: string;
  }): Promise<GoalSummary>;
  listUnassignedLegacy(
    input?: Record<string, never>,
  ): Promise<Array<{ id: number; title: string; category: string; version: number }>>;
  assignLegacy(input: {
    id: number;
    assigneeUserId: string;
    reason: string;
    clientMutationId: string;
  }): Promise<{ id: number; version: number; needsConfiguration: true }>;
}
type Authz = Awaited<ReturnType<typeof requirePermission>>;
const uuid = z.string().uuid();
const positiveId = z.number().int().positive();
const versionNumber = z.number().int().positive();
const checkedDefinition = z.custom<GoalDefinition>((value) => validateGoalDefinition(value).ok);
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
const evaluationShape: z.ZodType<GoalEvaluation> = z.custom<GoalEvaluation>((value) => {
  if (!isRecord(value)) return false;
  const states = ["active", "paused", "completed", "deleted", "overdue", "not-started"];
  const dayStates = ["qualifies", "does-not-qualify", "unknown", "paused", "not-scheduled"];
  return (
    typeof value.asOf === "string" &&
    states.includes(String(value.state)) &&
    typeof value.achieved === "boolean" &&
    (value.achievedDate === null || typeof value.achievedDate === "string") &&
    typeof value.overdue === "boolean" &&
    (value.currentValue === null ||
      (typeof value.currentValue === "number" && Number.isFinite(value.currentValue))) &&
    Number.isInteger(value.currentStreak) &&
    Number.isInteger(value.bestStreak) &&
    isRecord(value.coverage) &&
    [
      value.coverage.completeDays,
      value.coverage.incompleteDays,
      value.coverage.unknownDays,
      value.coverage.pausedDays,
    ].every(Number.isInteger) &&
    Array.isArray(value.unknownReasons) &&
    Array.isArray(value.days) &&
    value.days.every(
      (day) =>
        isRecord(day) && typeof day.date === "string" && dayStates.includes(String(day.state)),
    ) &&
    Array.isArray(value.milestones) &&
    value.milestones.every(
      (m) =>
        isRecord(m) &&
        typeof m.id === "string" &&
        typeof m.value === "number" &&
        typeof m.achieved === "boolean",
    ) &&
    Array.isArray(value.recurringWeeks) &&
    value.recurringWeeks.every(
      (w) => isRecord(w) && typeof w.weekStart === "string" && typeof w.met === "boolean",
    ) &&
    (value.windowCoverage === null ||
      (isRecord(value.windowCoverage) &&
        Number.isInteger(value.windowCoverage.requiredDays) &&
        Number.isInteger(value.windowCoverage.coveredDays) &&
        typeof value.windowCoverage.complete === "boolean"))
  );
});
const goalSummaryObject = z.object({
  id: positiveId,
  version: versionNumber,
  title: z.string(),
  definition: checkedDefinition,
  evaluation: evaluationShape,
  sourceLocked: z.boolean().optional(),
});
const goalSummaryShape: z.ZodType<GoalSummary> = goalSummaryObject;
const goalDetailShape: z.ZodType<GoalDetail> = goalSummaryObject.extend({
  checkins: z.array(
    z.object({
      id: positiveId,
      version: versionNumber,
      date: z.string(),
      value: z.number().nullable(),
      completed: z.boolean().nullable(),
      notes: z.string().nullable(),
    }),
  ),
  checkinHistory: z.array(
    z.object({
      id: positiveId,
      version: versionNumber,
      date: z.string(),
      value: z.number().nullable(),
      completed: z.boolean().nullable(),
      notes: z.string().nullable(),
      deletedAt: z.string().nullable(),
      correctedFromId: positiveId.nullable(),
    }),
  ),
  replacement: z.object({ replacesId: positiveId.nullable(), replacedById: positiveId.nullable() }),
  evidence: z.array(
    z.object({
      id: z.string(),
      source: z.enum(["manual", "water", "supplement", "workout", "sleep"]),
      metric: z.string(),
      occurredAt: z.string().optional(),
      dateOnly: z.string().optional(),
      value: z.number().optional(),
      completed: z.boolean().optional(),
      authoritative: z.boolean().optional(),
      sourceRecordId: z.string().optional(),
    }),
  ),
  history: z.array(
    z.object({
      revision: positiveId,
      definition: checkedDefinition,
      effectiveFrom: z.string(),
      effectiveUntil: z.string().nullable(),
    }),
  ),
});
const listInput = z.strictObject({}).optional();
const detailInput = z.strictObject({ id: positiveId });
const createInput = z
  .strictObject({
    definition: checkedDefinition,
    clientMutationId: uuid,
    replacesId: positiveId.optional(),
    replacesVersion: versionNumber.optional(),
  })
  .refine(
    (v) => (v.replacesId === undefined) === (v.replacesVersion === undefined),
    "Replacement id and version must be supplied together",
  );
const updateInput = z.strictObject({
  id: positiveId,
  version: versionNumber,
  definition: checkedDefinition,
  clientMutationId: uuid,
});
const statusInput = z.strictObject({
  id: positiveId,
  version: versionNumber,
  status: z.enum(["active", "paused", "completed"]),
  clientMutationId: uuid,
});
const deleteInput = z.strictObject({
  id: positiveId,
  version: versionNumber,
  clientMutationId: uuid,
});
const checkinCreateInput = z.strictObject({
  goalId: positiveId,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.number().finite().optional(),
  completed: z.boolean().optional(),
  notes: z.string().max(2000).nullish(),
  clientMutationId: uuid,
});
const checkinUpdateInput = z.strictObject({
  id: positiveId,
  goalId: positiveId,
  version: versionNumber,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.number().finite().optional(),
  completed: z.boolean().optional(),
  notes: z.string().max(2000).nullish(),
  clientMutationId: uuid,
});
const checkinDeleteInput = z.strictObject({
  id: positiveId,
  goalId: positiveId,
  version: versionNumber,
  clientMutationId: uuid,
});
const configureLegacyInput = z.strictObject({
  id: positiveId,
  version: versionNumber,
  definition: checkedDefinition,
  clientMutationId: uuid,
});
const assignLegacyInput = z.strictObject({
  id: positiveId,
  assigneeUserId: z.string().min(1).max(255),
  reason: z.string().trim().min(5).max(500),
  clientMutationId: uuid,
});
const legacyGoalShape = z.object({
  id: positiveId,
  title: z.string(),
  category: z.string(),
  version: versionNumber,
});

function repository(context: Context, authz: Authz) {
  return createPersonalGoalRepository(
    context.db,
    authz.activeOrganizationId,
    authz.user.id,
    (range) =>
      getPersonalSleepDailyEvidence(context.db, {
        organizationId: authz.activeOrganizationId,
        userId: authz.user.id,
        ...range,
      }),
    () => new Date(),
    async (tx, operation, targetId) => {
      if (targetId === null) return;
      const isCheckin = operation.endsWith("Checkin");
      const eventType =
        operation === "create" || operation === "createCheckin"
          ? "RECORD_CREATED"
          : operation === "delete" || operation === "deleteCheckin"
            ? "RECORD_DELETED"
            : "RECORD_UPDATED";
      await writeAuditLog({
        db: tx,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType,
        targetType: isCheckin ? "goal_checkin" : "goal",
        targetId: String(targetId),
        correlationId: context.correlationId,
        metadata: { resource: "goals", action: "write" },
      });
    },
  );
}
function mapError(error: unknown): never {
  if (error instanceof PersonalGoalNotFoundError) throw raiseApiError("NOT_FOUND", error.message);
  if (error instanceof PersonalGoalConflictError) throw raiseApiError("CONFLICT", error.message);
  if (error instanceof PersonalGoalValidationError)
    throw raiseApiError("INVALID_INPUT", error.message);
  if (error instanceof PersonalGoalConfigurationError)
    throw raiseApiError("INTERNAL", "Stored goal configuration is invalid.");
  throw error;
}
async function requireWrite(context: Context): Promise<Authz> {
  try {
    return await requirePermission(context.honoContext, { resource: "goals", action: "write" });
  } catch (error) {
    if (error instanceof AuthzHttpError) throw raiseApiError(error.code, error.message);
    throw raiseApiError("INTERNAL", "Authorization failed.");
  }
}
async function requireAdmin(context: Context): Promise<Authz> {
  try {
    return await requirePermission(context.honoContext, {
      resource: "goals",
      action: "admin_access",
    });
  } catch (error) {
    if (error instanceof AuthzHttpError) throw raiseApiError(error.code, error.message);
    throw raiseApiError("INTERNAL", "Authorization failed.");
  }
}

export const goalsRouter = {
  list: permissionedProcedure({ resource: "goals", action: "read" })
    .input(listInput)
    .output(z.array(goalSummaryShape))
    .handler(({ context }) => repository(context, context.authz).list()),
  detail: permissionedProcedure({ resource: "goals", action: "read" })
    .use(validateInput(detailInput))
    .input(detailInput)
    .output(goalDetailShape)
    .handler(async ({ input, context }) => {
      try {
        return await repository(context, context.authz).detail(input.id);
      } catch (error) {
        return mapError(error);
      }
    }),
  create: protectedProcedure
    .use(validateInput(createInput))
    .input(createInput)
    .output(goalSummaryShape)
    .handler(async ({ input, context }) => {
      const authz = await requireWrite(context);
      try {
        return await repository(context, authz).create(input);
      } catch (error) {
        return mapError(error);
      }
    }),
  update: protectedProcedure
    .use(validateInput(updateInput))
    .input(updateInput)
    .output(goalSummaryShape)
    .handler(async ({ input, context }) => {
      const authz = await requireWrite(context);
      try {
        return await repository(context, authz).update(input);
      } catch (error) {
        return mapError(error);
      }
    }),
  setStatus: protectedProcedure
    .use(validateInput(statusInput))
    .input(statusInput)
    .output(goalSummaryShape)
    .handler(async ({ input, context }) => {
      const authz = await requireWrite(context);
      try {
        return await repository(context, authz).setStatus(input);
      } catch (error) {
        return mapError(error);
      }
    }),
  delete: protectedProcedure
    .use(validateInput(deleteInput))
    .input(deleteInput)
    .output(z.object({ id: positiveId, version: versionNumber, deleted: z.literal(true) }))
    .handler(async ({ input, context }) => {
      const authz = await requireWrite(context);
      try {
        return await repository(context, authz).delete(input);
      } catch (error) {
        return mapError(error);
      }
    }),
  createCheckin: protectedProcedure
    .use(validateInput(checkinCreateInput))
    .input(checkinCreateInput)
    .output(z.object({ id: positiveId, version: versionNumber }))
    .handler(async ({ input, context }) => {
      const authz = await requireWrite(context);
      try {
        return await repository(context, authz).createCheckin(input);
      } catch (error) {
        return mapError(error);
      }
    }),
  updateCheckin: protectedProcedure
    .use(validateInput(checkinUpdateInput))
    .input(checkinUpdateInput)
    .output(z.object({ id: positiveId, version: versionNumber }))
    .handler(async ({ input, context }) => {
      const authz = await requireWrite(context);
      try {
        return await repository(context, authz).updateCheckin(input);
      } catch (error) {
        return mapError(error);
      }
    }),
  deleteCheckin: protectedProcedure
    .use(validateInput(checkinDeleteInput))
    .input(checkinDeleteInput)
    .output(z.object({ id: positiveId, deleted: z.literal(true) }))
    .handler(async ({ input, context }) => {
      const authz = await requireWrite(context);
      try {
        return await repository(context, authz).deleteCheckin(input);
      } catch (error) {
        return mapError(error);
      }
    }),
  listNeedsConfiguration: permissionedProcedure({ resource: "goals", action: "read" })
    .input(listInput)
    .output(z.array(legacyGoalShape))
    .handler(async ({ context }) => repository(context, context.authz).listNeedsConfiguration()),
  configureLegacy: protectedProcedure
    .use(validateInput(configureLegacyInput))
    .input(configureLegacyInput)
    .output(goalSummaryShape)
    .handler(async ({ input, context }) => {
      const authz = await requireWrite(context);
      try {
        return await repository(context, authz).configureLegacy(input);
      } catch (error) {
        return mapError(error);
      }
    }),
  listUnassignedLegacy: permissionedProcedure({ resource: "goals", action: "admin_access" })
    .input(listInput)
    .output(z.array(legacyGoalShape))
    .handler(async ({ context }) => repository(context, context.authz).listUnassignedLegacy()),
  assignLegacy: protectedProcedure
    .use(validateInput(assignLegacyInput))
    .input(assignLegacyInput)
    .output(
      z.object({ id: positiveId, version: versionNumber, needsConfiguration: z.literal(true) }),
    )
    .handler(async ({ input, context }) => {
      const authz = await requireAdmin(context);
      try {
        return await repository(context, authz).assignLegacy(input);
      } catch (error) {
        return mapError(error);
      }
    }),
};
