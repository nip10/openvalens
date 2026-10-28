import type { Database } from "@openvalens/db";
import {
  nutritionFoodSnapshot,
  nutritionTemplate,
  nutritionTemplateRevision,
} from "@openvalens/db/schema/nutrition";
import { and, asc, eq, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";

import { NutritionError } from "./errors";
import type { FoodLookupProvider } from "./food-lookup";
import { createFoodSearch, foodResultToLogFood } from "./food-search";
import { computeNutrientFactor, nutrientsOf, scaleNutrients, type AmountUnit } from "./nutrients";
import {
  lockNutritionSafetyScope,
  resolveSnapshot,
  type DiaryEntry,
  type NutritionScope,
  type Tx,
} from "./repository";
import type { DiaryFoodRef } from "./diary";
import { sourceQualifiedId } from "./snapshot";
import { summarizeEntries, type NutrientSummary } from "./totals";

export type NutritionTemplateContent =
  | {
      kind: "meal";
      name: string;
      ingredients: { food: DiaryFoodRef; amount: number; unit: AmountUnit }[];
    }
  | {
      kind: "recipe";
      name: string;
      yieldServings: number;
      ingredients: { food: DiaryFoodRef; amount: number; unit: AmountUnit }[];
    };

type TemplateFood = DiaryEntry["food"];
export type NutritionTemplateIngredient = {
  food: TemplateFood;
  amount: number;
  unit: AmountUnit;
  nutrients: DiaryEntry["nutrients"];
};
export type NutritionTemplate = {
  id: number;
  revision: number;
  kind: "meal" | "recipe";
  name: string;
  yieldServings: number | null;
  ingredients: NutritionTemplateIngredient[];
  summary: NutrientSummary;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};
type Outcome =
  | { outcome: "applied" | "replayed"; template: NutritionTemplate; targetId: string }
  | { outcome: "conflict"; server: NutritionTemplate; targetId: string };

const positive = (value: number) => Number.isFinite(value) && value > 0;
const validMutationId = (value: string) =>
  typeof value === "string" && value.length > 0 && value.length <= 128;
const validName = (value: string) =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= 200;
const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ownerWhere = (scope: NutritionScope, id: number) =>
  and(
    eq(nutritionTemplate.organizationId, scope.organizationId),
    eq(nutritionTemplate.userId, scope.userId),
    eq(nutritionTemplate.id, id),
  );

export type NutritionTemplatesOptions = { liveLookup?: FoodLookupProvider | null };

/** Private member-owned templates with immutable, snapshot-backed content revisions. */
export function createNutritionTemplates(db: Database, options: NutritionTemplatesOptions = {}) {
  const foodSearch = createFoodSearch(db, { liveLookup: options.liveLookup ?? null });

  async function resolveFood(scope: NutritionScope, food: DiaryFoodRef) {
    if (food.kind !== "catalog") return food;
    const found = await foodSearch.getFood(scope, food.id);
    if (!found) throw new NutritionError("NOT_FOUND", "Food not found");
    return foodResultToLogFood(found);
  }

  async function serialize(
    scope: NutritionScope,
    tx: Tx,
    parent: typeof nutritionTemplate.$inferSelect,
    revision: typeof nutritionTemplateRevision.$inferSelect,
  ): Promise<NutritionTemplate> {
    const ingredients: NutritionTemplateIngredient[] = [];
    for (const ingredient of revision.ingredients) {
      const [snapshot] = await tx
        .select()
        .from(nutritionFoodSnapshot)
        .where(
          and(
            eq(nutritionFoodSnapshot.organizationId, scope.organizationId),
            eq(nutritionFoodSnapshot.id, ingredient.snapshotId),
          ),
        );
      if (!snapshot) throw new NutritionError("NOT_FOUND", "Template food snapshot not found");
      const perBasis = nutrientsOf(snapshot);
      const nutrients = scaleNutrients(
        perBasis,
        computeNutrientFactor(snapshot, ingredient.amount, ingredient.unit),
      );
      ingredients.push({
        food: {
          snapshotId: snapshot.id,
          source: snapshot.source,
          sourceQualifiedId:
            snapshot.sourceFoodId === null
              ? null
              : sourceQualifiedId(snapshot.source, snapshot.sourceFoodId),
          sourceVersion: snapshot.sourceVersion,
          attribution: snapshot.attribution,
          name: snapshot.name,
          brand: snapshot.brand,
          barcode: snapshot.barcode,
          basis: {
            nutrientBasisAmount: snapshot.nutrientBasisAmount,
            nutrientBasisUnit: snapshot.nutrientBasisUnit,
            servingSizeAmount: snapshot.servingSizeAmount,
            servingSizeUnit: snapshot.servingSizeUnit,
            servingLabel: snapshot.servingLabel,
          },
          nutrientsPerBasis: perBasis,
        },
        amount: ingredient.amount,
        unit: ingredient.unit,
        nutrients,
      });
    }
    return {
      id: parent.id,
      revision: revision.revision,
      kind: revision.kind,
      name: revision.name,
      yieldServings: revision.yieldServings,
      ingredients,
      summary: summarizeEntries(
        ingredients.map((item) => ({ nutrients: item.nutrients, source: item.food.source })),
      ),
      archived: parent.archivedAt !== null,
      createdAt: parent.createdAt.toISOString(),
      updatedAt: parent.updatedAt.toISOString(),
    };
  }

  async function current(
    scope: NutritionScope,
    tx: Tx,
    parent: typeof nutritionTemplate.$inferSelect,
  ) {
    const [revision] = await tx
      .select()
      .from(nutritionTemplateRevision)
      .where(
        and(
          eq(nutritionTemplateRevision.organizationId, scope.organizationId),
          eq(nutritionTemplateRevision.templateId, parent.id),
          eq(nutritionTemplateRevision.revision, parent.currentRevision),
        ),
      );
    if (!revision) throw new Error("Nutrition template revision missing");
    return serialize(scope, tx, parent, revision);
  }

  async function prepare(scope: NutritionScope, content: NutritionTemplateContent) {
    if (
      !validName(content.name) ||
      !Array.isArray(content.ingredients) ||
      content.ingredients.length < 1 ||
      content.ingredients.length > 100
    )
      throw new NutritionError("INVALID_INPUT", "Invalid template content");
    if (content.kind === "recipe" ? !positive(content.yieldServings) : "yieldServings" in content)
      throw new NutritionError("INVALID_INPUT", "Invalid template yield");
    const ingredients = [];
    for (const item of content.ingredients) {
      if (!positive(item.amount) || !["g", "ml", "serving"].includes(item.unit))
        throw new NutritionError("INVALID_INPUT", "Invalid ingredient amount");
      const resolved = await resolveFood(scope, item.food);
      ingredients.push({ food: resolved, amount: item.amount, unit: item.unit });
    }
    return { ...content, name: content.name.trim(), ingredients } as NutritionTemplateContent;
  }

  async function addRevision(
    scope: NutritionScope,
    tx: Tx,
    templateId: number,
    revision: number,
    content: NutritionTemplateContent,
    clientMutationId: string,
    hash: string,
  ) {
    const storedIngredients: { snapshotId: number; amount: number; unit: AmountUnit }[] = [];
    for (const ingredient of content.ingredients) {
      const snapshot = await resolveSnapshot(
        tx,
        scope,
        ingredient.food as Parameters<typeof resolveSnapshot>[2],
      );
      storedIngredients.push({
        snapshotId: snapshot.id,
        amount: ingredient.amount,
        unit: ingredient.unit,
      });
    }
    const [row] = await tx
      .insert(nutritionTemplateRevision)
      .values({
        ...scope,
        templateId,
        revision,
        kind: content.kind,
        name: content.name,
        yieldServings: content.kind === "recipe" ? content.yieldServings : null,
        ingredients: storedIngredients,
        clientMutationId,
        fingerprint: hash,
      })
      .returning();
    if (!row) throw new Error("Nutrition template revision insert failed");
    return row;
  }

  async function receipt(
    scope: NutritionScope,
    tx: Tx,
    mutationId: string,
    hash: string,
  ): Promise<Outcome | null> {
    const [row] = await tx
      .select()
      .from(nutritionTemplateRevision)
      .where(
        and(
          eq(nutritionTemplateRevision.organizationId, scope.organizationId),
          eq(nutritionTemplateRevision.userId, scope.userId),
          eq(nutritionTemplateRevision.clientMutationId, mutationId),
        ),
      );
    if (!row) return null;
    if (row.fingerprint !== hash)
      throw new NutritionError("INVALID_INPUT", "Client mutation id was reused");
    const [parent] = await tx
      .select()
      .from(nutritionTemplate)
      .where(ownerWhere(scope, row.templateId));
    if (!parent) throw new Error("Nutrition template receipt has no parent");
    const template = await serialize(scope, tx, parent, row);
    return { outcome: "replayed", template, targetId: String(parent.id) };
  }

  return {
    async list(scope: NutritionScope): Promise<{ templates: NutritionTemplate[] }> {
      return db.transaction(async (tx) => {
        const parents = await tx
          .select()
          .from(nutritionTemplate)
          .where(
            and(
              eq(nutritionTemplate.organizationId, scope.organizationId),
              eq(nutritionTemplate.userId, scope.userId),
              isNull(nutritionTemplate.archivedAt),
            ),
          )
          .orderBy(asc(nutritionTemplate.id));
        const templates: NutritionTemplate[] = [];
        for (const parent of parents) templates.push(await current(scope, tx, parent));
        return { templates };
      });
    },

    async create(
      scope: NutritionScope,
      input: { clientMutationId: string; content: NutritionTemplateContent },
    ): Promise<Outcome> {
      if (!validMutationId(input.clientMutationId))
        throw new NutritionError("INVALID_INPUT", "Invalid client mutation id");
      const content = await prepare(scope, input.content);
      const hash = fingerprint({ operation: "create", content: input.content });
      return db.transaction(async (tx) => {
        await lockNutritionSafetyScope(tx, scope);
        const replay = await receipt(scope, tx, input.clientMutationId, hash);
        if (replay) return replay;
        const [parent] = await tx
          .insert(nutritionTemplate)
          .values({ ...scope, kind: content.kind, currentRevision: 1 })
          .returning();
        if (!parent) throw new Error("Nutrition template insert failed");
        const revision = await addRevision(
          scope,
          tx,
          parent.id,
          1,
          content,
          input.clientMutationId,
          hash,
        );
        return {
          outcome: "applied",
          template: await serialize(scope, tx, parent, revision),
          targetId: String(parent.id),
        };
      });
    },

    async update(
      scope: NutritionScope,
      input: {
        clientMutationId: string;
        templateId: number;
        expectedRevision: number;
        content: NutritionTemplateContent;
      },
    ): Promise<Outcome> {
      if (
        !validMutationId(input.clientMutationId) ||
        !positive(input.templateId) ||
        !Number.isInteger(input.expectedRevision) ||
        input.expectedRevision < 1
      )
        throw new NutritionError("INVALID_INPUT", "Invalid template mutation");
      const content = await prepare(scope, input.content);
      const hash = fingerprint({
        operation: "update",
        templateId: input.templateId,
        expectedRevision: input.expectedRevision,
        content: input.content,
      });
      return db.transaction(async (tx) => {
        await lockNutritionSafetyScope(tx, scope);
        const replay = await receipt(scope, tx, input.clientMutationId, hash);
        if (replay) return replay;
        const [parent] = await tx
          .select()
          .from(nutritionTemplate)
          .where(ownerWhere(scope, input.templateId))
          .for("update");
        if (!parent) throw new NutritionError("NOT_FOUND", "Nutrition template not found");
        const server = await current(scope, tx, parent);
        if (parent.archivedAt)
          throw new NutritionError("NOT_FOUND", "Nutrition template not found");
        if (parent.kind !== content.kind)
          throw new NutritionError("INVALID_INPUT", "Template kind cannot change");
        if (parent.currentRevision !== input.expectedRevision)
          return { outcome: "conflict", server, targetId: String(parent.id) };
        const nextRevision = parent.currentRevision + 1;
        const [updated] = await tx
          .update(nutritionTemplate)
          .set({ currentRevision: nextRevision, updatedAt: new Date() })
          .where(ownerWhere(scope, parent.id))
          .returning();
        if (!updated) throw new Error("Nutrition template update failed");
        const revision = await addRevision(
          scope,
          tx,
          parent.id,
          nextRevision,
          content,
          input.clientMutationId,
          hash,
        );
        return {
          outcome: "applied",
          template: await serialize(scope, tx, updated, revision),
          targetId: String(parent.id),
        };
      });
    },

    async archive(
      scope: NutritionScope,
      input: { clientMutationId: string; templateId: number; expectedRevision: number },
    ): Promise<Outcome> {
      if (
        !validMutationId(input.clientMutationId) ||
        !positive(input.templateId) ||
        !Number.isInteger(input.expectedRevision) ||
        input.expectedRevision < 1
      )
        throw new NutritionError("INVALID_INPUT", "Invalid template mutation");
      const hash = fingerprint({
        operation: "archive",
        templateId: input.templateId,
        expectedRevision: input.expectedRevision,
      });
      return db.transaction(async (tx) => {
        await lockNutritionSafetyScope(tx, scope);
        const replay = await receipt(scope, tx, input.clientMutationId, hash);
        if (replay) return replay;
        const [parent] = await tx
          .select()
          .from(nutritionTemplate)
          .where(ownerWhere(scope, input.templateId))
          .for("update");
        if (!parent) throw new NutritionError("NOT_FOUND", "Nutrition template not found");
        const [previous] = await tx
          .select()
          .from(nutritionTemplateRevision)
          .where(
            and(
              eq(nutritionTemplateRevision.organizationId, scope.organizationId),
              eq(nutritionTemplateRevision.templateId, parent.id),
              eq(nutritionTemplateRevision.revision, parent.currentRevision),
            ),
          );
        if (!previous) throw new Error("Nutrition template revision missing");
        const server = await serialize(scope, tx, parent, previous);
        if (parent.archivedAt) return { outcome: "conflict", server, targetId: String(parent.id) };
        if (parent.currentRevision !== input.expectedRevision)
          return { outcome: "conflict", server, targetId: String(parent.id) };
        const now = new Date();
        const next = parent.currentRevision + 1;
        const [archived] = await tx
          .update(nutritionTemplate)
          .set({ currentRevision: next, archivedAt: now, updatedAt: now })
          .where(ownerWhere(scope, parent.id))
          .returning();
        if (!archived) throw new Error("Nutrition template archive failed");
        const revision = await tx
          .insert(nutritionTemplateRevision)
          .values({
            ...scope,
            templateId: parent.id,
            revision: next,
            kind: previous.kind,
            name: previous.name,
            yieldServings: previous.yieldServings,
            ingredients: previous.ingredients,
            clientMutationId: input.clientMutationId,
            fingerprint: hash,
          })
          .returning()
          .then(([row]) => row);
        if (!revision) throw new Error("Nutrition template archive receipt failed");
        return {
          outcome: "applied",
          template: await serialize(scope, tx, archived, revision),
          targetId: String(parent.id),
        };
      });
    },
  };
}
