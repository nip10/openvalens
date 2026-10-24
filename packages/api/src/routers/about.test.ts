import { describe, expect, test } from "bun:test";

import type { Context } from "../context";
import { UPSTREAM_SOURCE_CODE_URL } from "../source-code";
import { appRouter } from "./index";

function context(overrides: Record<string, unknown> = {}): Context {
  return {
    session: null,
    honoContext: { req: { raw: { headers: new Headers() } } },
    ...overrides,
  } as unknown as Context;
}

describe("about.info (Issue #56)", () => {
  test("is public and falls back to the upstream repository", async () => {
    expect(await appRouter.about.info.callable({ context: context() })({})).toEqual({
      license: "AGPL-3.0-or-later",
      sourceCodeUrl: UPSTREAM_SOURCE_CODE_URL,
    });
  });

  test("reports the operator's source URL", async () => {
    const result = await appRouter.about.info.callable({
      context: context({ sourceCodeUrl: "https://git.example.org/me/fork" }),
    })({});
    expect(result.sourceCodeUrl).toBe("https://git.example.org/me/fork");
  });
});
