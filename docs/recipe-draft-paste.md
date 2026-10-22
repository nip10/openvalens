# Recipe drafts: paste and URL import

`parseRecipeDraft` is a pure, local parser for user-pasted ingredient lines or pasted JSON-LD. It does not fetch URLs, resolve foods, calculate nutrients or save data. URL import (below) reuses it on the server.

The exported TypeScript contract is:

- `RecipeDraftIngredient`: `id`, `rawText`, nullable `quantityText`, `unitText`, and `foodText`, plus `preparation` (`unknown | raw | cooked`).
- `RecipeDraft`: `id`, nullable `title` and `servingsText`, `source` (`url`, `site`, and `author` nullable; `importedAt` supplied by the caller), and `ingredients`.
- `RecipeDraftParseResult`: `status` (`ready | choose_recipe | empty | invalid | unsupported`), `candidates`, and nullable safe `message`.
- `parseRecipeDraft({ text, format, sourceUrl?, importedAt })`, with format `ingredients | json-ld`.

The caller supplies a valid ISO timestamp and optional source URL. Explicit URLs must be credential-free HTTP(S); otherwise the input is invalid. Without an explicit URL, a credential-free HTTP(S) recipe URL may be used as unverified attribution text. The hostname is derived locally. This metadata does not verify origin, rights, or licensing.

Plain ingredient mode trims surrounding whitespace, ignores blank lines, and retains each remaining line as raw text. It never infers quantity, unit, food, preparation, or nutrients. JSON-LD recognizes exact Recipe schema types (including the two schema.org HTTP(S) type URLs), including type arrays, arrays, and `@graph`. Ingredient values must be strings or objects with a string `text`. Recipe yield accepts only strings, finite numbers, or bounded arrays of those values. Names and authors use bounded plain-text values; none are safe-HTML output.

Limits: 1 MiB UTF-8 input, 32 traversal depth, 10,000 visited object/array nodes, 20 Recipe candidates, 200 ingredients per candidate, 2,000 characters per ingredient, 300 per title, 200 per servings value, and 500 per author attribution. Over-limit or malformed candidate data fails closed rather than returning partial recipes. Multiple valid Recipe entries are returned as `choose_recipe`, never silently merged or selected. Invalid/unsupported results contain no candidates and messages do not echo pasted content.

The parser discards instructions, nutrition, images, reviews, descriptions, and other page content. Imported strings are untrusted text; consumers must escape them for their output context and must not treat them as HTML-safe. A user-confirmed food match and any save operation are designed separately.

## URL import (Issue #82)

`nutritionRecipeImport.fromUrl({ url })` turns one recipe page into the same unsaved draft. It is **off by default**: the member turns on "Import recipes from a web address" in nutrition settings (`recipeImportEnabled` on `nutrition_target_settings`) and can turn it off at any time. While off, the server never fetches anything and returns `disabled`.

What it does, in order (`packages/api/src/recipe-import/`):

1. Requires the member's own, non-impersonated session (`records:write`); the scope comes from the session, never the input.
2. Accepts only credential-free `http`/`https` URLs on the default port.
3. Rate limits: 10 imports per minute per member and 30 per minute per site (process-local).
4. Reads `robots.txt` as `OpenValensRecipeImport`. A `Disallow` for our agent (or `*`) refuses the import; a missing file (4xx) allows it; any other failure refuses it.
5. Fetches the page with `safeFetch`: every resolved address must be public (loopback, private, link-local, CGNAT, multicast, documentation and IPv6 special ranges are blocked, including IPv4-mapped forms); the connection is pinned to the checked addresses so DNS cannot rebind it; at most 3 redirects, each re-checked; 10 s total; 2 MB; `text/html` only; no cookies or auth headers.
6. Keeps only schema.org `Recipe` JSON-LD ingredients, servings, title, author and the source URL. Instructions, images, descriptions, reviews and the rest of the page are dropped. A page with only Open Graph tags yields an empty draft with the page title (`no_recipe`); Open Graph never supplies ingredients.

Nothing is written to the database. A failure at any step returns a status with fixed copy and no partial draft. Logs carry the outcome status only, never the URL, host or page content. Photo import is not part of this: it depends on the per-provider consent work in #71.
