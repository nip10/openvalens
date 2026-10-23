import { describe, expect, test } from "bun:test";

import serverBuild from "../../apps/server/tsdown.config.ts";
import { transformLinguiMacros } from "./macro-transform";

/**
 * Server-sent text is translated (#231), so server code may use Lingui
 * macros. They must be compiled away in every runtime: the tsdown build that
 * produces the production image, and the Bun preload for `bun run` and tests.
 */
const SOURCE = `import { msg } from "@lingui/core/macro";
export const SUBJECT = msg\`Your weekly insights summary\`;
`;

describe("Lingui macro transform (#231)", () => {
  test("compiles macros to plain descriptors and leaves other files alone", async () => {
    const out = await transformLinguiMacros(SOURCE, "/repo/packages/api/src/example.ts");
    expect(out).not.toBeNull();
    expect(out).not.toContain("@lingui/core/macro");
    expect(out).toContain("Your weekly insights summary");
    expect(await transformLinguiMacros("export const x = 1;", "/repo/a.ts")).toBeNull();
    expect(await transformLinguiMacros(SOURCE, "/repo/node_modules/pkg/index.ts")).toBeNull();
  });

  test("the server's production build runs the transform", async () => {
    const config = Array.isArray(serverBuild) ? serverBuild[0] : serverBuild;
    const plugin = (config.plugins as { name: string; transform: { handler: Function } }[]).find(
      (entry) => entry?.name === "lingui-macro",
    );
    expect(plugin).toBeDefined();
    const result = (await plugin!.transform.handler(SOURCE, "/repo/packages/api/src/x.ts")) as {
      code: string;
    } | null;
    expect(result?.code).not.toContain("@lingui/core/macro");
    expect(result?.code).toContain("Your weekly insights summary");
  });
});
