import { msg } from "@lingui/core/macro";
import type { NutrientValues } from "../contracts/nutrition-diary";
import type { FoodChoice } from "../contracts/nutrition-diary";
import type {
  NutritionTemplate,
  NutritionTemplateContent,
  NutritionTemplateOutcome,
} from "../contracts/nutrition-templates";

export type { NutritionTemplate, NutritionTemplateContent };
export type NutritionTemplateIngredient = NutritionTemplate["ingredients"][number];
export type NutritionTemplateKind = NutritionTemplate["kind"];
export type NutritionTemplateIngredientInput = NutritionTemplateContent["ingredients"][number];
export type TemplateMutationOutcome = NutritionTemplateOutcome;

export const NUTRITION_TEMPLATES_COPY = Object.freeze({
  title: msg`Saved meals and recipes`,
  meals: msg`Meals`,
  recipes: msg`Recipes`,
  createMeal: msg`Save current meal`,
  createRecipe: msg`Create recipe`,
  empty: msg`No saved meals or recipes yet.`,
  name: msg`Name`,
  yield: msg`Servings per recipe`,
  ingredient: msg`Ingredient`,
  addIngredient: msg`Add ingredient`,
  amount: msg`Amount`,
  unit: msg`Unit`,
  remove: msg`Remove ingredient`,
  save: msg`Save`,
  cancel: msg`Cancel`,
  edit: msg`Edit`,
  archive: msg`Archive`,
  restore: msg`Undo archive`,
  undo: msg`Undo`,
  log: msg`Log`,
  servings: msg`Servings`,
  ingredientsCoverage: msg({
    message:
      "Energy: {energyKnown}/{total} ingredients; protein: {proteinKnown}/{total} ingredients",
  }),
  ingredientNutrients: msg({ message: "{name}: energy {energy}; protein {protein}" }),
  amountHidden: msg`Amount hidden`,
  unknown: msg`unknown`,
  recipeImport: msg`Import a recipe`,
  recipeImportHelp: msg`Paste ingredients or recipe JSON-LD to start a draft. Nothing is saved until you match every ingredient.`,
  recipeText: msg`Ingredients or JSON-LD`,
  recipeUrl: msg`Recipe URL`,
  importUrl: msg`Fetch recipe`,
  parseDraft: msg`Review recipe`,
  chooseRecipe: msg`Choose a recipe`,
  closeImport: msg`Close recipe import`,
  recipeImported: msg`Recipe draft ready to match`,
  recipeTooLarge: msg`Recipe input is too large.`,
  recipeNoDraft: msg`No draft was created.`,
  recipeChoose: msg`Choose a recipe to review.`,
  recipeImportFailed: msg`Recipe import did not finish. Try again when connected.`,
  ingredientsMode: msg`Ingredients`,
  jsonLdMode: msg`JSON-LD`,
  servingsPreview: msg`Servings`,
  unknownNutrition: msg`Nutrition information unavailable`,
  networkRequired: msg`Connect to the internet to manage saved meals and recipes.`,
  saveFailed: msg`Could not confirm the change. Refresh saved items before retrying.`,
  archived: msg`Saved item archived.`,
  saved: msg`Saved. Nothing was logged.`,
  conflict: msg`This saved item changed elsewhere. Review the server version before saving again.`,
  chooseFood: msg`Find a food to match this ingredient`,
  searchFood: msg`Search foods`,
  noFoods: msg`No matching foods found.`,
  matchImported: msg`Match every imported ingredient to a food before saving.`,
  imported: msg`Imported recipe draft`,
  badAmount: msg`Enter an amount greater than zero.`,
  badYield: msg`Enter servings greater than zero.`,
  invalidTemplate: msg`Add a name and at least one fully matched ingredient with an amount and unit.`,
});

export const TEMPLATE_RECIPE_IMPORT_COPY = Object.freeze({
  disclosure: msg`Only recipe details needed to create a draft are retained. Steps, photos and stories are not saved.`,
  urlDisclosure: msg`Fetches this one page once. Nothing is saved until you review and match its ingredients.`,
});

export type TemplateFoodChoiceMetadata = {
  basis?: FoodChoice["basis"];
  nutrientsPerBasis?: NutrientValues;
  defaultAmount?: number;
  defaultUnit?: import("../contracts/nutrition-diary").AmountUnit;
};

/** Coverage is about ingredient nutrient availability, not nutrient quantity; never substitutes zero. */
export function templateIngredientCoverage(ingredients: readonly { nutrients: NutrientValues }[]) {
  const available = (key: "energyKcal" | "proteinG") =>
    ingredients.filter(
      (item) => typeof item.nutrients[key] === "number" && Number.isFinite(item.nutrients[key]),
    ).length;
  return {
    energyKnown: available("energyKcal"),
    proteinKnown: available("proteinG"),
    total: ingredients.length,
  };
}

/** A render-safe amount: unknown/hidden values stay empty rather than becoming zero. */
export function templateAmountValue(value: number | null | undefined, hidden: boolean): string {
  return hidden || value == null || !Number.isFinite(value) ? "" : String(value);
}
