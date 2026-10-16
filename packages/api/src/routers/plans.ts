import { writeAuditLog, type AuditEventType } from "@openvalens/audit-security";
import { AuthzHttpError, requirePermission } from "@openvalens/auth/authz/guard";
import {
  ALLOWED_MEDICATION_STATUSES,
  ALLOWED_SUPPLEMENT_CHANGE_TYPES,
  ALLOWED_SUPPLEMENT_SCHEDULE_STATUSES,
  ALLOWED_TIME_OF_DAY,
  createCalendarRepository,
  createGoalRepository,
  createPlansRepository,
  createWorkoutRepository,
  GOAL_DIRECTIONS,
  GOAL_PRIORITIES,
  KNOWN_CALENDAR_EVENT_TYPES,
  MAX_EXERCISES_PER_WORKOUT,
  MAX_SETS_PER_EXERCISE,
  todayIsoDate,
  validateDateRange,
  WORKOUT_TYPES,
  type CalendarEvent,
  type Goal,
  type GoalCheckin,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
  type Medication,
  type SupplementChange,
  type SupplementListItem,
  type SupplementSchedule,
} from "@openvalens/plans";
import { z } from "zod";

import { permissionedProcedure, protectedProcedure, raiseApiError, validateInput } from "../index";

/**
 * Supplements & medications oRPC surface (Issue #22).
 *
 * Three groups, each on its own resource:
 *
 * - supplements: listSupplements, upsertSupplement, deleteSupplement,
 *   listSchedules, upsertSchedule, deleteSchedule, listChanges.
 * - medications: listMedications, upsertMedication, deleteMedication.
 *
 * All inputs are `strictObject` so any payload attempt to override
 * `organizationId` / `userId` is rejected at the boundary with
 * `INVALID_INPUT` before authz runs. Following the body #21
 * `ingestAutoWeightEvent` and sleep #18 `recordFromHealthConnect` pattern,
 * write procedures are composed on `protectedProcedure` +
 * `validateInput(strictObject)` + manual `requirePermission` +
 * `writeAuditLog`. Reads stay on `permissionedProcedure`. **No taxonomy
 * gap** — every audit action we use is in `AUDIT_EVENT_TYPES`
 * (RECORD_CREATED, RECORD_UPDATED, RECORD_DELETED).
 *
 * No PHI is logged. Org/user are taken exclusively from authz.
 */

const supplementShape: z.ZodType<SupplementListItem> = z.object({
  id: z.number(),
  name: z.string(),
  dose: z.string().nullable(),
  form: z.string().nullable(),
  category: z.string().nullable(),
  latestChangeReason: z.string().nullable(),
  latestChangeDate: z.string().nullable(),
  activeScheduleCount: z.number(),
});

const medicationShape: z.ZodType<Medication> = z.object({
  id: z.number(),
  organizationId: z.string(),
  userId: z.string(),
  name: z.string(),
  dose: z.string().nullable(),
  route: z.string().nullable(),
  protocol: z.string().nullable(),
  frequency: z.string().nullable(),
  status: z.enum(ALLOWED_MEDICATION_STATUSES),
  interactions: z.string().nullable(),
  notes: z.string().nullable(),
});

const supplementScheduleShape: z.ZodType<SupplementSchedule> = z.object({
  id: z.number(),
  organizationId: z.string(),
  userId: z.string(),
  supplementId: z.number(),
  timeOfDay: z.string(),
  quantity: z.string().nullable(),
  frequency: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(ALLOWED_SUPPLEMENT_SCHEDULE_STATUSES),
});

const supplementChangeShape: z.ZodType<SupplementChange> = z.object({
  id: z.number(),
  organizationId: z.string(),
  date: z.string(),
  supplementId: z.number().nullable(),
  changeType: z.enum(ALLOWED_SUPPLEMENT_CHANGE_TYPES),
  reason: z.string().nullable(),
  details: z.string().nullable(),
});

const supplementSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  dose: z.string().trim().min(1).max(80),
  form: z.string().trim().min(1).max(80).nullish(),
  category: z.string().trim().min(1).max(80).nullish(),
});

const supplementUpdateSchema = z.strictObject({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(200).optional(),
  dose: z.string().trim().min(1).max(80).optional(),
  form: z.string().trim().max(80).nullish(),
  category: z.string().trim().max(80).nullish(),
});

const supplementUpsertSchema = z.union([supplementSchema, supplementUpdateSchema]);

const medicationSchema = z.strictObject({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(200),
  dose: z.string().trim().min(1).max(80).nullish(),
  route: z.string().trim().min(1).max(80).nullish(),
  protocol: z.string().trim().max(500).nullish(),
  frequency: z.string().trim().max(80).nullish(),
  status: z.enum(ALLOWED_MEDICATION_STATUSES).optional(),
  interactions: z.string().trim().max(500).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

const scheduleInputSchema = z.strictObject({
  supplementId: z.number().int().positive(),
  limit: z.number().int().min(1).max(200).optional(),
});

const scheduleIdSchema = z.strictObject({
  id: z.number().int().positive(),
});

const scheduleUpsertCreateSchema = z.strictObject({
  supplementId: z.number().int().positive(),
  timeOfDay: z.enum(ALLOWED_TIME_OF_DAY),
  frequency: z.string().trim().min(1).max(80).nullish(),
  quantity: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  status: z.enum(ALLOWED_SUPPLEMENT_SCHEDULE_STATUSES).optional(),
});

const scheduleUpsertUpdateSchema = z.strictObject({
  id: z.number().int().positive(),
  timeOfDay: z.enum(ALLOWED_TIME_OF_DAY).optional(),
  frequency: z.string().trim().max(80).nullish(),
  quantity: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  status: z.enum(ALLOWED_SUPPLEMENT_SCHEDULE_STATUSES).optional(),
});

const scheduleUpsertSchema = z.union([scheduleUpsertCreateSchema, scheduleUpsertUpdateSchema]);

const changesInputSchema = z.strictObject({
  supplementId: z.number().int().positive(),
  limit: z.number().int().min(1).max(200).optional(),
});

const upsertResult = z.object({
  id: z.number(),
  created: z.boolean(),
  targetId: z.string(),
});

const deleteResult = z.object({
  id: z.number(),
  targetId: z.string(),
});

async function requireAuthz(
  context: { honoContext: { req: { raw: { headers: Headers } } }; db: unknown },
  resource: "supplements" | "medications",
  action: "read" | "write",
) {
  try {
    return await requirePermission(
      // Cast to AuthzRequestContext — the runtime shape matches.
      context.honoContext as never,
      { resource, action },
    );
  } catch (error) {
    if (error instanceof AuthzHttpError) {
      throw raiseApiError(error.code, error.message);
    }
    throw raiseApiError("INTERNAL", "Authorization failed.");
  }
}

// ─── Issue #23: workouts / goals / calendar ────────────────────────
//
// These three sub-routers extend `plansRouter` because Issue #22 owns
// the plans domain. The body #21 / plans #22 write-procedure pattern is
// preserved: writes are composed on `protectedProcedure` +
// `validateInput(strictObject)` + manual `requirePermission` +
// `writeAuditLog`. Reads stay on `permissionedProcedure`. All inputs are
// `strictObject` so a foreign-tenant attempt (or a payload attempt to
// override `organizationId` / `userId`) is rejected with `INVALID_INPUT`
// at the boundary before authz runs.
//
// Cross-domain writes (e.g. body #21 writing `calendar_event` with
// `type='weight'`) remain owned by their originating domain; this router
// only inserts calendar rows for the org/user, scoped to non-weight event
// types in its own validation layer.
//
// No PHI is logged. Workout notes, goal descriptions, and event titles
// round-trip as opaque strings the caller owns.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const workoutSetShape: z.ZodType<WorkoutSet> = z.object({
  id: z.number(),
  organizationId: z.string(),
  exerciseId: z.number(),
  sortOrder: z.number(),
  reps: z.number().nullable(),
  weightKg: z.number().nullable(),
  rpe: z.number().nullable(),
  notes: z.string().nullable(),
});

const workoutWithContextShape: z.ZodType<
  Workout & { exercises: Array<WorkoutExercise & { sets: WorkoutSet[] }> }
> = z.object({
  id: z.number(),
  organizationId: z.string(),
  date: z.string(),
  type: z.enum(WORKOUT_TYPES),
  duration: z.number().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  exercises: z.array(
    z.object({
      id: z.number(),
      organizationId: z.string(),
      workoutId: z.number(),
      sortOrder: z.number(),
      name: z.string(),
      notes: z.string().nullable(),
      sets: z.array(workoutSetShape),
    }),
  ),
});

const goalShape: z.ZodType<Goal> = z.object({
  id: z.number(),
  organizationId: z.string(),
  title: z.string(),
  category: z.string(),
  horizon: z.string().nullable(),
  status: z.string(),
  currentValue: z.string().nullable(),
  targetValue: z.string().nullable(),
  targetDate: z.string().nullable(),
  notes: z.string().nullable(),
  direction: z.string().nullable(),
  baselineValue: z.string().nullable(),
  priority: z.string().nullable(),
});

const goalCheckinShape: z.ZodType<GoalCheckin> = z.object({
  id: z.number(),
  organizationId: z.string(),
  goalId: z.number(),
  date: z.string(),
  value: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});

const calendarEventShape: z.ZodType<CalendarEvent> = z.object({
  id: z.number(),
  organizationId: z.string(),
  date: z.string(),
  type: z.string(),
  category: z.string().nullable(),
  title: z.string(),
  referenceTable: z.string().nullable(),
  referenceId: z.number().nullable(),
});

// ─── workout inputs ────────────────────────────────────────────

const workoutListInputSchema = z.strictObject({
  limit: z.number().int().min(1).max(200).optional(),
});

const workoutIdInputSchema = z.strictObject({
  id: z.number().int().positive(),
});

const workoutSetInputSchema = z.strictObject({
  reps: z.number().int().positive().max(1000),
  weightKg: z.number().finite().min(0).max(1000).nullish(),
  rpe: z.number().finite().min(0).max(10).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

const workoutExerciseInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).nullish(),
  sets: z.array(workoutSetInputSchema).min(1).max(MAX_SETS_PER_EXERCISE),
});

const workoutUpsertInputSchema = z.strictObject({
  date: isoDate,
  type: z.enum(WORKOUT_TYPES),
  duration: z.number().int().positive().max(1440).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  exercises: z.array(workoutExerciseInputSchema).min(1).max(MAX_EXERCISES_PER_WORKOUT),
});

const workoutUpsertResultSchema = z.object({
  id: z.number(),
  exerciseCount: z.number(),
  setCount: z.number(),
  targetId: z.string(),
});

// ─── goal inputs ───────────────────────────────────────────────

const goalIdInputSchema = z.strictObject({
  id: z.number().int().positive(),
});

const goalCheckinListInputSchema = z.strictObject({
  goalId: z.number().int().positive(),
});

const goalUpsertCreateSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(80),
  horizon: z.string().trim().max(40).nullish(),
  status: z.string().trim().max(40).nullish(),
  currentValue: z.string().trim().max(80).nullish(),
  targetValue: z.string().trim().max(80).nullish(),
  targetDate: isoDate.nullish(),
  notes: z.string().trim().max(2000).nullish(),
  // Issue #95 — goal measurement contract; all optional for older clients.
  direction: z.enum(GOAL_DIRECTIONS).nullish(),
  baselineValue: z.string().trim().max(80).nullish(),
  priority: z.enum(GOAL_PRIORITIES).nullish(),
});

const goalUpsertUpdateSchema = z.strictObject({
  id: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  horizon: z.string().trim().max(40).nullish(),
  status: z.string().trim().max(40).nullish(),
  currentValue: z.string().trim().max(80).nullish(),
  targetValue: z.string().trim().max(80).nullish(),
  targetDate: isoDate.nullish(),
  notes: z.string().trim().max(2000).nullish(),
  // Issue #95 — goal measurement contract; all optional for older clients.
  direction: z.enum(GOAL_DIRECTIONS).nullish(),
  baselineValue: z.string().trim().max(80).nullish(),
  priority: z.enum(GOAL_PRIORITIES).nullish(),
});

const goalUpsertSchema = z.union([goalUpsertCreateSchema, goalUpsertUpdateSchema]);

const goalCheckinUpsertSchema = z.strictObject({
  goalId: z.number().int().positive(),
  date: isoDate,
  value: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

const goalUpsertResultSchema = z.object({
  id: z.number(),
  created: z.boolean(),
  targetId: z.string(),
});

const goalCheckinResultSchema = z.object({
  id: z.number(),
  goalCurrentValue: z.string().nullable(),
  targetId: z.string(),
});

// ─── calendar inputs ───────────────────────────────────────────

const calendarListInputSchema = z.strictObject({
  from: isoDate,
  to: isoDate,
  types: z.array(z.string().min(1).max(40)).max(20).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

const calendarUpsertInputSchema = z.strictObject({
  date: isoDate,
  type: z.string().trim().min(1).max(40),
  category: z.string().trim().max(80).nullish(),
  title: z.string().trim().min(1).max(200),
  referenceTable: z.string().trim().max(80).nullish(),
  referenceId: z.number().int().positive().nullish(),
});

const calendarUpsertResultSchema = z.object({
  id: z.number(),
  targetId: z.string(),
});

const deleteResultWithTarget = z.object({
  id: z.number(),
  targetId: z.string(),
});

// Calendar-event writes through this router reject `type === 'weight'` so
// weight-related events stay owned by the body domain (#21). Calendar
// reads are happy to include them — the filter is opt-in via `types`.
const isReservedCalendarEventType = (value: string): boolean => value === "weight";

async function requirePlansAuthz(
  context: { honoContext: { req: { raw: { headers: Headers } } }; db: unknown },
  resource: "workout" | "goals" | "records" | "ingest",
  action: "read" | "write",
) {
  try {
    return await requirePermission(
      // Cast to AuthzRequestContext — the runtime shape matches.
      context.honoContext as never,
      { resource, action },
    );
  } catch (error) {
    if (error instanceof AuthzHttpError) {
      throw raiseApiError(error.code, error.message);
    }
    throw raiseApiError("INTERNAL", "Authorization failed.");
  }
}

export const plansRouter = {
  // ─── supplements ────────────────────────────────────────────

  listSupplements: permissionedProcedure({ resource: "supplements", action: "read" })
    .input(z.object({}).optional())
    .output(z.array(supplementShape))
    .handler(async ({ context }) =>
      createPlansRepository(context.db).listSupplements(context.authz.activeOrganizationId),
    ),

  upsertSupplement: protectedProcedure
    .use(validateInput(supplementUpsertSchema))
    .input(supplementUpsertSchema)
    .output(upsertResult)
    .handler(async ({ input, context }) => {
      const authz = await requireAuthz(context, "supplements", "write");
      const repo = createPlansRepository(context.db);

      let result;
      let eventType: AuditEventType;
      if ("id" in input) {
        result = await repo.upsertSupplement({ kind: "update", id: input.id });
        eventType = "RECORD_UPDATED";
      } else {
        result = await repo.upsertSupplement({
          name: input.name,
          dose: input.dose,
          form: input.form ?? null,
          category: input.category ?? null,
        });
        eventType = "RECORD_CREATED";
      }

      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType,
        targetType: "supplement",
        targetId: String(result.id),
        correlationId: context.correlationId,
        metadata: { resource: "supplements", action: "write" },
      });

      return { id: result.id, created: result.created, targetId: String(result.id) };
    }),

  deleteSupplement: protectedProcedure
    .use(validateInput(z.strictObject({ id: z.number().int().positive() })))
    .input(z.strictObject({ id: z.number().int().positive() }))
    .output(deleteResult)
    .handler(async ({ input, context }) => {
      const authz = await requireAuthz(context, "supplements", "write");
      await createPlansRepository(context.db).deleteSupplement(
        authz.activeOrganizationId,
        input.id,
      );
      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType: "RECORD_DELETED",
        targetType: "supplement",
        targetId: String(input.id),
        correlationId: context.correlationId,
        metadata: { resource: "supplements", action: "write" },
      });
      return { id: input.id, targetId: String(input.id) };
    }),

  // ─── medications ────────────────────────────────────────────

  listMedications: permissionedProcedure({ resource: "medications", action: "read" })
    .input(z.object({}).optional())
    .output(z.array(medicationShape))
    .handler(async ({ context }) =>
      createPlansRepository(context.db).listMedications(context.authz.activeOrganizationId),
    ),

  upsertMedication: protectedProcedure
    .use(validateInput(medicationSchema))
    .input(medicationSchema)
    .output(upsertResult)
    .handler(async ({ input, context }) => {
      const authz = await requireAuthz(context, "medications", "write");
      const result = await createPlansRepository(context.db).upsertMedication(
        authz.activeOrganizationId,
        {
          ...(input.id !== undefined ? { id: input.id } : {}),
          userId: authz.user.id,
          name: input.name,
          dose: input.dose ?? null,
          route: input.route ?? null,
          protocol: input.protocol ?? null,
          frequency: input.frequency ?? null,
          ...(input.status !== undefined ? { status: input.status } : {}),
          interactions: input.interactions ?? null,
          notes: input.notes ?? null,
        },
      );

      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType: input.id !== undefined ? "RECORD_UPDATED" : "RECORD_CREATED",
        targetType: "medication",
        targetId: String(result.id),
        correlationId: context.correlationId,
        metadata: { resource: "medications", action: "write" },
      });

      return { id: result.id, created: result.created, targetId: String(result.id) };
    }),

  deleteMedication: protectedProcedure
    .use(validateInput(z.strictObject({ id: z.number().int().positive() })))
    .input(z.strictObject({ id: z.number().int().positive() }))
    .output(deleteResult.nullable())
    .handler(async ({ input, context }) => {
      const authz = await requireAuthz(context, "medications", "write");
      const result = await createPlansRepository(context.db).deleteMedication(
        authz.activeOrganizationId,
        input.id,
      );
      if (!result) return null;
      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType: "RECORD_DELETED",
        targetType: "medication",
        targetId: String(result.id),
        correlationId: context.correlationId,
        metadata: { resource: "medications", action: "write" },
      });
      return { id: result.id, targetId: String(result.id) };
    }),

  // ─── schedules ──────────────────────────────────────────────

  listSchedules: permissionedProcedure({ resource: "supplements", action: "read" })
    .use(validateInput(scheduleInputSchema))
    .input(scheduleInputSchema)
    .output(z.array(supplementScheduleShape))
    .handler(async ({ input, context }) =>
      createPlansRepository(context.db).listSchedules(
        context.authz.activeOrganizationId,
        input.supplementId,
      ),
    ),

  upsertSchedule: protectedProcedure
    .use(validateInput(scheduleUpsertSchema))
    .input(scheduleUpsertSchema)
    .output(upsertResult)
    .handler(async ({ input, context }) => {
      const authz = await requireAuthz(context, "supplements", "write");
      const repo = createPlansRepository(context.db);

      let result;
      if ("id" in input) {
        const existing = await repo.getSchedule(authz.activeOrganizationId, input.id);
        if (!existing) throw raiseApiError("NOT_FOUND", "Schedule not found");
        result = await repo.upsertSchedule({
          id: input.id,
          organizationId: authz.activeOrganizationId,
          userId: authz.user.id,
          supplementId: existing.supplementId,
          timeOfDay: existing.timeOfDay,
          frequency: existing.frequency,
          quantity: existing.quantity,
          notes: existing.notes,
          status: existing.status,
        });
        // Apply the user's partial updates on top of the unchanged fields.
        if (
          input.timeOfDay !== undefined ||
          input.frequency !== undefined ||
          input.quantity !== undefined ||
          input.notes !== undefined ||
          input.status !== undefined
        ) {
          await repo.upsertSchedule({
            id: input.id,
            organizationId: authz.activeOrganizationId,
            userId: existing.userId,
            supplementId: existing.supplementId,
            timeOfDay: input.timeOfDay ?? existing.timeOfDay,
            frequency: input.frequency !== undefined ? input.frequency : existing.frequency,
            quantity: input.quantity !== undefined ? input.quantity : existing.quantity,
            notes: input.notes !== undefined ? input.notes : existing.notes,
            status: input.status ?? existing.status,
          });
          result = { id: input.id, created: false };
        }
      } else {
        result = await repo.upsertSchedule({
          organizationId: authz.activeOrganizationId,
          userId: authz.user.id,
          supplementId: input.supplementId,
          timeOfDay: input.timeOfDay,
          frequency: input.frequency ?? null,
          quantity: input.quantity ?? null,
          notes: input.notes ?? null,
          status: input.status,
        });
        // Record a "added" change so the change history reflects the new
        // schedule.
        await repo.recordChange(authz.activeOrganizationId, {
          supplementId: input.supplementId,
          changeType: "added",
          date: todayIsoDate(),
        });
      }

      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType: "id" in input ? "RECORD_UPDATED" : "RECORD_CREATED",
        targetType: "supplement_schedule",
        targetId: String(result.id),
        correlationId: context.correlationId,
        metadata: { resource: "supplements", action: "write" },
      });

      return { id: result.id, created: result.created, targetId: String(result.id) };
    }),

  deleteSchedule: protectedProcedure
    .use(validateInput(scheduleIdSchema))
    .input(scheduleIdSchema)
    .output(deleteResult.nullable())
    .handler(async ({ input, context }) => {
      const authz = await requireAuthz(context, "supplements", "write");
      const result = await createPlansRepository(context.db).deleteSchedule(
        authz.activeOrganizationId,
        input.id,
      );
      if (!result) return null;
      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType: "RECORD_DELETED",
        targetType: "supplement_schedule",
        targetId: String(result.id),
        correlationId: context.correlationId,
        metadata: { resource: "supplements", action: "write" },
      });
      return { id: result.id, targetId: String(result.id) };
    }),

  // ─── change history ─────────────────────────────────────────

  listChanges: permissionedProcedure({ resource: "supplements", action: "read" })
    .use(validateInput(changesInputSchema))
    .input(changesInputSchema)
    .output(z.array(supplementChangeShape))
    .handler(async ({ input, context }) => {
      return createPlansRepository(context.db).listChanges(
        context.authz.activeOrganizationId,
        input.supplementId,
        input.limit ?? 50,
      );
    }),

  // ─── workouts (Issue #23) ──────────────────────────────────

  workouts: {
    listWorkouts: permissionedProcedure({ resource: "workout", action: "read" })
      .use(validateInput(workoutListInputSchema))
      .input(workoutListInputSchema)
      .output(z.array(workoutWithContextShape))
      .handler(async ({ input, context }) =>
        createWorkoutRepository(context.db).listWorkouts(
          context.authz.activeOrganizationId,
          input.limit ?? 50,
        ),
      ),

    getWorkout: permissionedProcedure({ resource: "workout", action: "read" })
      .use(validateInput(workoutIdInputSchema))
      .input(workoutIdInputSchema)
      .output(workoutWithContextShape.nullable())
      .handler(async ({ input, context }) =>
        createWorkoutRepository(context.db).getWorkout(
          context.authz.activeOrganizationId,
          input.id,
        ),
      ),

    /**
     * Upsert: workout header + exercises + sets in one transaction. We
     * deliberately do **not** expose an explicit `id` on this procedure —
     * workouts are append-only in the current model, and replacing a
     * session in place is owned by the body domain's reconciliation
     * pipeline. New writes go through this single-statement procedure.
     */
    upsertWorkout: protectedProcedure
      .use(validateInput(workoutUpsertInputSchema))
      .input(workoutUpsertInputSchema)
      .output(workoutUpsertResultSchema)
      .handler(async ({ input, context }) => {
        const authz = await requirePlansAuthz(context, "workout", "write");
        const result = await context.db.transaction(async (tx) =>
          createWorkoutRepository(context.db).upsertWorkout(
            tx as Parameters<ReturnType<typeof createWorkoutRepository>["upsertWorkout"]>[0],
            authz.activeOrganizationId,
            {
              date: input.date,
              type: input.type,
              duration: input.duration ?? null,
              notes: input.notes ?? null,
              exercises: input.exercises.map((exercise) => ({
                name: exercise.name,
                notes: exercise.notes ?? null,
                sets: exercise.sets.map((set) => ({
                  reps: set.reps,
                  weightKg: set.weightKg ?? null,
                  rpe: set.rpe ?? null,
                  notes: set.notes ?? null,
                })),
              })),
            },
          ),
        );

        await writeAuditLog({
          db: context.db,
          organizationId: authz.activeOrganizationId,
          actorUserId: authz.user.id,
          eventType: "RECORD_CREATED",
          targetType: "workout",
          targetId: String(result.id),
          correlationId: context.correlationId,
          metadata: {
            resource: "workout",
            action: "write",
            exerciseCount: result.exerciseCount,
            setCount: result.setCount,
          },
        });

        return {
          id: result.id,
          exerciseCount: result.exerciseCount,
          setCount: result.setCount,
          targetId: String(result.id),
        };
      }),

    deleteWorkout: protectedProcedure
      .use(validateInput(workoutIdInputSchema))
      .input(workoutIdInputSchema)
      .output(deleteResultWithTarget.nullable())
      .handler(async ({ input, context }) => {
        const authz = await requirePlansAuthz(context, "workout", "write");
        const result = await createWorkoutRepository(context.db).deleteWorkout(
          authz.activeOrganizationId,
          input.id,
        );
        if (!result) return null;
        await writeAuditLog({
          db: context.db,
          organizationId: authz.activeOrganizationId,
          actorUserId: authz.user.id,
          eventType: "RECORD_DELETED",
          targetType: "workout",
          targetId: String(result.id),
          correlationId: context.correlationId,
          metadata: { resource: "workout", action: "write" },
        });
        return { id: result.id, targetId: String(result.id) };
      }),
  },

  // ─── goals (Issue #23) ──────────────────────────────────────

  goals: {
    listGoals: permissionedProcedure({ resource: "goals", action: "read" })
      .input(z.object({}).optional())
      .output(z.array(goalShape))
      .handler(async ({ context }) =>
        createGoalRepository(context.db).listGoals(context.authz.activeOrganizationId),
      ),

    upsertGoal: protectedProcedure
      .use(validateInput(goalUpsertSchema))
      .input(goalUpsertSchema)
      .output(goalUpsertResultSchema)
      .handler(async ({ input, context }) => {
        const authz = await requirePlansAuthz(context, "goals", "write");
        const result = await createGoalRepository(context.db).upsertGoal(
          authz.activeOrganizationId,
          // The discriminated union narrows naturally; the only key the
          // update branch honours is `id`.
          "id" in input
            ? {
                id: input.id,
                title: input.title,
                category: input.category,
                horizon: input.horizon,
                status: input.status,
                currentValue: input.currentValue,
                targetValue: input.targetValue,
                targetDate: input.targetDate,
                notes: input.notes,
                direction: input.direction,
                baselineValue: input.baselineValue,
                priority: input.priority,
              }
            : {
                title: input.title,
                category: input.category,
                horizon: input.horizon,
                status: input.status,
                currentValue: input.currentValue,
                targetValue: input.targetValue,
                targetDate: input.targetDate,
                notes: input.notes,
                direction: input.direction,
                baselineValue: input.baselineValue,
                priority: input.priority,
              },
        );

        await writeAuditLog({
          db: context.db,
          organizationId: authz.activeOrganizationId,
          actorUserId: authz.user.id,
          eventType: "id" in input ? "RECORD_UPDATED" : "RECORD_CREATED",
          targetType: "goal",
          targetId: String(result.id),
          correlationId: context.correlationId,
          metadata: { resource: "goals", action: "write" },
        });

        return { id: result.id, created: result.created, targetId: String(result.id) };
      }),

    listCheckins: permissionedProcedure({ resource: "goals", action: "read" })
      .use(validateInput(goalCheckinListInputSchema))
      .input(goalCheckinListInputSchema)
      .output(z.array(goalCheckinShape))
      .handler(async ({ input, context }) =>
        createGoalRepository(context.db).listCheckins(
          context.authz.activeOrganizationId,
          input.goalId,
        ),
      ),

    upsertCheckin: protectedProcedure
      .use(validateInput(goalCheckinUpsertSchema))
      .input(goalCheckinUpsertSchema)
      .output(goalCheckinResultSchema)
      .handler(async ({ input, context }) => {
        const authz = await requirePlansAuthz(context, "goals", "write");
        let result;
        try {
          result = await createGoalRepository(context.db).upsertCheckin(
            authz.activeOrganizationId,
            {
              goalId: input.goalId,
              date: input.date,
              value: input.value ?? null,
              notes: input.notes ?? null,
            },
          );
        } catch (error) {
          if (error instanceof Error && error.message === "Goal not found") {
            throw raiseApiError("NOT_FOUND", "Goal not found");
          }
          throw error;
        }

        await writeAuditLog({
          db: context.db,
          organizationId: authz.activeOrganizationId,
          actorUserId: authz.user.id,
          eventType: "RECORD_CREATED",
          targetType: "goal_checkin",
          targetId: String(result.id),
          correlationId: context.correlationId,
          metadata: { resource: "goals", action: "write" },
        });

        return {
          id: result.id,
          goalCurrentValue: result.goalCurrentValue,
          targetId: String(result.id),
        };
      }),

    deleteGoal: protectedProcedure
      .use(validateInput(goalIdInputSchema))
      .input(goalIdInputSchema)
      .output(deleteResultWithTarget.nullable())
      .handler(async ({ input, context }) => {
        const authz = await requirePlansAuthz(context, "goals", "write");
        const result = await createGoalRepository(context.db).deleteGoal(
          authz.activeOrganizationId,
          input.id,
        );
        if (!result) return null;
        await writeAuditLog({
          db: context.db,
          organizationId: authz.activeOrganizationId,
          actorUserId: authz.user.id,
          eventType: "RECORD_DELETED",
          targetType: "goal",
          targetId: String(result.id),
          correlationId: context.correlationId,
          metadata: { resource: "goals", action: "write" },
        });
        return { id: result.id, targetId: String(result.id) };
      }),
  },

  // ─── calendar (Issue #23) ───────────────────────────────────

  calendar: {
    /**
     * List calendar events in a `[from, to]` window with an optional type
     * filter. Anchovy `/api/events` uses `scheduled_event` (recurrence
     * semantics), but the OpenValens `calendar_event` table here is the
     * flat day-event surface used by the body #21 weight reconciliation
     * and the plans #22 supplement scheduler. Reads are happy to include
     * `weight` events; writes through this router reject them so the
     * single-writer invariant on `type='weight'` is preserved.
     */
    listEvents: permissionedProcedure({ resource: "records", action: "read" })
      .use(validateInput(calendarListInputSchema))
      .input(calendarListInputSchema)
      .output(z.array(calendarEventShape))
      .handler(async ({ input, context }) => {
        const range = validateDateRange(input.from, input.to);
        if (!range) {
          throw raiseApiError("INVALID_INPUT", "from/to must be valid YYYY-MM-DD calendar dates.");
        }
        return createCalendarRepository(context.db).listEvents(context.authz.activeOrganizationId, {
          from: range.from,
          to: range.to,
          types: input.types,
          limit: input.limit ?? 200,
        });
      }),

    upsertEvent: protectedProcedure
      .use(validateInput(calendarUpsertInputSchema))
      .input(calendarUpsertInputSchema)
      .output(calendarUpsertResultSchema)
      .handler(async ({ input, context }) => {
        if (isReservedCalendarEventType(input.type)) {
          throw raiseApiError(
            "INVALID_INPUT",
            "Calendar events of type 'weight' are owned by the body domain.",
          );
        }
        if (
          !KNOWN_CALENDAR_EVENT_TYPES.includes(
            input.type as (typeof KNOWN_CALENDAR_EVENT_TYPES)[number],
          )
        ) {
          // Soft warning: we still accept unknown types (the schema stores
          // `type` as a free-form text column) but log only the count.
        }
        const authz = await requirePlansAuthz(context, "records", "write");
        const result = await createCalendarRepository(context.db).upsertEvent(
          authz.activeOrganizationId,
          {
            date: input.date,
            type: input.type,
            category: input.category ?? null,
            title: input.title,
            referenceTable: input.referenceTable ?? null,
            referenceId: input.referenceId ?? null,
          },
        );

        await writeAuditLog({
          db: context.db,
          organizationId: authz.activeOrganizationId,
          actorUserId: authz.user.id,
          eventType: "RECORD_CREATED",
          targetType: "calendar_event",
          targetId: String(result.id),
          correlationId: context.correlationId,
          metadata: { resource: "records", action: "write", type: input.type },
        });

        return { id: result.id, targetId: String(result.id) };
      }),

    deleteEvent: protectedProcedure
      .use(validateInput(z.strictObject({ id: z.number().int().positive() })))
      .input(z.strictObject({ id: z.number().int().positive() }))
      .output(deleteResultWithTarget.nullable())
      .handler(async ({ input, context }) => {
        const authz = await requirePlansAuthz(context, "records", "write");
        const result = await createCalendarRepository(context.db).deleteEvent(
          authz.activeOrganizationId,
          input.id,
        );
        if (!result) return null;
        await writeAuditLog({
          db: context.db,
          organizationId: authz.activeOrganizationId,
          actorUserId: authz.user.id,
          eventType: "RECORD_DELETED",
          targetType: "calendar_event",
          targetId: String(result.id),
          correlationId: context.correlationId,
          metadata: { resource: "records", action: "write" },
        });
        return { id: result.id, targetId: String(result.id) };
      }),
  },
};
