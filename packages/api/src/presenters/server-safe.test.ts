import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

/**
 * Lingui macros are compiled by the app bundlers (and the test preload), not
 * on the server. Presenter modules the server reaches at runtime must stay
 * macro-free and keep plain English until server-side text follows the
 * recipient's language (#67, #61). This walks value imports from every
 * non-presenter API module into presenters.
 */
const SRC = join(import.meta.dir, "..");
const VALUE_IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)"/g;

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith(".")
    ? normalize(join(dirname(from), spec))
    : spec.startsWith("@openvalens/api/")
      ? join(SRC, spec.slice("@openvalens/api/".length))
      : null;
  if (!base) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")])
    if (existsSync(candidate)) return candidate;
  return null;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [path] : [];
  });
}

function valueImports(path: string): string[] {
  return [...readFileSync(path, "utf8").matchAll(VALUE_IMPORT)]
    .map((match) => resolve(path, match[1]!))
    .filter((target): target is string => target !== null);
}

describe("server-reachable presenters (#67)", () => {
  test("use no Lingui macros", () => {
    const presenters = join(SRC, "presenters");
    const reachable = new Set<string>();
    const stack = walk(SRC)
      .filter((file) => !file.startsWith(presenters))
      .flatMap(valueImports)
      .filter((file) => file.startsWith(presenters));
    while (stack.length) {
      const file = stack.pop()!;
      if (reachable.has(file)) continue;
      reachable.add(file);
      stack.push(...valueImports(file).filter((next) => next.startsWith(presenters)));
    }
    expect(reachable.size).toBeGreaterThan(0);
    for (const file of reachable)
      expect(readFileSync(file, "utf8"), file).not.toMatch(/@lingui\/(core|react)\/macro/);
  });
});
