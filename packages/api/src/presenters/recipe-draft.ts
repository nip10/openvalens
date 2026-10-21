export type RecipeDraftIngredient = {
  id: string;
  rawText: string;
  quantityText: string | null;
  unitText: string | null;
  foodText: string | null;
  preparation: "unknown" | "raw" | "cooked";
};

export type RecipeDraft = {
  id: string;
  title: string | null;
  servingsText: string | null;
  source: { url: string | null; site: string | null; author: string | null; importedAt: string };
  ingredients: RecipeDraftIngredient[];
};

export type RecipeDraftParseResult = {
  status: "ready" | "choose_recipe" | "empty" | "invalid" | "unsupported";
  candidates: RecipeDraft[];
  message: string | null;
};

const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_INGREDIENTS = 200;
const MAX_CANDIDATES = 20;
const MAX_DEPTH = 32;
const MAX_NODES = 10_000;
const MAX_INGREDIENT_LENGTH = 2_000;
const MAX_TITLE_LENGTH = 300;
const MAX_SERVINGS_LENGTH = 200;
const MAX_AUTHOR_LENGTH = 500;
const EMPTY_CANDIDATES: RecipeDraft[] = [];

type ParseInput = { text: string; format: "ingredients" | "json-ld"; sourceUrl?: string; importedAt: string };
type RecipeObject = Record<string, unknown>;

function result(status: RecipeDraftParseResult["status"], message: string | null, candidates = EMPTY_CANDIDATES): RecipeDraftParseResult {
  return { status, candidates, message };
}

function isValidImportedAt(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function supportedUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function attribution(value: unknown): string | null | undefined {
  const labels: string[] = [];
  const pending = Array.isArray(value) ? value : [value];
  if (pending.length > 20) return undefined;
  for (const item of pending) {
    let label: unknown;
    if (typeof item === "string") label = item;
    else if (item !== null && typeof item === "object" && !Array.isArray(item)) label = (item as RecipeObject).name;
    else return undefined;
    if (typeof label !== "string" || label.length > MAX_AUTHOR_LENGTH) return undefined;
    labels.push(label);
  }
  const joined = labels.join(", ");
  return joined.length <= MAX_AUTHOR_LENGTH ? joined || null : undefined;
}

function plainText(value: unknown, maxLength: number): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > maxLength) return undefined;
  return value || null;
}

function servings(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value === "string") return value.length <= MAX_SERVINGS_LENGTH ? value || null : undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    const text = String(value);
    return text.length <= MAX_SERVINGS_LENGTH ? text : undefined;
  }
  if (!Array.isArray(value) || value.length > 20) return undefined;
  const values: string[] = [];
  for (const item of value) {
    if (typeof item === "string") values.push(item);
    else if (typeof item === "number" && Number.isFinite(item)) values.push(String(item));
    else return undefined;
  }
  const joined = values.join(", ");
  return joined.length <= MAX_SERVINGS_LENGTH ? joined || null : undefined;
}

function isRecipeType(value: unknown): boolean {
  const recognized = (type: unknown) => type === "Recipe"
    || type === "https://schema.org/Recipe"
    || type === "http://schema.org/Recipe";
  return Array.isArray(value) ? value.some(recognized) : recognized(value);
}

function findRecipes(root: unknown): RecipeObject[] | null {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  const recipes: RecipeObject[] = [];
  let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (depth > MAX_DEPTH || ++nodes > MAX_NODES) return null;
    if (value === null || typeof value !== "object") continue;
    if (!Array.isArray(value) && isRecipeType((value as RecipeObject)["@type"])) {
      recipes.push(value as RecipeObject);
      if (recipes.length > MAX_CANDIDATES) return null;
    }
    const children = Array.isArray(value) ? value : Object.values(value as RecipeObject);
    for (let index = children.length - 1; index >= 0; index--) stack.push({ value: children[index], depth: depth + 1 });
  }
  return recipes;
}

function makeIngredients(values: unknown): RecipeDraftIngredient[] | null {
  if (!Array.isArray(values) || values.length > MAX_INGREDIENTS) return null;
  const ingredients: RecipeDraftIngredient[] = [];
  for (let index = 0; index < values.length; index++) {
    const item = values[index];
    const text = typeof item === "string"
      ? item
      : item !== null && typeof item === "object" && !Array.isArray(item)
        ? (item as RecipeObject).text
        : undefined;
    if (typeof text !== "string" || text.length > MAX_INGREDIENT_LENGTH) return null;
    ingredients.push({
      id: `ingredient-${index + 1}`,
      rawText: text,
      quantityText: null,
      unitText: null,
      foodText: null,
      preparation: "unknown",
    });
  }
  return ingredients;
}

function draftFromRecipe(recipe: RecipeObject, index: number, importedAt: string, suppliedUrl: URL | null): RecipeDraft | null {
  const ingredients = makeIngredients(recipe.recipeIngredient);
  const title = plainText(recipe.name, MAX_TITLE_LENGTH);
  const servingsText = servings(recipe.recipeYield);
  const author = attribution(recipe.author);
  if (!ingredients || title === undefined || servingsText === undefined || author === undefined) return null;
  const recipeUrl = suppliedUrl ?? supportedUrl(recipe.url);
  return {
    id: `recipe-${index + 1}`,
    title,
    servingsText,
    source: { url: recipeUrl?.href ?? null, site: recipeUrl?.hostname ?? null, author, importedAt },
    ingredients,
  };
}

export function parseRecipeDraft(input: ParseInput): RecipeDraftParseResult {
  if (!input || typeof input.text !== "string" || (input.format !== "ingredients" && input.format !== "json-ld")
    || !isValidImportedAt(input.importedAt)) {
    return result("invalid", "The pasted recipe input is invalid.");
  }
  if (new TextEncoder().encode(input.text).byteLength > MAX_INPUT_BYTES) {
    return result("invalid", "The pasted recipe exceeds the supported size limit.");
  }
  let suppliedUrl: URL | null = null;
  if (input.sourceUrl !== undefined) {
    suppliedUrl = supportedUrl(input.sourceUrl);
    if (!suppliedUrl) return result("invalid", "The source URL must be a credential-free HTTP or HTTPS URL.");
  }

  if (input.format === "ingredients") {
    const lines = input.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return result("empty", "Paste one ingredient per line.");
    if (lines.length > MAX_INGREDIENTS || lines.some((line) => line.length > MAX_INGREDIENT_LENGTH)) {
      return result("invalid", "The pasted ingredients exceed supported limits.");
    }
    return result("ready", null, [{
      id: "recipe-1", title: null, servingsText: null,
      source: { url: suppliedUrl?.href ?? null, site: suppliedUrl?.hostname ?? null, author: null, importedAt: input.importedAt },
      ingredients: lines.map((rawText, index) => ({ id: `ingredient-${index + 1}`, rawText, quantityText: null, unitText: null, foodText: null, preparation: "unknown" })),
    }]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.text);
  } catch {
    return result("invalid", "The pasted JSON-LD is not valid JSON.");
  }
  const recipes = findRecipes(parsed);
  if (!recipes) return result("invalid", "The pasted JSON-LD exceeds supported limits.");
  if (!recipes.length) return result("unsupported", "No supported Recipe entry was found.");
  const candidates: RecipeDraft[] = [];
  for (let index = 0; index < recipes.length; index++) {
    const draft = draftFromRecipe(recipes[index]!, index, input.importedAt, suppliedUrl);
    if (!draft) return result("invalid", "A Recipe entry contains unsupported or oversized ingredient data.");
    candidates.push(draft);
  }
  return candidates.length > 1
    ? result("choose_recipe", "Choose which recipe to continue with.", candidates)
    : result("ready", null, candidates);
}
