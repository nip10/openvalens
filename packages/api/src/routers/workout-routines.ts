import { writeAuditLog } from "@openvalens/audit-security";
import { AuthzHttpError, requirePermission } from "@openvalens/auth/authz/guard";
import {
  createWorkoutRoutinesRepository,
  RoutineConflictError,
  RoutineExerciseNotFoundError,
  RoutineNotFoundError,
  type Routine,
} from "@openvalens/plans";
import { z } from "zod";
import { permissionedProcedure, protectedProcedure, raiseApiError, validateInput } from "../index";

const progression = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("double"), incrementKg: z.number().finite().min(0).max(100) }),
  z.object({
    kind: z.literal("linear"),
    incrementKg: z.number().finite().min(0).max(100),
    deloadPercent: z.number().finite().min(0).max(100),
    failureThreshold: z.number().int().min(1).max(20),
  }),
]);
const routineExercise = z
  .strictObject({
    key: z.string().uuid(),
    exerciseId: z.number().int().positive().nullable(),
    name: z.string().trim().min(1).max(200),
    targetSets: z.number().int().min(1).max(20),
    repsMin: z.number().int().min(1).max(1000),
    repsMax: z.number().int().min(1).max(1000),
    targetWeightKg: z.number().finite().min(0).max(1000).nullable(),
    restSeconds: z.number().int().min(0).max(3600),
    progression,
  })
  .refine((item) => item.repsMax >= item.repsMin, { message: "repsMax must be >= repsMin" });
const meta = { clientMutationId: z.string().uuid(), expectedScope: z.string().min(1).max(512) };
const routineSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).nullable().optional(),
  exercises: z
    .array(routineExercise)
    .max(24)
    .refine(
      (items) => new Set(items.map((item) => item.key)).size === items.length,
      "Exercise keys must be unique",
    ),
});
const mutationResult = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
});
const shape: z.ZodType<Routine> = z.object({
  id: z.number(),
  version: z.number(),
  name: z.string(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  exercises: z.array(routineExercise),
});
const idInput = z.strictObject({ id: z.number().int().positive() });
const performanceSet = z.object({
  reps: z.number().int().nullable(),
  weightKg: z.number().nullable(),
  rpe: z.number().nullable(),
  sortOrder: z.number().int(),
});
const previousPerformance = z
  .object({
    key: z.string().uuid(),
    performance: z
      .object({
        workoutId: z.number().int(),
        date: z.string(),
        exercises: z.array(z.object({ id: z.number().int(), sets: z.array(performanceSet) })),
      })
      .nullable(),
  })
  .array();
const suggestion = z.object({
  weightKg: z.number().finite().nullable(),
  reps: z.number().int(),
  reason: z.string(),
  incrementKg: z.number().finite().optional(),
  failures: z.number().int().optional(),
  deloadPercent: z.number().finite().optional(),
});
const writeError = (error: unknown): never => {
  if (error instanceof RoutineConflictError)
    throw raiseApiError("CONFLICT", "Routine changed or mutation receipt conflicts.");
  if (error instanceof RoutineNotFoundError) throw raiseApiError("NOT_FOUND", "Routine not found.");
  if (error instanceof RoutineExerciseNotFoundError)
    throw raiseApiError("NOT_FOUND", "One or more catalog exercises are unavailable.");
  throw error;
};
async function auth(context: any, action: "read" | "write") {
  try {
    return await requirePermission(context.honoContext as never, { resource: "workout", action });
  } catch (error) {
    if (error instanceof AuthzHttpError) throw raiseApiError(error.code, error.message);
    throw raiseApiError("INTERNAL", "Authorization failed.");
  }
}

export const workoutRoutinesRouter = {
  listRoutines: permissionedProcedure({ resource: "workout", action: "read" })
    .input(z.object({}).strict().optional())
    .output(z.array(shape))
    .handler(({ context }) =>
      createWorkoutRoutinesRepository(context.db).listRoutines(
        context.authz.activeOrganizationId,
        context.authz.user.id,
      ),
    ),
  getRoutine: permissionedProcedure({ resource: "workout", action: "read" })
    .use(validateInput(idInput))
    .input(idInput)
    .output(shape.nullable())
    .handler(({ input, context }) =>
      createWorkoutRoutinesRepository(context.db).getRoutine(
        context.authz.activeOrganizationId,
        context.authz.user.id,
        input.id,
      ),
    ),
  createRoutine: protectedProcedure
    .use(validateInput(z.strictObject({ ...meta, ...routineSchema.shape })))
    .input(z.strictObject({ ...meta, ...routineSchema.shape }))
    .output(mutationResult)
    .handler(async ({ input, context }) => {
      const az = await auth(context, "write");
      const repo = createWorkoutRoutinesRepository(context.db);
      try {
        return await repo.createRoutine(
          az.activeOrganizationId,
          az.user.id,
          input,
          input,
          async (tx, result) => {
            await writeAuditLog({
              db: tx,
              organizationId: az.activeOrganizationId,
              actorUserId: az.user.id,
              eventType: "RECORD_CREATED",
              targetType: "workout_routine",
              targetId: String(result.id),
              correlationId: context.correlationId,
              metadata: { resource: "workout", action: "write" },
            });
          },
        );
      } catch (error) {
        return writeError(error);
      }
    }),
  updateRoutine: protectedProcedure
    .use(
      validateInput(
        z.strictObject({
          ...meta,
          id: z.number().int().positive(),
          expectedVersion: z.number().int().positive(),
          ...routineSchema.shape,
        }),
      ),
    )
    .input(
      z.strictObject({
        ...meta,
        id: z.number().int().positive(),
        expectedVersion: z.number().int().positive(),
        ...routineSchema.shape,
      }),
    )
    .output(mutationResult)
    .handler(async ({ input, context }) => {
      const az = await auth(context, "write");
      try {
        return await createWorkoutRoutinesRepository(context.db).updateRoutine(
          az.activeOrganizationId,
          az.user.id,
          input,
          input.id,
          input.expectedVersion,
          input,
          async (tx, result) => {
            await writeAuditLog({
              db: tx,
              organizationId: az.activeOrganizationId,
              actorUserId: az.user.id,
              eventType: "RECORD_UPDATED",
              targetType: "workout_routine",
              targetId: String(result.id),
              correlationId: context.correlationId,
              metadata: { resource: "workout", action: "write" },
            });
          },
        );
      } catch (error) {
        return writeError(error);
      }
    }),
  deleteRoutine: protectedProcedure
    .use(
      validateInput(
        z.strictObject({
          ...meta,
          id: z.number().int().positive(),
          expectedVersion: z.number().int().positive(),
        }),
      ),
    )
    .input(
      z.strictObject({
        ...meta,
        id: z.number().int().positive(),
        expectedVersion: z.number().int().positive(),
      }),
    )
    .output(mutationResult.extend({ deleted: z.literal(true) }))
    .handler(async ({ input, context }) => {
      const az = await auth(context, "write");
      try {
        const result = await createWorkoutRoutinesRepository(context.db).deleteRoutine(
          az.activeOrganizationId,
          az.user.id,
          input,
          input.id,
          input.expectedVersion,
          async (tx, applied) => {
            await writeAuditLog({
              db: tx,
              organizationId: az.activeOrganizationId,
              actorUserId: az.user.id,
              eventType: "RECORD_DELETED",
              targetType: "workout_routine",
              targetId: String(applied.id),
              correlationId: context.correlationId,
              metadata: { resource: "workout", action: "write" },
            });
          },
        );
        return result as { id: number; version: number; deleted: true };
      } catch (error) {
        return writeError(error);
      }
    }),
  startPreview: permissionedProcedure({ resource: "workout", action: "read" })
    .use(validateInput(idInput))
    .input(idInput)
    .output(
      z
        .object({
          routine: shape,
          suggestions: z.array(z.object({ key: z.string().uuid(), suggestion })),
          previousPerformance,
        })
        .nullable(),
    )
    .handler(async ({ input, context }) =>
      createWorkoutRoutinesRepository(context.db).startPreview(
        context.authz.activeOrganizationId,
        context.authz.user.id,
        input.id,
      ),
    ),
};
