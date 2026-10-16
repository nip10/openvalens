import { describe, expect, test } from "bun:test";

import {
  describeOidcIntegration,
  OidcConfigError,
  oidcSignInOption,
  parseOidcConfig,
} from "./config";

const SECRET = "synthetic-oidc-client-secret-0123456789";

const VALID_ENV = {
  OIDC_PROVIDER_ID: "authentik",
  OIDC_CLIENT_ID: "synthetic-client",
  OIDC_CLIENT_SECRET: SECRET,
  OIDC_DISCOVERY_URL: "https://idp.example.test/.well-known/openid-configuration",
  OIDC_DISPLAY_NAME: "Acme SSO",
};

describe("parseOidcConfig (Issue #65)", () => {
  test("no OIDC env: off, no missing keys, and readiness reports off", () => {
    const config = parseOidcConfig({});
    expect(config).toEqual({ provider: null, missingKeys: [] });
    expect(describeOidcIntegration(config)).toEqual({ provider: null, state: "off" });
    expect(oidcSignInOption(config)).toBeNull();
  });

  test("blank values count as unset", () => {
    expect(parseOidcConfig({ OIDC_PROVIDER_ID: "  ", OIDC_CLIENT_ID: "" })).toEqual({
      provider: null,
      missingKeys: [],
    });
  });

  test("an incomplete set stays off and names only the missing keys (never a boot failure)", () => {
    const config = parseOidcConfig({ OIDC_PROVIDER_ID: "authentik", OIDC_CLIENT_SECRET: SECRET });
    expect(config.provider).toBeNull();
    expect(config.missingKeys).toEqual(["OIDC_CLIENT_ID", "OIDC_DISCOVERY_URL"]);
    expect(JSON.stringify(config)).not.toContain(SECRET);
    expect(describeOidcIntegration(config).state).toBe("off");
  });

  test("a full set is configured; status and public option are value-free", () => {
    const config = parseOidcConfig(VALID_ENV);
    expect(config.provider).toEqual({
      providerId: "authentik",
      clientId: "synthetic-client",
      clientSecret: SECRET,
      discoveryUrl: VALID_ENV.OIDC_DISCOVERY_URL,
      displayName: "Acme SSO",
    });
    const status = describeOidcIntegration(config);
    expect(status).toEqual({ provider: "generic", state: "configured" });
    const option = oidcSignInOption(config);
    expect(option).toEqual({ providerId: "authentik", displayName: "Acme SSO" });
    for (const value of [JSON.stringify(status), JSON.stringify(option)]) {
      expect(value).not.toContain(SECRET);
      expect(value).not.toContain("synthetic-client");
      expect(value).not.toContain("idp.example.test");
    }
  });

  test("display name defaults to a neutral label", () => {
    const { OIDC_DISPLAY_NAME: _omit, ...env } = VALID_ENV;
    expect(parseOidcConfig(env).provider?.displayName).toBe("Single sign-on");
  });

  test("http discovery is allowed only on loopback", () => {
    expect(
      parseOidcConfig({
        ...VALID_ENV,
        OIDC_DISCOVERY_URL: "http://127.0.0.1:9000/.well-known/openid-configuration",
      }).provider,
    ).not.toBeNull();
    expect(() =>
      parseOidcConfig({
        ...VALID_ENV,
        OIDC_DISCOVERY_URL: "http://idp.example.test/.well-known/openid-configuration",
      }),
    ).toThrow(OidcConfigError);
  });

  test.each([
    ["OIDC_PROVIDER_ID", "Has Spaces"],
    ["OIDC_PROVIDER_ID", "magic-link"],
    ["OIDC_PROVIDER_ID", "credential"],
    ["OIDC_DISCOVERY_URL", "not a url"],
    ["OIDC_DISCOVERY_URL", "https://user:pw@idp.example.test/.well-known/openid-configuration"],
    ["OIDC_DISPLAY_NAME", "x".repeat(41)],
  ])("rejects malformed %s without echoing the secret", (key, value) => {
    let caught: unknown;
    try {
      parseOidcConfig({ ...VALID_ENV, [key]: value });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OidcConfigError);
    expect((caught as OidcConfigError).code).toBe("OIDC_CONFIG_INVALID");
    expect((caught as Error).message).not.toContain(SECRET);
  });
});
