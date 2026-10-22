import { writeAuditLog } from "@openvalens/audit-security";
import { AuthzHttpError, requirePermission } from "@openvalens/auth/authz/guard";
import { z } from "zod";

import { addFromLibraryInput, createCustomExerciseInput, exerciseCatalogFiltersInput, exerciseCatalogGetInput, exerciseCatalogSearchInput } from "../contracts/exercise-catalog";
import { raiseApiError, permissionedProcedure, protectedProcedure, validateInput } from "../index";
import { createExerciseCatalogService, ExerciseCatalogMutationConflictError } from "../services/exercise-catalog";

async function requireWorkoutWrite(context: { honoContext: unknown }) {
  try {
    return await requirePermission(context.honoContext as never, { resource: "workout", action: "write" });
  } catch (error) {
    if (error instanceof AuthzHttpError) throw raiseApiError(error.code, error.message);
    throw raiseApiError("INTERNAL", "Authorization failed.");
  }
}

export const exerciseCatalogRouter = {
  search: permissionedProcedure({ resource: "workout", action: "read" })
    .use(validateInput(exerciseCatalogSearchInput))
    .input(exerciseCatalogSearchInput)
    .handler(({ input, context }) => createExerciseCatalogService(context.db, context.exerciseCatalogMediaReader).search({ ...input, organizationId: context.authz.activeOrganizationId })),

  get: permissionedProcedure({ resource: "workout", action: "read" })
    .use(validateInput(exerciseCatalogGetInput))
    .input(exerciseCatalogGetInput)
    .handler(({ input, context }) => createExerciseCatalogService(context.db, context.exerciseCatalogMediaReader).get({ ...input, organizationId: context.authz.activeOrganizationId })),

  filters: permissionedProcedure({ resource: "workout", action: "read" })
    .use(validateInput(exerciseCatalogFiltersInput))
    .input(exerciseCatalogFiltersInput)
    .handler(({ context }) => createExerciseCatalogService(context.db).filters({ organizationId: context.authz.activeOrganizationId })),

  createCustom: protectedProcedure
    .use(validateInput(createCustomExerciseInput))
    .input(createCustomExerciseInput)
    .output(z.object({ id: z.number(), name: z.string() }).nullable())
    .handler(async ({ input, context }) => {
      const authz = await requireWorkoutWrite(context);
      const result = await createExerciseCatalogService(context.db).createCustom({ ...input, organizationId: authz.activeOrganizationId, userId: authz.user.id }).catch((error: unknown) => {
        if (error instanceof ExerciseCatalogMutationConflictError) throw raiseApiError("CONFLICT", "Mutation key was already used for a different request.");
        throw error;
      });
      if (!result) throw raiseApiError("NOT_FOUND", "Exercise not found.");
      // Audit follows the service's committed DB transaction. A process crash
      // between commit and this call can leave a missing audit; this is not an
      // exactly-once audit guarantee. Replays deliberately skip duplicate audits.
      if (result.applied) await writeAuditLog({ db: context.db, organizationId: authz.activeOrganizationId, actorUserId: authz.user.id, eventType: "RECORD_CREATED", targetType: "exercise", targetId: String(result.id), correlationId: context.correlationId, metadata: { resource: "workout", action: "write" } });
      return { id: result.id, name: result.name };
    }),

  addFromLibrary: protectedProcedure
    .use(validateInput(addFromLibraryInput))
    .input(addFromLibraryInput)
    .output(z.object({ id: z.number(), name: z.string(), sortOrder: z.number() }).nullable())
    .handler(async ({ input, context }) => {
      const authz = await requireWorkoutWrite(context);
      const result = await createExerciseCatalogService(context.db, context.exerciseCatalogMediaReader).addFromLibrary({ ...input, organizationId: authz.activeOrganizationId, userId: authz.user.id }).catch((error: unknown) => {
        if (error instanceof ExerciseCatalogMutationConflictError) throw raiseApiError("CONFLICT", "Mutation key was already used for a different request.");
        throw error;
      });
      if (!result) throw raiseApiError("NOT_FOUND", "Workout or exercise not found.");
      // Linking has the same commit-before-audit crash gap; receipt replays do
      // not emit another audit event.
      if (result.applied) await writeAuditLog({ db: context.db, organizationId: authz.activeOrganizationId, actorUserId: authz.user.id, eventType: "RECORD_CREATED", targetType: "workout_exercise", targetId: String(result.id), correlationId: context.correlationId, metadata: { resource: "workout", action: "write" } });
      return { id: result.id, name: result.name, sortOrder: result.sortOrder };
    }),
};
