import { createWorkoutHistoryRepository, type ExerciseRef } from "@openvalens/plans";
import { z } from "zod";
import { permissionedProcedure, raiseApiError, validateInput } from "../index";

const exerciseRef = z.union([
  z.object({ exerciseId: z.number().int().positive() }).strict(),
  z.object({ name: z.string().min(1).max(200) }).strict(),
]);
const validCursor = (cursor: string): boolean => {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return false;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    return (
      typeof item.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
      Number.isFinite(Date.parse(`${item.date}T00:00:00Z`)) &&
      new Date(`${item.date}T00:00:00Z`).toISOString().slice(0, 10) === item.date &&
      typeof item.createdAt === "string" &&
      Number.isFinite(Date.parse(item.createdAt)) &&
      Number.isSafeInteger(item.id) &&
      (item.id as number) > 0
    );
  } catch {
    return false;
  }
};
const lastInput = z.strictObject({
  exerciseIds: z.array(z.number().int().positive()).max(100),
  names: z.array(z.string().min(1).max(200)).max(100).optional(),
  onOrBeforeDate: z.string().date().optional(),
  excludeWorkoutId: z.number().int().positive().optional(),
});
export const workoutHistoryInputSchema = z.strictObject({
  exercise: exerciseRef,
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().max(1000).refine(validCursor, "Invalid history cursor").optional(),
});

export const workoutHistoryRouter = {
  lastPerformance: permissionedProcedure({ resource: "workout", action: "read" })
    .use(validateInput(lastInput))
    .input(lastInput)
    .handler(async ({ context, input }) => {
      const userId = context.authz.user?.id;
      if (!userId) throw raiseApiError("UNAUTHENTICATED", "Authentication required.");
      return createWorkoutHistoryRepository(context.db).lastPerformance(
        context.authz.activeOrganizationId,
        userId,
        input,
      );
    }),
  exerciseHistory: permissionedProcedure({ resource: "workout", action: "read" })
    .use(validateInput(workoutHistoryInputSchema))
    .input(workoutHistoryInputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.authz.user?.id;
      if (!userId) throw raiseApiError("UNAUTHENTICATED", "Authentication required.");
      return createWorkoutHistoryRepository(context.db).exerciseHistory(
        context.authz.activeOrganizationId,
        userId,
        input as { exercise: ExerciseRef; limit?: number; cursor?: string },
      );
    }),
};
