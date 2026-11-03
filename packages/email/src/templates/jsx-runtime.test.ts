import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The server bundle (apps/server, tsdown) compiles these templates with the
 * server's tsconfig, whose `jsxImportSource` is `hono/jsx`. React Email cannot
 * render Hono elements ("Invalid JSX tag name"), which broke every templated
 * email in production. The per-file pragma makes the React runtime win.
 */
const PRAGMA = "/** @jsxImportSource react */";

describe("email templates use the React JSX runtime", () => {
  const dir = import.meta.dir;
  const files = readdirSync(dir).filter((name) => name.endsWith(".tsx"));

  test("finds the templates", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const name of files) {
    test(name, () => {
      const firstLine = readFileSync(join(dir, name), "utf8").split("\n", 1)[0];
      expect(firstLine).toBe(PRAGMA);
    });
  }
});
