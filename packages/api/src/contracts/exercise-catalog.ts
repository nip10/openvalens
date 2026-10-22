import { z } from "zod";

export const exerciseCatalogSearchInput = z.strictObject({
  query: z.string().trim().min(1).max(100).optional(),
  language: z.string().trim().min(2).max(16).optional(),
  muscleExternalId: z.string().trim().min(1).max(80).optional(),
  equipmentExternalId: z.string().trim().min(1).max(80).optional(),
  afterId: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const exerciseCatalogGetInput = z.strictObject({
  id: z.number().int().positive(),
  language: z.string().trim().min(2).max(16).optional(),
});

export const exerciseCatalogFiltersInput = z.strictObject({});

export const createCustomExerciseInput = z.strictObject({
  clientMutationId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  language: z.string().trim().min(2).max(16),
  instructions: z.string().trim().max(5000).optional(),
});

export const addFromLibraryInput = z.strictObject({
  clientMutationId: z.string().uuid().optional(),
  workoutId: z.number().int().positive(),
  exerciseId: z.number().int().positive(),
  language: z.string().trim().min(2).max(16).optional(),
});

export type ExerciseCatalogSearchInput = z.infer<typeof exerciseCatalogSearchInput>;
