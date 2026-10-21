# Safe recipe paste drafts

`parseRecipeDraft` is a pure, local parser for user-pasted ingredient lines or pasted JSON-LD. It does not fetch URLs, resolve foods, calculate nutrients, save data, or provide photo/import providers. URL ingestion is not implemented.

The exported TypeScript contract is:

- `RecipeDraftIngredient`: `id`, `rawText`, nullable `quantityText`, `unitText`, and `foodText`, plus `preparation` (`unknown | raw | cooked`).
- `RecipeDraft`: `id`, nullable `title` and `servingsText`, `source` (`url`, `site`, and `author` nullable; `importedAt` supplied by the caller), and `ingredients`.
- `RecipeDraftParseResult`: `status` (`ready | choose_recipe | empty | invalid | unsupported`), `candidates`, and nullable safe `message`.
- `parseRecipeDraft({ text, format, sourceUrl?, importedAt })`, with format `ingredients | json-ld`.

The caller supplies a valid ISO timestamp and optional source URL. Explicit URLs must be credential-free HTTP(S); otherwise the input is invalid. Without an explicit URL, a credential-free HTTP(S) recipe URL may be used as unverified attribution text. The hostname is derived locally. This metadata does not verify origin, rights, or licensing.

Plain ingredient mode trims surrounding whitespace, ignores blank lines, and retains each remaining line as raw text. It never infers quantity, unit, food, preparation, or nutrients. JSON-LD recognizes exact Recipe schema types (including the two schema.org HTTP(S) type URLs), including type arrays, arrays, and `@graph`. Ingredient values must be strings or objects with a string `text`. Recipe yield accepts only strings, finite numbers, or bounded arrays of those values. Names and authors use bounded plain-text values; none are safe-HTML output.

Limits: 1 MiB UTF-8 input, 32 traversal depth, 10,000 visited object/array nodes, 20 Recipe candidates, 200 ingredients per candidate, 2,000 characters per ingredient, 300 per title, 200 per servings value, and 500 per author attribution. Over-limit or malformed candidate data fails closed rather than returning partial recipes. Multiple valid Recipe entries are returned as `choose_recipe`, never silently merged or selected. Invalid/unsupported results contain no candidates and messages do not echo pasted content.

The parser discards instructions, nutrition, images, reviews, descriptions, and other page content. Imported strings are untrusted text; consumers must escape them for their output context and must not treat them as HTML-safe. Future URL fetching needs separate design and security review, including SSRF defenses for every hop, DNS rebinding, redirect controls, egress restrictions, response size/time limits, and credential handling. A user-confirmed match and any save operation must also be designed separately.
