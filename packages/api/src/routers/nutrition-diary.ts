import {
  createNutritionDiary,
  FoodSourceUnavailableError,
  NutritionError,
  type DiaryEntry as DomainEntry,
  type DiaryFoodRef,
  type FoodChoice as DomainFoodChoice,
  type NutritionScope,
} from "@openvalens/nutrition";
import { z } from "zod";

import type { Context } from "../context";

import {
  copyDayInput,
  copyDayOutput,
  createFoodInput,
  diaryDay,
  diaryFoods,
  entryChangeInput,
  entryOutcome,
  foodChoice,
  getDayInput,
  logEntryInput,
  logEntryOutput,
  setDayStatusInput,
  setDayStatusOutput,
  setFavoriteInput,
  updateEntryInput,
  type DiaryEntry,
  type EntryOutcome,
  type FoodChoice,
  type FoodRef,
} from "../contracts/nutrition-diary";
import {
  permissionedProcedure,
  raiseApiError,
  tenantScopedProcedure,
  validateInput,
} from "../index";

/**
 * Meal diary procedures (Issue #77), mounted as `appRouter.nutritionDiary`.
 * Kept separate from catalog search (#69) so later nutrition issues extend
 * their own routers. Every call is scoped to the session's active
 * organization AND the signed-in member: a diary is private to its member,
 * so other members of the same workspace never see it. Writes are audited
 * with ids only; no food names or values are logged.
 */

type AuthzContext = { authz: { activeOrganizationId: string; user: { id: string } } };

function scopeOf(context: AuthzContext): NutritionScope {
  return { organizationId: context.authz.activeOrganizationId, userId: context.authz.user.id };
}

/** Maps typed domain failures onto the stable envelope; messages carry no values. */
export async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof NutritionError) {
      if (error.code === "NOT_FOUND") throw raiseApiError("NOT_FOUND", error.message);
      throw raiseApiError("INVALID_INPUT", error.message, { reason: error.code });
    }
    if (error instanceof FoodSourceUnavailableError)
      throw raiseApiError("SOURCE_UNAVAILABLE", "Food source is unavailable. Try again later.", {
        retryAfterSeconds: error.retryAfterSeconds,
      });
    throw error;
  }
}

/** Diary service for this request; live lookups use the server-bound provider (#69). */
function diaryFor(context: Pick<Context, "db" | "foodLookup">) {
  return createNutritionDiary(context.db, { liveLookup: context.foodLookup ?? null });
}

export function toWireEntry(entry: DomainEntry): DiaryEntry {
  return {
    id: entry.id,
    localDate: entry.localDate,
    timeZone: entry.timeZone,
    slot: entry.slot,
    amount: entry.amount,
    unit: entry.unit,
    method: entry.method,
    clientMutationId: entry.clientMutationId,
    revision: entry.revision,
    deleted: entry.deletedAt !== null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    food: {
      snapshotId: entry.food.snapshotId,
      source: entry.food.source,
      sourceQualifiedId: entry.food.sourceQualifiedId,
      sourceVersion: entry.food.sourceVersion,
      attribution: entry.food.attribution,
      name: entry.food.name,
      brand: entry.food.brand,
      basis: entry.food.basis,
      nutrientsPerBasis: entry.food.nutrientsPerBasis,
    },
    nutrients: entry.nutrients,
  };
}

function toWireFood(food: DomainFoodChoice): FoodChoice {
  return { ...food, lastLoggedAt: food.lastLoggedAt?.toISOString() ?? null };
}

export function toDomainFood(food: FoodRef): DiaryFoodRef {
  if (food.kind !== "manual") return food;
  return { kind: "external", snapshot: { source: "manual", ...food.food } };
}

function toWireOutcome(
  result:
    | { outcome: "applied" | "replayed"; entry: DomainEntry }
    | { outcome: "conflict"; server: DomainEntry },
): EntryOutcome {
  if (result.outcome === "conflict")
    return {
      outcome: "conflict",
      server: toWireEntry(result.server),
      targetId: String(result.server.id),
    };
  return {
    outcome: result.outcome,
    entry: toWireEntry(result.entry),
    targetId: String(result.entry.id),
  };
}

const write = (
  targetType: string,
  auditAction: "RECORD_CREATED" | "RECORD_UPDATED" | "RECORD_DELETED",
) => tenantScopedProcedure({ resource: "records", action: "write", auditAction, targetType });
const read = () => permissionedProcedure({ resource: "records", action: "read" });

export const nutritionDiaryRouter = {
  /** One local day: active entries, per-entry nutrients and the explicit marker. */
  getDay: read()
    .use(validateInput(getDayInput))
    .input(getDayInput)
    .output(diaryDay)
    .handler(({ input, context }) =>
      run(async () => {
        const day = await diaryFor(context).getDay(scopeOf(context), input.localDate);
        return {
          localDate: day.localDate,
          status: day.status,
          completedAt: day.completedAt?.toISOString() ?? null,
          entries: day.entries.map(toWireEntry),
        };
      }),
    ),

  /** Recents, favourites and custom foods for quick logging (and offline search on mobile). */
  listFoods: read()
    .input(z.object({}).optional())
    .output(diaryFoods)
    .handler(({ context }) =>
      run(async () => {
        const foods = await diaryFor(context).listFoods(scopeOf(context));
        return {
          recents: foods.recents.map(toWireFood),
          favorites: foods.favorites.map(toWireFood),
          customFoods: foods.customFoods.map(toWireFood),
        };
      }),
    ),

  /** Logs one food; a replayed `clientMutationId` returns the original entry (`created: false`). */
  logEntry: write("nutrition_meal_entry", "RECORD_CREATED")
    .use(validateInput(logEntryInput))
    .input(logEntryInput)
    .output(logEntryOutput)
    .handler(({ input, context }) =>
      run(async () => {
        const result = await diaryFor(context).logEntry(scopeOf(context), {
          ...input,
          food: toDomainFood(input.food),
        });
        return {
          entry: toWireEntry(result.entry),
          created: result.created,
          targetId: String(result.entry.id),
        };
      }),
    ),

  /** Edits amount/unit/slot; returns `conflict` instead of overwriting a newer revision. */
  updateEntry: write("nutrition_meal_entry", "RECORD_UPDATED")
    .use(validateInput(updateEntryInput))
    .input(updateEntryInput)
    .output(entryOutcome)
    .handler(({ input, context }) =>
      run(async () => toWireOutcome(await diaryFor(context).updateEntry(scopeOf(context), input))),
    ),

  /** Soft delete (undo with `restoreEntry`). */
  deleteEntry: write("nutrition_meal_entry", "RECORD_DELETED")
    .use(validateInput(entryChangeInput))
    .input(entryChangeInput)
    .output(entryOutcome)
    .handler(({ input, context }) =>
      run(async () => toWireOutcome(await diaryFor(context).deleteEntry(scopeOf(context), input))),
    ),

  restoreEntry: write("nutrition_meal_entry", "RECORD_UPDATED")
    .use(validateInput(entryChangeInput))
    .input(entryChangeInput)
    .output(entryOutcome)
    .handler(({ input, context }) =>
      run(async () => toWireOutcome(await diaryFor(context).restoreEntry(scopeOf(context), input))),
    ),

  /** Sets or clears the explicit "day complete" marker (never implied by entries). */
  setDayStatus: write("nutrition_diary_day", "RECORD_UPDATED")
    .use(validateInput(setDayStatusInput))
    .input(setDayStatusInput)
    .output(setDayStatusOutput)
    .handler(({ input, context }) =>
      run(async () => {
        const day = await diaryFor(context).setDayStatus(scopeOf(context), input);
        return {
          localDate: day.localDate,
          status: day.status,
          completedAt: day.completedAt?.toISOString() ?? null,
          targetId: day.localDate,
        };
      }),
    ),

  /** Copies confirmed entries from one day into the same slots on another. */
  copyDay: write("nutrition_meal_entry", "RECORD_CREATED")
    .use(validateInput(copyDayInput))
    .input(copyDayInput)
    .output(copyDayOutput)
    .handler(({ input, context }) =>
      run(async () => {
        const result = await diaryFor(context).copyDay(scopeOf(context), input);
        return {
          entries: result.entries.map(toWireEntry),
          created: result.created,
          targetId: input.toDate,
        };
      }),
    ),

  setFavorite: write("nutrition_favorite_food", "RECORD_UPDATED")
    .use(validateInput(setFavoriteInput))
    .input(setFavoriteInput)
    .output(z.object({ snapshotId: z.number(), favorite: z.boolean(), targetId: z.string() }))
    .handler(({ input, context }) =>
      run(async () => {
        await diaryFor(context).setFavorite(scopeOf(context), input);
        return { ...input, targetId: String(input.snapshotId) };
      }),
    ),

  /** Saves a reusable private food; editing/archiving belongs to #81. */
  createFood: write("nutrition_food", "RECORD_CREATED")
    .use(validateInput(createFoodInput))
    .input(createFoodInput)
    .output(foodChoice.extend({ targetId: z.string() }))
    .handler(({ input, context }) =>
      run(async () => {
        const food = await diaryFor(context).createCustomFood(scopeOf(context), input);
        return {
          ref: { kind: "custom" as const, foodId: food.id },
          source: "custom" as const,
          sourceQualifiedId: `custom:${food.id}`,
          attribution: null,
          name: food.name,
          brand: food.brand,
          basis: {
            nutrientBasisAmount: food.nutrientBasisAmount,
            nutrientBasisUnit: food.nutrientBasisUnit,
            servingSizeAmount: food.servingSizeAmount,
            servingSizeUnit: food.servingSizeUnit,
            servingLabel: food.servingLabel,
          },
          nutrientsPerBasis: {
            energyKcal: food.energyKcal,
            energyKj: food.energyKj,
            proteinG: food.proteinG,
            carbohydrateG: food.carbohydrateG,
            fatG: food.fatG,
            saturatedFatG: food.saturatedFatG,
            fiberG: food.fiberG,
            totalSugarsG: food.totalSugarsG,
            addedSugarsG: food.addedSugarsG,
            freeSugarsG: food.freeSugarsG,
            sodiumMg: food.sodiumMg,
            saltG: food.saltG,
          },
          lastLoggedAt: null,
          targetId: String(food.id),
        };
      }),
    ),
};
