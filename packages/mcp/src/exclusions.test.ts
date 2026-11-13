import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { MCP_SOURCE_TABLES } from "./sources";
import { MCP_TOOLS } from "./tools";

/**
 * Issue #439 — cycle data and progress photos are never reachable from a
 * connected AI app. Enforced three ways: `.oxlintrc.json` forbids the imports
 * in this package, this test re-checks every import specifier and schema
 * table here, and `http.integration.test.ts` seeds cycle rows and a photo
 * and proves no tool response contains them.
 */

const SRC = new URL(".", import.meta.url).pathname;

/** Modules this package must never import. */
const FORBIDDEN_SPECIFIERS = [
  /cycle/i,
  /photo/i,
  /storage/i,
  /clinical-export/,
  // The body package root re-exports its cycle modules; import a subpath instead.
  /^@openvalens\/body$/,
  /^@openvalens\/api(\/|$)/,
];

/** Schema modules the data sources may read, each limited to the tables below. */
const ALLOWED_SCHEMA_MODULES = new Set([
  "@openvalens/db/schema/ai-apps",
  "@openvalens/db/schema/auth",
  "@openvalens/db/schema/body",
  "@openvalens/db/schema/clinical",
  "@openvalens/db/schema/health-record",
  "@openvalens/db/schema/insights",
  "@openvalens/db/schema/oauth",
  "@openvalens/db/schema/plans",
  "@openvalens/db/schema/product-settings",
  "@openvalens/db/schema/trackers",
]);

async function sourceFiles(): Promise<string[]> {
  const entries = await readdir(SRC, { recursive: true });
  return entries
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
    .map((entry) => join(SRC, entry));
}

function imports(text: string): Array<{ specifier: string; names: string[] }> {
  const found: Array<{ specifier: string; names: string[] }> = [];
  const pattern = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  for (const match of text.matchAll(pattern)) {
    const names = (match[1] ?? "")
      .replace(/[{}]/g, "")
      .split(",")
      .map((name) =>
        name
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0]!
          .trim(),
      )
      .filter(Boolean);
    found.push({ specifier: match[2]!, names });
  }
  for (const match of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g))
    found.push({ specifier: match[1]!, names: [] });
  return found;
}

function snake(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

describe("connected AI apps never reach cycle data or photos", () => {
  test("the import scanner sees named, type and dynamic imports", () => {
    expect(
      imports(
        'import { cyclePeriod as rows } from "@openvalens/db/schema/cycle";\nimport type { X } from "y";\nawait import("@openvalens/storage");',
      ),
    ).toEqual([
      { specifier: "@openvalens/db/schema/cycle", names: ["cyclePeriod"] },
      { specifier: "y", names: ["X"] },
      { specifier: "@openvalens/storage", names: [] },
    ]);
  });

  test("no file imports a cycle, photo or storage module", async () => {
    const offenders: string[] = [];
    const files = await sourceFiles();
    expect(files.map((file) => file.slice(SRC.length)).sort()).toContain("sources.ts");
    for (const file of files) {
      for (const { specifier, names } of imports(await Bun.file(file).text())) {
        if (FORBIDDEN_SPECIFIERS.some((pattern) => pattern.test(specifier)))
          offenders.push(`${file}: ${specifier}`);
        for (const name of names)
          if (/cycle|photo/i.test(name)) offenders.push(`${file}: ${name} from ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("schema imports stay inside the reviewed table allowlist", async () => {
    const outside: string[] = [];
    const allowedTables = new Set<string>([
      ...MCP_SOURCE_TABLES,
      // Grant and key bookkeeping, and the membership checks of `grants.ts`.
      "ai_app_grant",
      "ai_app_key",
      "ai_app_call",
      // OAuth token lookup, revoke and client cleanup (M1b): no member data.
      "oauth_access_token",
      "oauth_refresh_token",
      "oauth_consent",
      "oauth_client",
      "member",
      "organization",
      "user",
    ]);
    for (const file of await sourceFiles()) {
      for (const { specifier, names } of imports(await Bun.file(file).text())) {
        if (!specifier.startsWith("@openvalens/db/schema")) continue;
        if (!ALLOWED_SCHEMA_MODULES.has(specifier)) {
          outside.push(`${file}: ${specifier}`);
          continue;
        }
        for (const name of names)
          if (!allowedTables.has(snake(name))) outside.push(`${file}: ${name} from ${specifier}`);
      }
    }
    expect(outside).toEqual([]);
  });

  test("no tool is named for, or scoped to, cycle data or photos", () => {
    for (const tool of MCP_TOOLS) {
      expect(`${tool.name} ${tool.scope}`).not.toMatch(/cycle|photo|period|menstru/i);
    }
  });
});
