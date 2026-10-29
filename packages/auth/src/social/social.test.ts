import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";

import type { Database } from "@openvalens/db";
import type { EmailService } from "@openvalens/email";

import { createAuth, createValidateUserInfo } from "../index";
import {
  APPLE_CLIENT_SECRET_TTL_SECONDS,
  createAppleClientSecret,
  createAppleClientSecrets,
  isApplePrivateRelayEmail,
  revokeAppleToken,
} from "../providers/apple";
import {
  normalizePrivateKeyPem,
  parseSocialSignInConfig,
  SocialSignInConfigError,
  socialSignInOptions,
} from "./config";
import { linkEmailAllowed } from "./sign-in";

/** Issue #296 — config parsing, the Apple client secret, and `createAuth` wiring. */

const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PEM = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const APPLE_ENV = {
  APPLE_CLIENT_ID: "com.example.signin",
  APPLE_TEAM_ID: "TEAM123456",
  APPLE_KEY_ID: "KEY1234567",
  APPLE_PRIVATE_KEY: PEM,
};
const GOOGLE_ENV = {
  GOOGLE_CLIENT_ID: "123-abc.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "synthetic-google-secret",
};

function decode(jwt: string) {
  const [header, payload, signature] = jwt.split(".");
  return {
    header: JSON.parse(Buffer.from(header!, "base64url").toString()),
    payload: JSON.parse(Buffer.from(payload!, "base64url").toString()),
    signed: `${header}.${payload}`,
    signature: Buffer.from(signature!, "base64url"),
  };
}

describe("parseSocialSignInConfig", () => {
  test("no env: both providers off, nothing missing", () => {
    expect(parseSocialSignInConfig({})).toEqual({ google: null, apple: null, missingKeys: [] });
  });

  test("a partial set stays off and names the missing keys only", () => {
    const config = parseSocialSignInConfig({
      GOOGLE_CLIENT_ID: GOOGLE_ENV.GOOGLE_CLIENT_ID,
      APPLE_TEAM_ID: "TEAM123456",
    });
    expect(config.google).toBeNull();
    expect(config.apple).toBeNull();
    expect(config.missingKeys).toEqual([
      "GOOGLE_CLIENT_SECRET",
      "APPLE_CLIENT_ID",
      "APPLE_KEY_ID",
      "APPLE_PRIVATE_KEY",
    ]);
  });

  test("full sets enable each provider; the bundle ID is optional", () => {
    const config = parseSocialSignInConfig({ ...GOOGLE_ENV, ...APPLE_ENV });
    expect(config.google).toEqual({
      clientId: GOOGLE_ENV.GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_ENV.GOOGLE_CLIENT_SECRET,
    });
    expect(config.apple?.appBundleId).toBeNull();
    expect(socialSignInOptions(config)).toEqual({ google: true, apple: true, appleNative: false });
    const native = parseSocialSignInConfig({
      ...APPLE_ENV,
      APPLE_APP_BUNDLE_ID: "com.example.app",
    });
    expect(socialSignInOptions(native)).toEqual({ google: false, apple: true, appleNative: true });
  });

  test("a one-line PEM with \\n escapes is accepted", () => {
    const oneLine = PEM.trim().replaceAll("\n", "\\n");
    const config = parseSocialSignInConfig({ ...APPLE_ENV, APPLE_PRIVATE_KEY: oneLine });
    expect(config.apple?.privateKey).toBe(normalizePrivateKeyPem(PEM));
  });

  test("malformed values fail with key names only, never the value", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    let error: unknown;
    try {
      parseSocialSignInConfig({
        GOOGLE_CLIENT_ID: "not-a-client-id",
        GOOGLE_CLIENT_SECRET: "x",
        ...APPLE_ENV,
        APPLE_TEAM_ID: "short",
        APPLE_PRIVATE_KEY: rsa,
        APPLE_APP_BUNDLE_ID: APPLE_ENV.APPLE_CLIENT_ID,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SocialSignInConfigError);
    const message = (error as Error).message;
    expect(message).toContain("GOOGLE_CLIENT_ID");
    expect(message).toContain("APPLE_TEAM_ID");
    expect(message).toContain("APPLE_PRIVATE_KEY");
    expect(message).toContain("APPLE_APP_BUNDLE_ID");
    expect(message).not.toContain("PRIVATE KEY-----");
    expect(message).not.toContain("not-a-client-id");
  });
});

describe("Apple client secret", () => {
  test("is an ES256 JWT for the given client, signed by the key, within 6 months", () => {
    const issuedAt = 1_800_000_000;
    const jwt = createAppleClientSecret({
      teamId: "TEAM123456",
      keyId: "KEY1234567",
      clientId: "com.example.signin",
      privateKey: PEM,
      issuedAt,
    });
    const { header, payload, signed, signature } = decode(jwt);
    expect(header).toEqual({ alg: "ES256", kid: "KEY1234567", typ: "JWT" });
    expect(payload).toEqual({
      iss: "TEAM123456",
      iat: issuedAt,
      exp: issuedAt + APPLE_CLIENT_SECRET_TTL_SECONDS,
      aud: "https://appleid.apple.com",
      sub: "com.example.signin",
    });
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(15_777_000);
    expect(signature).toHaveLength(64);
    expect(
      verify(
        "sha256",
        Buffer.from(signed),
        { key: keys.publicKey, dsaEncoding: "ieee-p1363" },
        signature,
      ),
    ).toBe(true);
  });

  test("never exceeds Apple's 6-month limit", () => {
    const jwt = createAppleClientSecret({
      teamId: "TEAM123456",
      keyId: "KEY1234567",
      clientId: "c.d",
      privateKey: PEM,
      issuedAt: 0,
      ttlSeconds: 365 * 24 * 3600,
    });
    expect(decode(jwt).payload.exp).toBe(15_777_000);
  });

  test("is cached per client and minted again before it expires", () => {
    let now = 1_800_000_000;
    const secrets = createAppleClientSecrets(
      { teamId: "TEAM123456", keyId: "KEY1234567", privateKey: PEM },
      () => now,
    );
    const first = secrets.forClient("com.example.signin");
    expect(secrets.forClient("com.example.signin")).toBe(first);
    expect(decode(secrets.forClient("com.example.app")).payload.sub).toBe("com.example.app");
    now += 16 * 24 * 3600;
    const rotated = secrets.forClient("com.example.signin");
    expect(rotated).not.toBe(first);
    expect(decode(rotated).payload.exp).toBeGreaterThan(now);
  });

  test("revoke tries the Services ID, then the bundle ID", async () => {
    const calls: string[] = [];
    const fetch = async (_url: string, init?: RequestInit) => {
      const clientId = new URLSearchParams(String(init?.body)).get("client_id")!;
      calls.push(clientId);
      return new Response(null, { status: clientId === "com.example.app" ? 200 : 400 });
    };
    const config = {
      clientId: "com.example.signin",
      teamId: "TEAM123456",
      keyId: "KEY1234567",
      privateKey: PEM,
      appBundleId: "com.example.app",
    };
    const ok = await revokeAppleToken({
      config,
      secrets: createAppleClientSecrets(config),
      token: "t",
      tokenTypeHint: "refresh_token",
      fetch,
    });
    expect(ok).toBe(true);
    expect(calls).toEqual(["com.example.signin", "com.example.app"]);
  });
});

describe("explicit-link email rule", () => {
  test("same email, or Apple's private relay only", () => {
    expect(linkEmailAllowed("google", "A@example.test", "a@example.test")).toBe(true);
    expect(linkEmailAllowed("google", "b@example.test", "a@example.test")).toBe(false);
    expect(linkEmailAllowed("google", "x@privaterelay.appleid.com", "a@example.test")).toBe(false);
    expect(linkEmailAllowed("apple", "x@privaterelay.appleid.com", "a@example.test")).toBe(true);
    expect(linkEmailAllowed("apple", "b@example.test", "a@example.test")).toBe(false);
    expect(linkEmailAllowed("apple", undefined, "a@example.test")).toBe(false);
    expect(isApplePrivateRelayEmail("X@PrivateRelay.AppleID.com")).toBe(true);
  });

  test("validateUserInfo: configured providers sign in or link; creation always refused", async () => {
    const source = (action: string, providerId: string) => ({
      user: { id: "u1", email: "a@example.test" },
      source: { action, method: "oauth", oauth: { providerId } },
    });
    const validate = createValidateUserInfo(["google", "apple"], async () => "a@example.test");
    expect(validate(source("sign-in", "google"))).toBeUndefined();
    expect(validate(source("create-user", "google"))).toEqual({
      error: "registration_not_allowed",
    });
    expect(validate(source("sign-in", "github"))).toEqual({ error: "registration_not_allowed" });
    expect(await validate(source("link-account", "apple"))).toBeUndefined();
    const other = createValidateUserInfo(["google"], async () => "someone@example.test");
    expect(await other(source("link-account", "google"))).toEqual({
      error: "email_does_not_match",
    });
  });
});

describe("createAuth social wiring", () => {
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
  type Options = {
    socialProviders: Record<string, { clientSecret?: string }>;
    plugins: Array<{ id: string }>;
    account: { accountLinking: Record<string, unknown> };
  };

  test("no social config: no providers, Better Auth defaults unchanged", () => {
    const options = createAuth(ENV, {} as Database, { email }).options as unknown as Options;
    expect(Object.keys(options.socialProviders)).toEqual([]);
    expect(options.account.accountLinking).toMatchObject({
      disableImplicitLinking: true,
      allowDifferentEmails: false,
      allowUnlinkingAll: true,
    });
  });

  test("configured: providers registered, client secret is a fresh JWT, email rule moved", () => {
    const config = parseSocialSignInConfig({
      ...GOOGLE_ENV,
      ...APPLE_ENV,
      APPLE_APP_BUNDLE_ID: "com.example.app",
    });
    const options = createAuth(ENV, {} as Database, {
      email,
      social: { config, signUp: null },
      emailSignInAvailable: false,
    }).options as unknown as Options;
    expect(Object.keys(options.socialProviders).sort()).toEqual(["apple", "google"]);
    const secret = options.socialProviders.apple!.clientSecret!;
    expect(decode(secret).payload.sub).toBe("com.example.signin");
    expect(options.plugins.map((plugin) => plugin.id)).toContain("openvalens-social-sign-in");
    expect(options.account.accountLinking).toMatchObject({
      disableImplicitLinking: true,
      allowDifferentEmails: true,
      allowUnlinkingAll: false,
    });
  });
});
