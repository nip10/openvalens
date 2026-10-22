import { InMemoryRateLimiter } from "@openvalens/ai/rate-limit";
import type { Database } from "@openvalens/db";
import type { NutritionScope } from "@openvalens/nutrition";
import { readNutritionTargetSettings } from "@openvalens/nutrition/targets";

import type { ImportRecipeFromUrlOutput } from "../contracts/nutrition-recipe-import";
import { parseRecipeDraft } from "../presenters/recipe-draft";
import { extractRecipePage } from "./html-recipe";
import { isAllowedByRobots } from "./robots";
import {
  parseImportUrl,
  safeFetch,
  type SafeFetchOptions,
  type SafeFetchResult,
} from "./safe-fetch";

/**
 * Recipe import from a URL (Issue #82).
 *
 * Runs only when the member asks, and only after they turned import on in
 * their nutrition settings. It fetches the one page they submitted (after
 * checking robots.txt), keeps schema.org Recipe ingredients, servings and
 * attribution, and returns them as an unsaved draft. Open Graph supplies the
 * title of an otherwise empty draft, never ingredients. Instructions, images,
 * stories and reviews are dropped, and nothing is stored: a failure at any
 * step leaves no trace beyond the rate-limit counters.
 */

export const RECIPE_IMPORT_USER_AGENT_TOKEN = "OpenValensRecipeImport";
export const RECIPE_IMPORT_USER_AGENT = `${RECIPE_IMPORT_USER_AGENT_TOKEN}/1.0 (+https://github.com/nip10/openvalens; one page on member request)`;

export const RECIPE_IMPORT_LIMITS = Object.freeze({
  perUserPerMinute: 10,
  perDomainPerMinute: 30,
  maxRedirects: 3,
  pageTimeoutMs: 10_000,
  pageMaxBytes: 2 * 1024 * 1024,
  robotsTimeoutMs: 5_000,
  robotsMaxBytes: 512 * 1024,
});

export type PageFetcher = (url: string, options: SafeFetchOptions) => Promise<SafeFetchResult>;

export type RecipeImportDeps = {
  fetchPage?: PageFetcher;
  userLimiter?: InMemoryRateLimiter;
  domainLimiter?: InMemoryRateLimiter;
  now?: () => Date;
  /** Fetch policy overrides, for tests against a loopback server only. */
  fetchOverrides?: Pick<SafeFetchOptions, "resolve" | "isAllowedAddress" | "allowPort">;
};

export type RecipeImportService = {
  importFromUrl(
    db: Pick<Database, "select">,
    scope: NutritionScope,
    input: { url: string },
  ): Promise<ImportRecipeFromUrlOutput>;
};

const COPY = {
  disabled: "Turn on recipe import in your nutrition settings first.",
  rateLimited: "Too many imports just now. Try again in a minute.",
  blockedUrl: "Enter a public http or https recipe address.",
  robots: "This site does not allow automated imports. Paste the ingredients instead.",
  fetchFailed: "The page could not be loaded. Check the address or paste the ingredients instead.",
  noRecipe:
    "No structured recipe was found on that page. The draft has the page title only; add the ingredients yourself.",
  invalid: "The recipe data on that page could not be read. Paste the ingredients instead.",
  choose: "Choose which recipe to continue with.",
} as const;

function failure(
  status: ImportRecipeFromUrlOutput["status"],
  message: string,
): ImportRecipeFromUrlOutput {
  return { status, candidates: [], message };
}

export function createRecipeImportService(deps: RecipeImportDeps = {}): RecipeImportService {
  const fetchPage = deps.fetchPage ?? safeFetch;
  const userLimiter =
    deps.userLimiter ??
    new InMemoryRateLimiter({ limitPerMinute: RECIPE_IMPORT_LIMITS.perUserPerMinute });
  const domainLimiter =
    deps.domainLimiter ??
    new InMemoryRateLimiter({ limitPerMinute: RECIPE_IMPORT_LIMITS.perDomainPerMinute });
  const now = deps.now ?? (() => new Date());
  const base = {
    userAgent: RECIPE_IMPORT_USER_AGENT,
    maxRedirects: RECIPE_IMPORT_LIMITS.maxRedirects,
    ...deps.fetchOverrides,
  };

  /** 2xx rules apply; a missing robots.txt (4xx) allows; anything else refuses. */
  async function robotsAllow(url: URL): Promise<boolean> {
    const robots = await fetchPage(new URL("/robots.txt", url).href, {
      ...base,
      accept: ["text/plain"],
      maxBytes: RECIPE_IMPORT_LIMITS.robotsMaxBytes,
      timeoutMs: RECIPE_IMPORT_LIMITS.robotsTimeoutMs,
    });
    if (robots.ok)
      return isAllowedByRobots(
        robots.body,
        RECIPE_IMPORT_USER_AGENT_TOKEN,
        url.pathname + url.search,
      );
    return robots.reason === "http_error" && robots.status !== undefined && robots.status < 500;
  }

  return {
    async importFromUrl(db, scope, input) {
      const settings = await readNutritionTargetSettings(db, scope);
      if (!settings.recipeImportEnabled) return failure("disabled", COPY.disabled);

      const url = parseImportUrl(input.url, base.allowPort);
      if (!url) return failure("blocked_url", COPY.blockedUrl);
      if (!userLimiter.check(`${scope.organizationId}:${scope.userId}`).allowed)
        return failure("rate_limited", COPY.rateLimited);
      if (!domainLimiter.check(url.hostname).allowed)
        return failure("rate_limited", COPY.rateLimited);

      if (!(await robotsAllow(url))) return failure("robots_disallowed", COPY.robots);

      const page = await fetchPage(url.href, {
        ...base,
        accept: ["text/html", "application/xhtml+xml"],
        maxBytes: RECIPE_IMPORT_LIMITS.pageMaxBytes,
        timeoutMs: RECIPE_IMPORT_LIMITS.pageTimeoutMs,
      });
      if (!page.ok)
        return page.reason === "invalid_url" || page.reason === "blocked_address"
          ? failure("blocked_url", COPY.blockedUrl)
          : failure("fetch_failed", COPY.fetchFailed);

      const extracted = extractRecipePage(page.body);
      const importedAt = now().toISOString();
      const parsed = parseRecipeDraft({
        text: JSON.stringify(extracted.jsonLd),
        format: "json-ld",
        sourceUrl: page.url,
        importedAt,
      });
      if (parsed.status === "ready")
        return { status: "ready", candidates: parsed.candidates, message: null };
      if (parsed.status === "choose_recipe")
        return { status: "choose_recipe", candidates: parsed.candidates, message: COPY.choose };
      if (parsed.status === "invalid") return failure("invalid", COPY.invalid);
      const source = new URL(page.url);
      return {
        status: "no_recipe",
        candidates: [
          {
            id: "recipe-1",
            title: extracted.metadata.title,
            servingsText: null,
            source: { url: source.href, site: source.hostname, author: null, importedAt },
            ingredients: [],
          },
        ],
        message: COPY.noRecipe,
      };
    },
  };
}
