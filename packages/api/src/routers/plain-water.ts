import {
  createPlainWaterDiary,
  NutritionError,
  type NutritionScope,
  type WaterEntry,
} from "@openvalens/nutrition";
import { z } from "zod";

import type { Context } from "../context";
import {
  permissionedProcedure,
  raiseApiError,
  tenantScopedProcedure,
  validateInput,
} from "../index";
import { requireProfileOwner } from "../wellness-profile";
import {
  plainWaterAddInput,
  plainWaterChangeInput,
  plainWaterDeleteInput,
  plainWaterDay,
  plainWaterDayInput,
  plainWaterMutationOutput,
  plainWaterPreferenceInput,
} from "../contracts/plain-water";

type AuthContext = {
  authz: { activeOrganizationId: string; user: { id: string } };
  session: Context["session"];
};
const scopeOf = (context: AuthContext): NutritionScope => {
  const trustedUserId = requireProfileOwner(context.session);
  if (trustedUserId !== context.authz.user.id)
    throw raiseApiError("PERMISSION_DENIED", "You do not have permission to perform this action.");
  return { organizationId: context.authz.activeOrganizationId, userId: trustedUserId };
};
const run = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof NutritionError) {
      if (error.code === "NOT_FOUND") throw raiseApiError("NOT_FOUND", error.message);
      throw raiseApiError("INVALID_INPUT", error.message, { reason: error.code });
    }
    throw error;
  }
};
const diary = (context: Pick<Context, "db">) => createPlainWaterDiary(context.db);
// #80 has not landed. Until the member preference is wired, all display paths
// fail closed; data-rights export remains a separate explicit user intent.
const visibleQuantity = (_unknownPreference: unknown, _value: number | null): number | null => null;
const wireEntry = (entry: WaterEntry) => ({
  id: entry.id,
  observedAt: entry.observedAt.toISOString(),
  timeZone: entry.timeZone,
  quantityMl: visibleQuantity(undefined, entry.quantityMl),
  revision: entry.revision,
  deleted: entry.deletedAt !== null,
  createdAt: entry.createdAt.toISOString(),
  updatedAt: entry.updatedAt.toISOString(),
});
const read = permissionedProcedure({ resource: "records", action: "read" });
const write = (action: "RECORD_CREATED" | "RECORD_UPDATED" | "RECORD_DELETED") =>
  tenantScopedProcedure({
    resource: "records",
    action: "write",
    auditAction: action,
    targetType: "plain_water_entry",
  });

export const plainWaterRouter = {
  getPreferences: read
    .input(z.object({}).strict().optional())
    .output(z.object({ enabled: z.boolean(), personalGoalMl: z.number().nullable() }))
    .handler(({ context }) =>
      run(async () => {
        const scope = scopeOf(context);
        const prefs = await diary(context).getPreference(scope);
        return {
          enabled: prefs.enabled,
          personalGoalMl: visibleQuantity(undefined, prefs.personalGoalMl),
        };
      }),
    ),
  updatePreferences: write("RECORD_UPDATED")
    .use(validateInput(plainWaterPreferenceInput))
    .input(plainWaterPreferenceInput)
    .output(
      z.object({
        enabled: z.boolean(),
        personalGoalMl: z.number().nullable(),
        targetId: z.string(),
      }),
    )
    .handler(({ input, context }) =>
      run(async () => {
        const scope = scopeOf(context);
        const ml =
          input.personalGoal === undefined || input.personalGoal === null
            ? input.personalGoal
            : input.personalGoal *
              { ml: 1, l: 1000, fl_oz: 29.5735295625 }[input.personalGoalUnit!];
        const result = await diary(context).setPreference(scope, {
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          ...(input.personalGoal === undefined ? {} : { personalGoalMl: ml }),
        });
        if (!result) throw new Error("Plain-water preference update returned no row");
        return {
          enabled: result.enabled,
          personalGoalMl: visibleQuantity(undefined, result.personalGoalMl),
          targetId: "preferences",
        };
      }),
    ),
  getDay: read
    .use(validateInput(plainWaterDayInput))
    .input(plainWaterDayInput)
    .output(plainWaterDay)
    .handler(({ input, context }) =>
      run(async () => {
        const result = await diary(context).getDay(scopeOf(context), input.date, input.timeZone);
        return {
          date: result.date,
          timeZone: result.timeZone,
          label: "Plain water subtotal" as const,
          enabled: result.enabled,
          quantityMl: visibleQuantity(undefined, result.quantityMl),
          personalGoalMl: visibleQuantity(undefined, result.personalGoalMl),
          entries: result.entries.map(wireEntry),
        };
      }),
    ),
  add: write("RECORD_CREATED")
    .use(validateInput(plainWaterAddInput))
    .input(plainWaterAddInput)
    .output(plainWaterMutationOutput)
    .handler(({ input, context }) =>
      run(async () => {
        const result = await diary(context).add(scopeOf(context), {
          ...input,
          observedAt: new Date(input.observedAt),
        });
        return {
          outcome: result.outcome,
          entry: wireEntry(result.entry),
          targetId: String(result.entry.id),
        };
      }),
    ),
  change: write("RECORD_UPDATED")
    .use(validateInput(plainWaterChangeInput))
    .input(plainWaterChangeInput)
    .output(plainWaterMutationOutput)
    .handler(({ input, context }) =>
      run(async () => {
        const result = await diary(context).change(scopeOf(context), {
          id: input.id,
          clientMutationId: input.clientMutationId,
          expectedRevision: input.expectedRevision,
          ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
          ...(input.unit === undefined ? {} : { unit: input.unit }),
          ...(input.observedAt ? { observedAt: new Date(input.observedAt) } : {}),
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
        });
        return {
          outcome: result.outcome,
          entry: wireEntry(result.entry),
          targetId: String(result.entry.id),
        };
      }),
    ),
  delete: write("RECORD_DELETED")
    .use(validateInput(plainWaterDeleteInput))
    .input(plainWaterDeleteInput)
    .output(plainWaterMutationOutput)
    .handler(({ input, context }) =>
      run(async () => {
        const result = await diary(context).change(scopeOf(context), { ...input, deleted: true });
        return {
          outcome: result.outcome,
          entry: wireEntry(result.entry),
          targetId: String(result.entry.id),
        };
      }),
    ),
};
