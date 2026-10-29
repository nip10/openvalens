import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Issue #302 — `{plural(n, …)}` straight in JSX compiles to Lingui's global
 * `i18n`, which the app never activates (it renders with its own instance),
 * so the screen throws "Attempted to call a translation function without
 * setting a locale" and a release build closes. Wrap it in the component's
 * `t`: {t`${plural(n, …)}`}. Found by the e2e suite on the Training tab.
 */
const ROOT = join(import.meta.dir, "..", "..");
const BARE_PLURAL = /(?<![$\w])\{\s*(plural|select|selectOrdinal)\(/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".tsx") && !name.endsWith(".test.tsx") ? [path] : [];
  });
}

describe("Lingui macros in JSX", () => {
  test("no bare plural/select in JSX children", () => {
    const offenders = ["app", "components"].flatMap((dir) =>
      sources(join(ROOT, dir)).flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line, index) =>
            BARE_PLURAL.test(line) ? [`${relative(ROOT, file)}:${index + 1}`] : [],
          ),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
