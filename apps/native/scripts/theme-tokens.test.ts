import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderThemeBlock, syncGlobalCss } from "./theme-tokens";

const root = join(import.meta.dir, "..");

test("global.css carries the Bloom tokens as uniwind light/dark variants", () => {
  const tokens = readFileSync(join(root, "../../packages/ui/src/styles/tokens.css"), "utf8");
  const globalCss = readFileSync(join(root, "global.css"), "utf8");
  expect(syncGlobalCss(globalCss, tokens)).toBe(globalCss);
});

test("dark values come from .dark and fall back to the light value", () => {
  const block = renderThemeBlock(
    ":root {\n  --paper: #fbf1ea;\n  --radius: 12px;\n  --ink: #2e211c;\n}\n.dark {\n  --paper: #1d1613;\n}\n",
  );
  expect(block).toContain("@variant light {\n      --paper: #fbf1ea;\n      --ink: #2e211c;");
  expect(block).toContain("@variant dark {\n      --paper: #1d1613;\n      --ink: #2e211c;");
  expect(block).not.toContain("--radius");
});
