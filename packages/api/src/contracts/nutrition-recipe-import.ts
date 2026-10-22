import { z } from "zod";

/**
 * `nutritionRecipeImport.*` wire contract (Issue #82): turning a recipe URL
 * the member submits into an editable, unsaved draft. Shared by the server
 * router, `apps/web` and `apps/native`, so this file imports only `zod`.
 *
 * The import writes nothing: the result is a draft the member reviews and
 * edits on their device. Every string in it is untrusted page text.
 */

export const importRecipeFromUrlInput = z.strictObject({
  url: z.string().trim().min(1).max(2_000),
});
export type ImportRecipeFromUrlInput = z.infer<typeof importRecipeFromUrlInput>;

export const recipeDraftIngredient = z.object({
  id: z.string(),
  rawText: z.string(),
  quantityText: z.string().nullable(),
  unitText: z.string().nullable(),
  foodText: z.string().nullable(),
  preparation: z.enum(["unknown", "raw", "cooked"]),
});

export const recipeDraft = z.object({
  id: z.string(),
  title: z.string().nullable(),
  servingsText: z.string().nullable(),
  source: z.object({
    url: z.string().nullable(),
    site: z.string().nullable(),
    author: z.string().nullable(),
    importedAt: z.string(),
  }),
  ingredients: z.array(recipeDraftIngredient),
});

export const RECIPE_IMPORT_STATUSES = [
  /** One recipe was found. */
  "ready",
  /** Several recipes were found; the member picks one. */
  "choose_recipe",
  /** No structured recipe: one empty draft with the page title (metadata only). */
  "no_recipe",
  /** The page's recipe data is malformed or over the limits. */
  "invalid",
  /** The member has not turned recipe import on. */
  "disabled",
  "rate_limited",
  /** The URL is not an allowed http(s) address. */
  "blocked_url",
  /** The site's robots.txt does not allow the import. */
  "robots_disallowed",
  /** The page could not be fetched within the limits. */
  "fetch_failed",
] as const;

export const importRecipeFromUrlOutput = z.object({
  status: z.enum(RECIPE_IMPORT_STATUSES),
  candidates: z.array(recipeDraft),
  /** Safe, fixed copy; never echoes page content. */
  message: z.string().nullable(),
});
export type ImportRecipeFromUrlOutput = z.infer<typeof importRecipeFromUrlOutput>;
