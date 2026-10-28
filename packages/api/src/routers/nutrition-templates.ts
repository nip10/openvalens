import {
  createNutritionTemplates,
  type NutritionScope,
  type NutritionTemplateDomain as DomainTemplate,
  type NutritionTemplateContentDomain as DomainContent,
} from "@openvalens/nutrition";
import { z } from "zod";
import type { Context } from "../context";
import {
  archiveNutritionTemplateInput,
  createNutritionTemplateInput,
  listNutritionTemplatesOutput,
  nutritionTemplateOutcome,
  updateNutritionTemplateInput,
  type NutritionTemplate as WireTemplate,
  type NutritionTemplateContent,
} from "../contracts/nutrition-templates";
import { permissionedProcedure, tenantScopedProcedure, validateInput } from "../index";
import { run, toDomainFood } from "./nutrition-diary";

type AuthContext = { authz: { activeOrganizationId: string; user: { id: string } } };
const scopeOf = (context: AuthContext): NutritionScope => ({
  organizationId: context.authz.activeOrganizationId,
  userId: context.authz.user.id,
});
const templatesFor = (context: Pick<Context, "db" | "foodLookup">) =>
  createNutritionTemplates(context.db, { liveLookup: context.foodLookup ?? null });
const read = () => permissionedProcedure({ resource: "records", action: "read" });
const write = (auditAction: "RECORD_CREATED" | "RECORD_UPDATED" | "RECORD_DELETED") =>
  tenantScopedProcedure({
    resource: "records",
    action: "write",
    auditAction,
    targetType: "nutrition_template",
  });
const zeroInput = z.strictObject({}).optional();

function toDomainContent(content: NutritionTemplateContent): DomainContent {
  const ingredients = content.ingredients.map((ingredient) => ({
    ...ingredient,
    food: toDomainFood(ingredient.food),
  }));
  return content.kind === "meal"
    ? { kind: "meal", name: content.name, ingredients }
    : { kind: "recipe", name: content.name, yieldServings: content.yieldServings, ingredients };
}

function toWireTemplate(template: DomainTemplate): WireTemplate {
  const common = {
    id: template.id,
    revision: template.revision,
    name: template.name,
    ingredients: template.ingredients,
    summary: template.summary,
    archived: template.archived,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
  return template.kind === "meal"
    ? { ...common, kind: "meal", yieldServings: null }
    : { ...common, kind: "recipe", yieldServings: template.yieldServings ?? 1 };
}

function toWireOutcome(
  result: Awaited<ReturnType<ReturnType<typeof createNutritionTemplates>["create"]>>,
) {
  return result.outcome === "conflict"
    ? {
        outcome: "conflict" as const,
        server: toWireTemplate(result.server),
        targetId: result.targetId,
      }
    : {
        outcome: result.outcome,
        template: toWireTemplate(result.template),
        targetId: result.targetId,
      };
}

export const nutritionTemplatesRouter = {
  list: read()
    .input(zeroInput)
    .output(listNutritionTemplatesOutput)
    .handler(({ context }) =>
      run(async () => {
        const result = await templatesFor(context).list(scopeOf(context));
        return { templates: result.templates.map(toWireTemplate) };
      }),
    ),

  create: write("RECORD_CREATED")
    .use(validateInput(createNutritionTemplateInput))
    .input(createNutritionTemplateInput)
    .output(nutritionTemplateOutcome)
    .handler(({ input, context }) =>
      run(async () =>
        toWireOutcome(
          await templatesFor(context).create(scopeOf(context), {
            clientMutationId: input.clientMutationId,
            content: toDomainContent(input.content),
          }),
        ),
      ),
    ),

  update: write("RECORD_UPDATED")
    .use(validateInput(updateNutritionTemplateInput))
    .input(updateNutritionTemplateInput)
    .output(nutritionTemplateOutcome)
    .handler(({ input, context }) =>
      run(async () =>
        toWireOutcome(
          await templatesFor(context).update(scopeOf(context), {
            clientMutationId: input.clientMutationId,
            templateId: input.templateId,
            expectedRevision: input.expectedRevision,
            content: toDomainContent(input.content),
          }),
        ),
      ),
    ),

  archive: write("RECORD_DELETED")
    .use(validateInput(archiveNutritionTemplateInput))
    .input(archiveNutritionTemplateInput)
    .output(nutritionTemplateOutcome)
    .handler(({ input, context }) =>
      run(async () => toWireOutcome(await templatesFor(context).archive(scopeOf(context), input))),
    ),
};
