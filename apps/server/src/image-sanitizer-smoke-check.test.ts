import { describe, expect, test } from "bun:test";

import { findSharpDistributionFailure, type EmittedModule } from "./image-sanitizer-smoke-check";

const implementation =
  'import sharp from "sharp";\nasync function sanitizeImage(input) { return sharp(input); }';

describe("emitted Sharp sanitizer packaging proof", () => {
  test("allows unrelated entity data that mentions the sharp symbol", () => {
    const modules: EmittedModule[] = [
      { name: "entities.mjs", source: 'const glyph = "♯";' },
      { name: "sanitize-image.mjs", source: implementation },
    ];

    expect(findSharpDistributionFailure(modules)).toBeUndefined();
  });

  test("requires a bare Sharp import in the sanitizeImage implementation module", () => {
    expect(
      findSharpDistributionFailure([
        {
          name: "sanitize-image.mjs",
          source: "async function sanitizeImage(input) { return input; }",
        },
      ]),
    ).toBe("sharp_bare_specifier");
  });

  test.each([
    [
      'import sharp from "sharp";',
      'import sharp from "sharp";\nasync function sanitizeImage(input) {}',
    ],
    ['require("sharp")', 'const sharp = require("sharp");\nfunction sanitizeImage(input) {}'],
  ])("accepts bare Sharp loading via %s", (_specifier, source) => {
    expect(findSharpDistributionFailure([{ name: "sanitize-image.mjs", source }])).toBeUndefined();
  });

  test("rejects a bundled Sharp path anywhere, even alongside a bare import", () => {
    expect(
      findSharpDistributionFailure([
        { name: "sanitize-image.mjs", source: implementation },
        { name: "other.mjs", source: 'const dependency = "node_modules/sharp/lib/index.js";' },
      ]),
    ).toBe("sharp_inlined");
  });

  test("requires at least one sanitizeImage implementation module", () => {
    expect(
      findSharpDistributionFailure([{ name: "index.mjs", source: 'import sharp from "sharp";' }]),
    ).toBe("sanitize_image_missing");
  });
});
