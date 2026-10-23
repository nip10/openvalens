import { inEnglish } from "@openvalens/i18n/testing";
import { describe, expect, test } from "bun:test";

import { parseRecipeDraft } from "./recipe-draft";

const importedAt = "2026-10-22T12:00:00.000Z";

describe("parseRecipeDraft", () => {
  test("keeps pasted ingredient lines as raw, unmatched text", () => {
    const result = parseRecipeDraft({
      text: "  200 g lentils \n\n1 onion\r\n",
      format: "ingredients",
      importedAt,
    });
    expect(result.status).toBe("ready");
    expect(result.candidates[0]!.ingredients).toEqual([
      {
        id: "ingredient-1",
        rawText: "200 g lentils",
        quantityText: null,
        unitText: null,
        foodText: null,
        preparation: "unknown",
      },
      {
        id: "ingredient-2",
        rawText: "1 onion",
        quantityText: null,
        unitText: null,
        foodText: null,
        preparation: "unknown",
      },
    ]);
    expect(parseRecipeDraft({ text: " \n ", format: "ingredients", importedAt }).status).toBe(
      "empty",
    );
  });

  test("reads Recipe JSON-LD without an author or yield", () => {
    const result = parseRecipeDraft({
      text: JSON.stringify({
        "@type": "http://schema.org/Recipe",
        recipeIngredient: [{ text: "salt" }],
      }),
      format: "json-ld",
      importedAt,
    });
    expect(result.status).toBe("ready");
    expect(result.candidates[0]).toMatchObject({
      title: null,
      servingsText: null,
      source: { url: null, site: null, author: null, importedAt },
    });
  });

  test("offers a choice instead of merging several recipes", () => {
    const recipe = (name: string) => ({ "@type": "Recipe", name, recipeIngredient: ["x"] });
    const result = parseRecipeDraft({
      text: JSON.stringify([recipe("A"), recipe("B")]),
      format: "json-ld",
      importedAt,
    });
    expect(result.status).toBe("choose_recipe");
    expect(result.candidates.map((candidate) => candidate.title)).toEqual(["A", "B"]);
  });

  test("fails closed on malformed or oversized data without echoing it", () => {
    const secret = "my-private-note";
    for (const text of [
      `{ ${secret}`,
      JSON.stringify({ "@type": "Recipe", recipeIngredient: [secret, 42] }),
      JSON.stringify({ "@type": "Recipe", recipeIngredient: Array(201).fill("x") }),
    ]) {
      const result = parseRecipeDraft({ text, format: "json-ld", importedAt });
      expect(result.status).toBe("invalid");
      expect(result.candidates).toEqual([]);
      expect(inEnglish(result.message!)).not.toContain(secret);
    }
    expect(
      parseRecipeDraft({
        text: JSON.stringify({ "@type": "WebPage" }),
        format: "json-ld",
        importedAt,
      }).status,
    ).toBe("unsupported");
  });

  test("rejects source URLs with credentials or other schemes", () => {
    for (const sourceUrl of ["javascript:alert(1)", "https://u:p@example.test/r"])
      expect(
        parseRecipeDraft({ text: "salt", format: "ingredients", sourceUrl, importedAt }).status,
      ).toBe("invalid");
  });
});
