import { describe, expect, test } from "bun:test";
import type { Database } from "@openvalens/db";
import type { EmailService } from "@openvalens/email";

import { createAuth, createValidateUserInfo } from "./index";

/**
 * Issue #65 — OIDC wiring in {@link createAuth}, introspected from the real
 * Better Auth options (no network, inert database).
 */

const ENV = {
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "s".repeat(32),
  CORS_ORIGIN: "http://localhost:3000",
  NODE_ENV: "test",
};

const email: EmailService = {
  organizationName: "OpenValens",
  sendEmail: async () => ({ id: "msg-1", dryRun: true }),
};

const OIDC = {
  providerId: "authentik",
  clientId: "client",
  clientSecret: "synthetic-secret",
  discoveryUrl: "https://idp.example.test/.well-known/openid-configuration",
  displayName: "Acme SSO",
};

type Options = {
  plugins: Array<{ id: string }>;
  account?: {
    encryptOAuthTokens?: boolean;
    accountLinking?: Record<string, unknown>;
  };
};

const source = (action: string, providerId = "authentik", method = "oauth") => ({
  user: {},
  source: { action, method, oauth: { providerId } },
});

describe("createValidateUserInfo (Issue #65)", () => {
  test("creation is rejected even for the configured OIDC provider", () => {
    expect(createValidateUserInfo("authentik")(source("create-user"))).toEqual({
      error: "registration_not_allowed",
    });
  });

  test("the configured provider may sign in or explicitly link", () => {
    const validate = createValidateUserInfo("authentik");
    expect(validate(source("sign-in"))).toBeUndefined();
    expect(validate(source("link-account"))).toBeUndefined();
  });

  test("any other provider, method, or OIDC off is rejected", () => {
    expect(createValidateUserInfo("authentik")(source("sign-in", "github"))).toEqual({
      error: "registration_not_allowed",
    });
    expect(createValidateUserInfo("authentik")(source("sign-in", "authentik", "siwe"))).toEqual({
      error: "registration_not_allowed",
    });
    expect(createValidateUserInfo(null)(source("sign-in"))).toEqual({
      error: "registration_not_allowed",
    });
    expect(createValidateUserInfo("authentik")()).toEqual({ error: "registration_not_allowed" });
  });
});

describe("createAuth OIDC wiring (Issue #65)", () => {
  test("no OIDC config: no generic OAuth plugin", () => {
    const auth = createAuth(ENV, {} as Database, { email });
    const options = auth.options as unknown as Options;
    expect(options.plugins.map((plugin) => plugin.id)).not.toContain("generic-oauth");
  });

  test("OIDC config: plugin registered, implicit linking off, tokens encrypted", () => {
    const auth = createAuth(ENV, {} as Database, { email, oidc: OIDC });
    const options = auth.options as unknown as Options;
    expect(options.plugins.map((plugin) => plugin.id)).toContain("generic-oauth");
    expect(options.account?.encryptOAuthTokens).toBe(true);
    expect(options.account?.accountLinking).toMatchObject({
      enabled: true,
      disableImplicitLinking: true,
      allowDifferentEmails: false,
      trustedProviders: ["authentik"],
    });
  });
});
