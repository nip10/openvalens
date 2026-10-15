import {
  createCustomFoods,
  nutrientsOf,
  type CustomFood as DomainFood,
  type CustomFoodOutcome as DomainOutcome,
  type NutritionScope,
} from "@openvalens/nutrition";

import type { Context } from "../context";

import {
  createCustomFoodInput,
  createCustomFoodOutput,
  customFood,
  customFoodChangeOutput,
  customFoodIdInput,
  customFoodList,
  customFoodOutcome,
  listCustomFoodsInput,
  updateCustomFoodInput,
  type CustomFood,
  type CustomFoodOutcome,
} from "../contracts/nutrition-custom-foods";
import {
  permissionedProcedure,
  raiseApiError,
  tenantScopedProcedure,
  validateInput,
} from "../index";
import { run } from "./nutrition-diary";

/**
 * Private custom food management (Issue #81), mounted as
 * `appRouter.nutritionCustomFoods`. A custom food belongs to the signed-in
 * member in the session's active organization: other members of the same
 * workspace and other workspaces never see or change it, and no input field
 * can name another owner. Foods are never published to the shared catalogs.
 * Archive replaces delete, so logged meals keep their snapshots. Writes are
 * audited with ids only; names and values are never logged.
 */

type AuthzContext = { authz: { activeOrganizationId: string; user: { id: string } } };

function scopeOf(context: AuthzContext): NutritionScope {
  return { organizationId: context.authz.activeOrganizationId, userId: context.authz.user.id };
}

function foodsFor(context: Pick<Context, "db">) {
  return createCustomFoods(context.db);
}

export function toWireCustomFood(food: DomainFood): CustomFood {
  return {
    id: food.id,
    sourceQualifiedId: `custom:${food.id}`,
    provenance: "user_entered",
    name: food.name,
    brand: food.brand,
    barcode: food.barcode,
    basis: {
      nutrientBasisAmount: food.nutrientBasisAmount,
      nutrientBasisUnit: food.nutrientBasisUnit,
      servingSizeAmount: food.servingSizeAmount,
      servingSizeUnit: food.servingSizeUnit,
      servingLabel: food.servingLabel,
    },
    nutrientsPerBasis: nutrientsOf(food),
    revision: food.revision,
    archived: food.archivedAt !== null,
    archivedAt: food.archivedAt?.toISOString() ?? null,
    createdAt: food.createdAt.toISOString(),
    updatedAt: food.updatedAt.toISOString(),
  };
}

function toWireOutcome(result: DomainOutcome): CustomFoodOutcome {
  if (result.outcome === "conflict")
    return {
      outcome: "conflict",
      server: toWireCustomFood(result.server),
      targetId: String(result.server.id),
    };
  return {
    outcome: result.outcome,
    food: toWireCustomFood(result.food),
    targetId: String(result.food.id),
  };
}

const write = (auditAction: "RECORD_CREATED" | "RECORD_UPDATED" | "RECORD_DELETED") =>
  tenantScopedProcedure({
    resource: "records",
    action: "write",
    auditAction,
    targetType: "nutrition_food",
  });
const read = () => permissionedProcedure({ resource: "records", action: "read" });

export const nutritionCustomFoodsRouter = {
  /** The member's custom foods by name; archived ones only with `includeArchived`. */
  list: read()
    .use(validateInput(listCustomFoodsInput))
    .input(listCustomFoodsInput)
    .output(customFoodList)
    .handler(({ input, context }) =>
      run(async () => {
        const foods = await foodsFor(context).list(scopeOf(context), {
          includeArchived: input?.includeArchived ?? false,
        });
        return { foods: foods.map(toWireCustomFood) };
      }),
    ),

  /** One food, archived or not; another member's food is `NOT_FOUND`. */
  get: read()
    .use(validateInput(customFoodIdInput))
    .input(customFoodIdInput)
    .output(customFood)
    .handler(({ input, context }) =>
      run(async () => {
        const food = await foodsFor(context).get(scopeOf(context), input.foodId);
        if (!food) throw raiseApiError("NOT_FOUND", "Custom food not found");
        return toWireCustomFood(food);
      }),
    ),

  /** Saves a private food; a retried `clientMutationId` returns it with `created: false`. */
  create: write("RECORD_CREATED")
    .use(validateInput(createCustomFoodInput))
    .input(createCustomFoodInput)
    .output(createCustomFoodOutput)
    .handler(({ input, context }) =>
      run(async () => {
        const result = await foodsFor(context).create(scopeOf(context), {
          ...input.food,
          clientMutationId: input.clientMutationId,
        });
        return {
          food: toWireCustomFood(result.food),
          created: result.created,
          targetId: String(result.food.id),
        };
      }),
    ),

  /** Edits a food (new revision); logged entries keep the values they were logged with. */
  update: write("RECORD_UPDATED")
    .use(validateInput(updateCustomFoodInput))
    .input(updateCustomFoodInput)
    .output(customFoodOutcome)
    .handler(({ input, context }) =>
      run(async () => toWireOutcome(await foodsFor(context).update(scopeOf(context), input))),
    ),

  /** Removes a food from search and logging; idempotent, undo with `restore`. */
  archive: write("RECORD_DELETED")
    .use(validateInput(customFoodIdInput))
    .input(customFoodIdInput)
    .output(customFoodChangeOutput)
    .handler(({ input, context }) =>
      run(async () => {
        const food = await foodsFor(context).archive(scopeOf(context), input.foodId);
        return { food: toWireCustomFood(food), targetId: String(food.id) };
      }),
    ),

  restore: write("RECORD_UPDATED")
    .use(validateInput(customFoodIdInput))
    .input(customFoodIdInput)
    .output(customFoodChangeOutput)
    .handler(({ input, context }) =>
      run(async () => {
        const food = await foodsFor(context).restore(scopeOf(context), input.foodId);
        return { food: toWireCustomFood(food), targetId: String(food.id) };
      }),
    ),
};
