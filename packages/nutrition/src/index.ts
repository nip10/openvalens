export * from "./errors";
export * from "./nutrients";
export * from "./local-day";
export * from "./snapshot";
export * from "./repository";
export * from "./catalog";
export * from "./diary";
export * from "./food-lookup";
export * from "./food-search";
export * from "./totals";
export * from "./daily-totals";
export * from "./coach-consent";
export * from "./coach-context";
export * from "./custom-foods";
export * from "./energy-estimate";
export * from "./nutrition-safety";
export * from "./energy-proposal-policy";
export * from "./energy-proposals";
export * from "./targets";
export * from "./plain-water";
export * from "./logging-streak";
export { createNutritionTemplates } from "./templates";
export type {
  NutritionTemplate as NutritionTemplateDomain,
  NutritionTemplateContent as NutritionTemplateContentDomain,
  NutritionTemplateIngredient as NutritionTemplateIngredientDomain,
} from "./templates";
