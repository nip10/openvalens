import { describe, expect, test } from "bun:test";

import type { Context } from "../context";
import { appRouter } from "./index";

function context(overrides: Record<string, unknown> = {}): Context {
  return {
    session: null,
    honoContext: { req: { raw: { headers: new Headers() } } },
    ...overrides,
  } as unknown as Context;
}

describe("signIn.options (Issue #65)", () => {
  test("is public and reports no OIDC when the server binds none", async () => {
    expect(await appRouter.signIn.options.callable({ context: context() })({})).toEqual({
      oidc: null,
      google: false,
      apple: false,
      appleNative: false,
    });
  });

  test("returns only the provider id and button label", async () => {
    const result = await appRouter.signIn.options.callable({
      context: context({
        signInOptions: {
          oidc: { providerId: "authentik", displayName: "Acme SSO", clientSecret: "leak" },
        },
      }),
    })({});
    expect(result).toEqual({
      oidc: { providerId: "authentik", displayName: "Acme SSO" },
      google: false,
      apple: false,
      appleNative: false,
    });
    expect(JSON.stringify(result)).not.toContain("leak");
  });

  test("Issue #296 — Google and Apple as flags only; native Apple needs Apple", async () => {
    const result = await appRouter.signIn.options.callable({
      context: context({
        signInOptions: { oidc: null, google: true, apple: true, appleNative: true },
      }),
    })({});
    expect(result).toEqual({ oidc: null, google: true, apple: true, appleNative: true });
    const nativeOnly = await appRouter.signIn.options.callable({
      context: context({ signInOptions: { oidc: null, apple: false, appleNative: true } }),
    })({});
    expect(nativeOnly.appleNative).toBe(false);
  });
});
