import { describe, expect, test } from "bun:test";

import { createGenericOidcPlugin, oidcAccountSubject } from "./generic-oidc";

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256" })}.${encode(claims)}.signature`;
}

const ISSUER = "https://idp.example.test/application/o/openvalens/";

describe("oidcAccountSubject (Issue #65)", () => {
  test("binds the account to the verified issuer and subject, never the email", () => {
    const subject = oidcAccountSubject({
      tokens: { idToken: jwt({ iss: ISSUER, sub: "user-123", email: "a@example.test" }) },
      profile: { sub: "user-123" },
    });
    expect(subject).toBe(`${ISSUER}#user-123`);
    expect(subject).not.toContain("a@example.test");
  });

  test("the same subject from a different issuer is a different identity", () => {
    const a = oidcAccountSubject({
      tokens: { idToken: jwt({ iss: ISSUER, sub: "s" }) },
      profile: {},
    });
    const b = oidcAccountSubject({
      tokens: { idToken: jwt({ iss: "https://other.example.test", sub: "s" }) },
      profile: {},
    });
    expect(a).not.toBe(b);
  });

  test.each([
    ["no id token", undefined],
    ["opaque token", "opaque"],
    ["missing iss", jwt({ sub: "s" })],
    ["missing sub", jwt({ iss: ISSUER })],
    ["non-string sub", jwt({ iss: ISSUER, sub: 42 })],
    ["issuer with separator", jwt({ iss: "https://x#y", sub: "s" })],
  ])("rejects %s", (_label, idToken) => {
    expect(() => oidcAccountSubject({ tokens: { idToken }, profile: {} })).toThrow();
  });

  test("rejects a userinfo subject that disagrees with the ID token", () => {
    expect(() =>
      oidcAccountSubject({
        tokens: { idToken: jwt({ iss: ISSUER, sub: "user-123" }) },
        profile: { sub: "someone-else" },
      }),
    ).toThrow();
  });
});

describe("createGenericOidcPlugin (Issue #65)", () => {
  test("is invite-only, PKCE, verified ID tokens and never overrides the local user", () => {
    const plugin = createGenericOidcPlugin({
      providerId: "authentik",
      clientId: "client",
      clientSecret: "synthetic-secret",
      discoveryUrl: "https://idp.example.test/.well-known/openid-configuration",
      displayName: "Acme SSO",
    });
    const [config] = plugin.options.config;
    expect(config).toMatchObject({
      providerId: "authentik",
      name: "Acme SSO",
      requireIdTokenVerification: true,
      pkce: true,
      disableSignUp: true,
      disableImplicitSignUp: true,
      overrideUserInfo: false,
    });
    expect(config?.scopes).toContain("openid");
    expect(config?.accountSubject).toBe(oidcAccountSubject);
  });
});
