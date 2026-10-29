import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { readdir } from "node:fs/promises";

import { createDb, sql, type Database } from "@openvalens/db";
import type { EmailService, SendEmailInput } from "@openvalens/email";

import { createAdmissionService, createSocialSignUpService } from "./admission";
import type { DeploymentConfig } from "./deployment";
import { createAuth } from "./index";
import { betterAuthTokenDecrypter, createSocialTokenRevocation } from "./social";
import type { SocialSignInConfig } from "./social/config";

/**
 * Issue #296 — Sign in with Google and Apple over the real Better Auth HTTP
 * boundary (`auth.handler`) and a disposable PostgreSQL. Google's and Apple's
 * endpoints (authorize, token, JWKS, revoke) are played by an in-process mock
 * behind `fetch`; no network, no real credentials. The Apple client secret is
 * signed with a throwaway P-256 key and verified by the mock token endpoint.
 *
 * Proves, on self-host: an unknown identity is refused and nothing is
 * provisioned; a matching email never links implicitly; an explicit signed-in
 * link binds by subject (Apple's private relay address allowed); Apple's
 * first-sign-in name is kept; native Apple id tokens need a server nonce. In
 * Cloud: a new identity with the terms ticked creates an account (own
 * workspace, legal acceptance, `onAccountCreated`) through the admission core,
 * and without the tick nothing is created. Account deletion revokes the Apple
 * token. Nothing the providers issued reaches the logs.
 */

const url = process.env.SOCIAL_AUTH_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/social_auth_test"
  ) {
    throw new Error("Empty disposable loopback social_auth_test database required.");
  }
}

const BASE = "http://localhost:3000";
const ENV = {
  BETTER_AUTH_URL: BASE,
  BETTER_AUTH_SECRET: "s".repeat(32),
  CORS_ORIGIN: BASE,
  NODE_ENV: "test",
};
const CLOUD: DeploymentConfig = {
  mode: "cloud",
  legal: {
    terms: { url: "https://legal.test/terms", version: "terms-2026-11" },
    privacy: { url: "https://legal.test/privacy", version: "privacy-2026-11" },
    healthDataConsent: { url: "https://legal.test/privacy", version: "health-consent-2026-11" },
  },
};
const HEALTH_CONSENT_VERSION = "health-consent-2026-11";
const acceptedSocialConsent = {
  acceptLegal: true,
  acceptedHealthDataConsent: true,
  healthDataConsentVersion: HEALTH_CONSENT_VERSION,
};

const GOOGLE_CLIENT_ID = "synthetic-client.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = "synthetic-google-client-secret-0123456789";
const APPLE_SERVICES_ID = "com.openvalens.test.signin";
const APPLE_BUNDLE_ID = "com.openvalens.test";
const APPLE_TEAM_ID = "TEAM123456";
const APPLE_KEY_ID = "KEY1234567";
const appleKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const APPLE_PRIVATE_KEY = appleKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const SOCIAL: SocialSignInConfig = {
  google: { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET },
  apple: {
    clientId: APPLE_SERVICES_ID,
    teamId: APPLE_TEAM_ID,
    keyId: APPLE_KEY_ID,
    privateKey: APPLE_PRIVATE_KEY,
    appBundleId: APPLE_BUNDLE_ID,
  },
  missingKeys: [],
};

// ─── Mock Google and Apple ───────────────────────────────────────

type Identity = { sub: string; email: string; emailVerified?: boolean; private?: boolean };
type Pending = { identity: Identity; challenge: string | null; redirectUri: string | null };

const b64 = (input: ArrayBuffer | Uint8Array | string): string =>
  Buffer.from(typeof input === "string" ? input : new Uint8Array(input)).toString("base64url");

async function sha256(value: string, encoding: "hex" | "base64url"): Promise<string> {
  const digest = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return digest.toString(encoding);
}

class MockProviders {
  readonly issued: string[] = [];
  readonly revoked: Array<{ token: string; clientId: string }> = [];
  readonly appleClientSecrets: string[] = [];
  private readonly codes = new Map<string, Pending & { provider: "google" | "apple" }>();
  private keys: CryptoKeyPair | null = null;
  private jwks: Record<string, unknown>[] = [];
  private appleVerifyKey: CryptoKey | null = null;
  private realFetch: typeof fetch | null = null;

  async start(): Promise<void> {
    this.keys = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", this.keys.publicKey);
    this.jwks = [
      { ...jwk, kid: "google-k1", alg: "RS256", use: "sig" },
      { ...jwk, kid: "apple-k1", alg: "RS256", use: "sig" },
    ];
    this.appleVerifyKey = await crypto.subtle.importKey(
      "jwk",
      appleKey.publicKey.export({ format: "jwk" }) as never,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    this.realFetch = globalThis.fetch;
    const real = this.realFetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input instanceof URL ? input.href : (input as string), init);
      const host = new URL(request.url).hostname;
      if (["oauth2.googleapis.com", "www.googleapis.com", "appleid.apple.com"].includes(host)) {
        return this.handle(request);
      }
      return real(input, init);
    }) as typeof fetch;
  }

  stop(): void {
    if (this.realFetch) globalThis.fetch = this.realFetch;
  }

  /** Plays the browser at the provider: returns the callback for this identity. */
  authorize(
    authorizationUrl: string,
    identity: Identity,
    user?: object,
  ): { url: string; form?: URLSearchParams } {
    const parsed = new URL(authorizationUrl);
    const provider = parsed.hostname === "appleid.apple.com" ? "apple" : "google";
    expect(parsed.searchParams.get("client_id")).toBe(
      provider === "apple" ? APPLE_SERVICES_ID : GOOGLE_CLIENT_ID,
    );
    const redirectUri = parsed.searchParams.get("redirect_uri")!;
    const code = b64(crypto.getRandomValues(new Uint8Array(24)));
    this.codes.set(code, {
      provider,
      identity,
      challenge: parsed.searchParams.get("code_challenge"),
      redirectUri,
    });
    this.issued.push(code);
    const state = parsed.searchParams.get("state")!;
    if (provider === "apple") {
      // `response_mode=form_post`: Apple POSTs the code (and, the first
      // time, the user's name) back.
      expect(parsed.searchParams.get("response_mode")).toBe("form_post");
      const form = new URLSearchParams({ code, state });
      if (user) form.set("user", JSON.stringify(user));
      return { url: redirectUri, form };
    }
    const callback = new URL(redirectUri);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", state);
    return { url: callback.toString() };
  }

  /** A code the native sheet would hand the app (belongs to the bundle ID). */
  nativeCode(identity: Identity): string {
    const code = b64(crypto.getRandomValues(new Uint8Array(24)));
    this.codes.set(code, { provider: "apple", identity, challenge: null, redirectUri: null });
    this.issued.push(code);
    return code;
  }

  async idToken(
    provider: "google" | "apple",
    identity: Identity,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: provider === "apple" ? "https://appleid.apple.com" : "https://accounts.google.com",
      aud: provider === "apple" ? APPLE_SERVICES_ID : GOOGLE_CLIENT_ID,
      sub: identity.sub,
      email: identity.email,
      email_verified: provider === "apple" ? "true" : (identity.emailVerified ?? true),
      ...(identity.private ? { is_private_email: "true" } : {}),
      iat: now,
      exp: now + 600,
      ...extra,
    };
    const header = b64(
      JSON.stringify({ alg: "RS256", kid: provider === "apple" ? "apple-k1" : "google-k1" }),
    );
    const payload = b64(JSON.stringify(claims));
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      this.keys!.privateKey,
      new TextEncoder().encode(`${header}.${payload}`),
    );
    const token = `${header}.${payload}.${b64(signature)}`;
    this.issued.push(token);
    return token;
  }

  /** Verifies an Apple client secret: ES256 with the operator key, right claims. */
  private async appleClientOk(form: URLSearchParams): Promise<boolean> {
    const clientId = form.get("client_id") ?? "";
    const secret = form.get("client_secret") ?? "";
    this.appleClientSecrets.push(secret);
    const [header, payload, signature] = secret.split(".");
    if (!header || !payload || !signature) return false;
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      this.appleVerifyKey!,
      Buffer.from(signature, "base64url"),
      new TextEncoder().encode(`${header}.${payload}`),
    );
    const head = JSON.parse(Buffer.from(header, "base64url").toString());
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const now = Math.floor(Date.now() / 1000);
    return (
      valid &&
      head.alg === "ES256" &&
      head.kid === APPLE_KEY_ID &&
      claims.iss === APPLE_TEAM_ID &&
      claims.aud === "https://appleid.apple.com" &&
      claims.sub === clientId &&
      claims.exp > now &&
      claims.exp - claims.iat <= 15_777_000 &&
      [APPLE_SERVICES_ID, APPLE_BUNDLE_ID].includes(clientId)
    );
  }

  private async handle(request: Request): Promise<Response> {
    const target = new URL(request.url);
    if (target.pathname === "/oauth2/v3/certs" || target.pathname === "/auth/keys") {
      return Response.json({ keys: this.jwks });
    }
    const form = new URLSearchParams(await request.text());
    if (target.pathname === "/auth/revoke") {
      if (!(await this.appleClientOk(form))) {
        return Response.json({ error: "invalid_client" }, { status: 400 });
      }
      this.revoked.push({ token: form.get("token")!, clientId: form.get("client_id")! });
      return new Response(null, { status: 200 });
    }
    if (target.pathname === "/token" || target.pathname === "/auth/token") {
      const pending = this.codes.get(form.get("code") ?? "");
      this.codes.delete(form.get("code") ?? "");
      if (!pending) return Response.json({ error: "invalid_grant" }, { status: 400 });
      if (pending.provider === "google") {
        if (
          form.get("client_id") !== GOOGLE_CLIENT_ID ||
          form.get("client_secret") !== GOOGLE_CLIENT_SECRET ||
          form.get("redirect_uri") !== pending.redirectUri
        ) {
          return Response.json({ error: "invalid_client" }, { status: 400 });
        }
      } else if (!(await this.appleClientOk(form))) {
        return Response.json({ error: "invalid_client" }, { status: 400 });
      }
      if (pending.challenge) {
        const verifier = await sha256(form.get("code_verifier") ?? "", "base64url");
        if (verifier !== pending.challenge) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
      }
      const accessToken = b64(crypto.getRandomValues(new Uint8Array(24)));
      const refreshToken = b64(crypto.getRandomValues(new Uint8Array(24)));
      this.issued.push(accessToken, refreshToken);
      const audience =
        pending.provider === "apple" && pending.redirectUri === null
          ? { aud: APPLE_BUNDLE_ID }
          : {};
      return Response.json({
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: "Bearer",
        expires_in: 3600,
        id_token: await this.idToken(pending.provider, pending.identity, audience),
      });
    }
    return new Response("not found", { status: 404 });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

async function migrate(db: Database): Promise<void> {
  const root = new URL("../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

function cookiePairs(response: Response): string[] {
  return (response.headers.getSetCookie?.() ?? [])
    .map((cookie) => cookie.split(";")[0]!)
    .filter((pair) => pair.slice(pair.indexOf("=") + 1).length > 0);
}

function sessionCookie(response: Response): string | null {
  return cookiePairs(response).find((pair) => pair.includes("session_token")) ?? null;
}

const providers = new MockProviders();
if (url) await providers.start();

describe.skipIf(!url)("Google and Apple sign-in against mock providers and PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/social_auth_test" });
  const sent: SendEmailInput[] = [];
  const email: EmailService = {
    organizationName: "OpenValens",
    sendEmail: async (input) => {
      sent.push(input);
      return { id: "msg-1", dryRun: false };
    },
  };

  const selfHosted = createAuth(ENV, db, { email, social: { config: SOCIAL, signUp: null } });

  const created: Array<{ userId: string; organizationId: string }> = [];
  const socialSignUp = createSocialSignUpService({
    db,
    deployment: CLOUD,
    onAccountCreated: async ({ tx, userId, organizationId }) => {
      const seen = await tx.execute(sql`select 1 from "user" where "id" = ${userId}`);
      expect(seen.rows).toHaveLength(1);
      created.push({ userId, organizationId });
    },
  });
  const cloud = createAuth(ENV, db, { email, social: { config: SOCIAL, signUp: socialSignUp } });

  const proofs: Array<{ email: string; code: string }> = [];
  const admission = createAdmissionService({
    db,
    deliverVerification: async ({ email: to, verificationCode }) => {
      proofs.push({ email: to, code: verificationCode });
    },
    deliverInvitation: async () => {},
  });

  const captured: string[] = [];
  const restore: Array<() => void> = [];

  const countUsers = async () =>
    Number(
      ((await db.execute(sql`select count(*)::int as n from "user"`)).rows[0] as { n: number }).n,
    );
  const userIdByEmail = async (address: string) =>
    (
      (await db.execute(sql`select id from "user" where email = ${address}`)).rows[0] as
        | { id: string }
        | undefined
    )?.id;
  const accounts = async (provider: string, userId?: string) =>
    (
      await db.execute(
        userId
          ? sql`select account_id, user_id, refresh_token from account where provider_id = ${provider} and user_id = ${userId}`
          : sql`select account_id, user_id, refresh_token from account where provider_id = ${provider}`,
      )
    ).rows as Array<{ account_id: string; user_id: string; refresh_token: string | null }>;

  type Auth = typeof selfHosted;

  async function magicLinkSignIn(auth: Auth, address: string): Promise<string> {
    await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: address }),
      }),
    );
    const message = [...sent].reverse().find((entry) => entry.to === address);
    const token = message?.html?.match(/magic-link\/verify\?token=([^"'&]+)/)?.[1];
    if (!token) throw new Error("no magic link token captured");
    const verify = await auth.handler(
      new Request(`${BASE}/api/auth/magic-link/verify?token=${token}`),
    );
    const cookie = sessionCookie(verify);
    if (!cookie) throw new Error("no session cookie issued");
    return cookie;
  }

  async function createLocalAccount(address: string): Promise<string> {
    const minted = await admission.mintSetupToken().catch(() => null);
    if (minted) {
      const { enrollmentId } = await admission.begin({
        kind: "setup",
        credential: minted.token,
        email: address,
      });
      await admission.complete(
        { enrollmentId, credential: minted.token, verificationCode: proofs.at(-1)!.code },
        null,
      );
    } else {
      const id = crypto.randomUUID();
      await db.execute(
        sql`insert into "user" ("id", "email", "email_verified", "role", "banned", "created_at", "updated_at") values (${id}, ${address}, true, 'user', false, now(), now())`,
      );
    }
    return (await userIdByEmail(address))!;
  }

  /** Runs a redirect flow (sign-in or link) and returns the final redirect. */
  async function roundTrip(
    auth: Auth,
    provider: "google" | "apple",
    identity: Identity,
    options: { linkWithCookie?: string; additionalData?: object; user?: object } = {},
  ): Promise<{ location: URL; cookie: string | null }> {
    const start = await auth.handler(
      new Request(`${BASE}/api/auth/${options.linkWithCookie ? "link-social" : "sign-in/social"}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.linkWithCookie ? { cookie: options.linkWithCookie } : {}),
        },
        body: JSON.stringify({
          provider,
          callbackURL: `${BASE}/dashboard`,
          errorCallbackURL: `${BASE}/login`,
          ...(options.additionalData ? { additionalData: options.additionalData } : {}),
        }),
      }),
    );
    expect(start.status).toBe(200);
    const { url: authorizationUrl } = (await start.json()) as { url: string };
    const cookies = [...cookiePairs(start)];
    if (options.linkWithCookie) cookies.push(options.linkWithCookie);
    const back = providers.authorize(authorizationUrl, identity, options.user);
    let callbackUrl = back.url;
    if (back.form) {
      // Apple's form_post; Better Auth turns it into a GET on the callback.
      const posted = await auth.handler(
        new Request(back.url, {
          method: "POST",
          // A browser sends the SameSite=None cookies on Apple's cross-site POST.
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: "https://appleid.apple.com",
            cookie: cookies.join("; "),
          },
          body: back.form.toString(),
        }),
      );
      expect(posted.status).toBe(302);
      callbackUrl = new URL(posted.headers.get("location")!, BASE).toString();
    }
    const callback = await auth.handler(
      new Request(callbackUrl, { headers: { cookie: cookies.join("; ") } }),
    );
    expect(callback.status).toBe(302);
    return {
      location: new URL(callback.headers.get("location")!, BASE),
      cookie: sessionCookie(callback),
    };
  }

  async function nativeNonce(auth: Auth): Promise<string> {
    const response = await auth.handler(
      new Request(`${BASE}/api/auth/social/native-nonce`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { nonce: string }).nonce;
  }

  /** The iOS sheet: an id token for the bundle ID carrying SHA-256(nonce). */
  async function nativeAppleSignIn(
    auth: Auth,
    identity: Identity,
    options: { nonce?: string; tokenNonce?: string; additionalData?: object; user?: object } = {},
  ): Promise<Response> {
    const nonce = options.nonce ?? (await nativeNonce(auth));
    const token = await providers.idToken("apple", identity, {
      aud: APPLE_BUNDLE_ID,
      nonce: options.tokenNonce ?? (await sha256(nonce, "hex")),
    });
    return auth.handler(
      new Request(`${BASE}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({
          provider: "apple",
          idToken: { token, nonce, ...(options.user ? { user: options.user } : {}) },
          ...(options.additionalData ? { additionalData: options.additionalData } : {}),
        }),
      }),
    );
  }

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);

    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      const original = console[method];
      console[method] = (...args: unknown[]) => {
        captured.push(
          args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(" "),
        );
        original(...args);
      };
      restore.push(() => {
        console[method] = original;
      });
    }
    for (const stream of [process.stdout, process.stderr]) {
      const original = stream.write.bind(stream);
      stream.write = ((chunk: unknown, ...rest: unknown[]) => {
        captured.push(String(chunk));
        return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof stream.write;
      restore.push(() => {
        stream.write = original;
      });
    }

    await createLocalAccount("owner@example.test");
  });

  afterAll(() => {
    for (const undo of restore) undo();
    providers.stop();
  });

  // ── Self-host ──────────────────────────────────────────────────

  test("self-host: an unknown Google or Apple identity is refused and nothing is created", async () => {
    const before = await countUsers();
    for (const provider of ["google", "apple"] as const) {
      const { location, cookie } = await roundTrip(selfHosted, provider, {
        sub: `stranger-${provider}`,
        email: `stranger-${provider}@example.test`,
      });
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("error")).toBe("signup_disabled");
      expect(cookie).toBeNull();
    }
    // Even with the terms ticked: self-host never creates an account.
    const ticked = await roundTrip(
      selfHosted,
      "google",
      { sub: "stranger-ticked", email: "ticked@example.test" },
      { additionalData: { acceptLegal: true } },
    );
    expect(ticked.location.searchParams.get("error")).toBe("signup_disabled");
    expect(await countUsers()).toBe(before);
    expect(await accounts("google")).toHaveLength(0);
    expect(await accounts("apple")).toHaveLength(0);
  });

  test("self-host: a matching verified email never links implicitly", async () => {
    const ownerId = (await userIdByEmail("owner@example.test"))!;
    for (const provider of ["google", "apple"] as const) {
      const { location, cookie } = await roundTrip(selfHosted, provider, {
        sub: `owner-lookalike-${provider}`,
        email: "owner@example.test",
      });
      expect(location.searchParams.get("error")).toBe("account_not_linked");
      expect(cookie).toBeNull();
    }
    expect(await accounts("google", ownerId)).toHaveLength(0);
    expect(await accounts("apple", ownerId)).toHaveLength(0);
  });

  test("self-host: explicit Google link by subject; later sign-ins land in the same user", async () => {
    const ownerId = (await userIdByEmail("owner@example.test"))!;
    const ownerCookie = await magicLinkSignIn(selfHosted, "owner@example.test");
    const linked = await roundTrip(
      selfHosted,
      "google",
      { sub: "owner-google-sub", email: "owner@example.test" },
      { linkWithCookie: ownerCookie },
    );
    expect(linked.location.pathname).toBe("/dashboard");
    expect((await accounts("google", ownerId)).map((row) => row.account_id)).toEqual([
      "owner-google-sub",
    ]);

    const later = await roundTrip(selfHosted, "google", {
      sub: "owner-google-sub",
      email: "owner@example.test",
    });
    expect(later.location.pathname).toBe("/dashboard");
    const session = await selfHosted.api.getSession({
      headers: new Headers({ cookie: later.cookie! }),
    });
    expect(session?.user.id).toBe(ownerId);

    // Stored tokens are encrypted at rest.
    const stored = await accounts("google", ownerId);
    for (const secret of providers.issued) expect(stored[0]!.refresh_token).not.toBe(secret);
  });

  test("self-host: a Google link whose email differs from the account is refused", async () => {
    const ownerId = (await userIdByEmail("owner@example.test"))!;
    const ownerCookie = await magicLinkSignIn(selfHosted, "owner@example.test");
    const { location } = await roundTrip(
      selfHosted,
      "google",
      { sub: "owner-other-email", email: "someone-else@example.test" },
      { linkWithCookie: ownerCookie },
    );
    expect(location.searchParams.get("error")).toBe("email_does_not_match");
    expect((await accounts("google", ownerId)).map((row) => row.account_id)).toEqual([
      "owner-google-sub",
    ]);
  });

  test("self-host: an Apple link with a private relay email is allowed and keeps Apple's name", async () => {
    const memberId = await createLocalAccount("member@example.test");
    const memberCookie = await magicLinkSignIn(selfHosted, "member@example.test");
    const relay = "abc123xyz@privaterelay.appleid.com";

    // A different *real* address is still refused.
    const refused = await roundTrip(
      selfHosted,
      "apple",
      { sub: "member-apple-other", email: "other@example.test" },
      { linkWithCookie: memberCookie },
    );
    expect(refused.location.searchParams.get("error")).toBe("email_does_not_match");

    const linked = await roundTrip(
      selfHosted,
      "apple",
      { sub: "member-apple-sub", email: relay, private: true },
      {
        linkWithCookie: memberCookie,
        user: { name: { firstName: "Ana", lastName: "Silva" }, email: relay },
      },
    );
    expect(linked.location.pathname).toBe("/dashboard");
    expect((await accounts("apple", memberId)).map((row) => row.account_id)).toEqual([
      "member-apple-sub",
    ]);
    const name = (await db.execute(sql`select name from "user" where id = ${memberId}`))
      .rows[0] as { name: string };
    expect(name.name).toBe("Ana Silva");

    const signIn = await roundTrip(selfHosted, "apple", {
      sub: "member-apple-sub",
      email: relay,
      private: true,
    });
    expect(signIn.location.pathname).toBe("/dashboard");
    expect(signIn.cookie).not.toBeNull();
  });

  test("native Apple id token needs a single-use server nonce; Google and OIDC id tokens are refused", async () => {
    const google = await selfHosted.handler(
      new Request(`${BASE}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          idToken: { token: await providers.idToken("google", { sub: "x", email: "x@e.test" }) },
        }),
      }),
    );
    expect(google.status).toBe(400);
    expect(sessionCookie(google)).toBeNull();

    const identity = {
      sub: "member-apple-sub",
      email: "abc123xyz@privaterelay.appleid.com",
      private: true,
    };
    // A nonce the server never issued.
    const forged = await nativeAppleSignIn(selfHosted, identity, { nonce: "client-made-nonce" });
    expect(forged.status).toBe(401);
    expect(sessionCookie(forged)).toBeNull();

    // An issued nonce whose hash is not in the token.
    const mismatch = await nativeAppleSignIn(selfHosted, identity, { tokenNonce: "other" });
    expect(mismatch.status).toBe(401);

    // The real thing, then a replay of the same nonce.
    const nonce = await nativeNonce(selfHosted);
    const ok = await nativeAppleSignIn(selfHosted, identity, { nonce });
    expect(ok.status).toBe(200);
    expect(sessionCookie(ok)).not.toBeNull();
    const replay = await nativeAppleSignIn(selfHosted, identity, { nonce });
    expect(replay.status).toBe(401);

    // Unknown identity with a valid nonce: refused, nothing created.
    const before = await countUsers();
    const unknown = await nativeAppleSignIn(selfHosted, {
      sub: "native-stranger",
      email: "native-stranger@example.test",
    });
    expect(unknown.status).toBe(401);
    expect(await countUsers()).toBe(before);
  });

  test("native: the authorization code is exchanged for a revocable, encrypted refresh token", async () => {
    const memberId = (await userIdByEmail("member@example.test"))!;
    const identity = {
      sub: "member-apple-sub",
      email: "abc123xyz@privaterelay.appleid.com",
      private: true,
    };
    const signIn = await nativeAppleSignIn(selfHosted, identity);
    const cookie = sessionCookie(signIn)!;
    const response = await selfHosted.handler(
      new Request(`${BASE}/api/auth/social/apple/native-token`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: BASE },
        body: JSON.stringify({ authorizationCode: providers.nativeCode(identity) }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stored: true });
    const [row] = await accounts("apple", memberId);
    expect(row?.refresh_token).toBeTruthy();
    expect(providers.issued).not.toContain(row!.refresh_token);

    // A code for an Apple ID that is not this user's is not stored.
    const stranger = await selfHosted.handler(
      new Request(`${BASE}/api/auth/social/apple/native-token`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: BASE },
        body: JSON.stringify({
          authorizationCode: providers.nativeCode({ sub: "someone-else", email: "s@e.test" }),
        }),
      }),
    );
    expect(await stranger.json()).toEqual({ stored: false });
  });

  test("account deletion revokes the Apple token with a valid client secret", async () => {
    const memberId = (await userIdByEmail("member@example.test"))!;
    const revocation = createSocialTokenRevocation({
      db,
      apple: SOCIAL.apple,
      decrypt: betterAuthTokenDecrypter(selfHosted),
    });
    const pending = await revocation.collect(memberId);
    expect(pending.apple).toHaveLength(1);
    expect(providers.issued).toContain(pending.apple[0]!.token);
    const result = await revocation.revoke(pending);
    expect(result).toEqual({ revoked: 1, failed: 0 });
    expect(providers.revoked.at(-1)?.token).toBe(pending.apple[0]!.token);
    expect(await (await revocation.collect("no-such-user")).apple).toHaveLength(0);
  });

  // ── Cloud ──────────────────────────────────────────────────────

  test("cloud: without the terms ticked, an unknown identity creates nothing", async () => {
    const before = await countUsers();
    const { location } = await roundTrip(cloud, "google", {
      sub: "cloud-unticked",
      email: "cloud-unticked@example.test",
    });
    expect(location.searchParams.get("error")).toBe("signup_disabled");
    expect(await countUsers()).toBe(before);
  });

  test("cloud: missing or stale health consent creates no account", async () => {
    const before = await countUsers();
    const accountsBefore = (await db.execute(sql`select count(*)::int as count from account`))
      .rows[0] as { count: number };
    const requests: Array<{ tag: string; additionalData: Record<string, unknown> }> = [
      { tag: "missing", additionalData: { acceptLegal: true } },
      {
        tag: "false",
        additionalData: { ...acceptedSocialConsent, acceptedHealthDataConsent: false },
      },
      {
        tag: "stale",
        additionalData: { ...acceptedSocialConsent, healthDataConsentVersion: "old-version" },
      },
    ];
    for (const provider of ["google", "apple"] as const) {
      for (const { tag, additionalData } of requests) {
        const result = await roundTrip(
          cloud,
          provider,
          {
            sub: `consent-required-${before}-${provider}-${tag}`,
            email: `consent-required-${before}-${provider}-${tag}@example.test`,
          },
          { additionalData },
        );
        expect(result.location.searchParams.get("error")).toBe("signup_disabled");
      }
    }
    expect(await countUsers()).toBe(before);
    expect((await db.execute(sql`select count(*)::int as count from account`)).rows[0]).toEqual(
      accountsBefore,
    );
  });

  test("cloud: a new Google identity with the terms ticked gets an account, workspace, legal record and trial hook", async () => {
    const { location, cookie } = await roundTrip(
      cloud,
      "google",
      { sub: "cloud-google-sub", email: "New.Person@Example.test" },
      {
        additionalData: {
          ...acceptedSocialConsent,
          locale: "pt-PT",
          healthDataConsentAcceptedAt: "1900-01-01T00:00:00.000Z",
        },
      },
    );
    expect(location.pathname).toBe("/dashboard");
    expect(cookie).not.toBeNull();
    const userId = (await userIdByEmail("new.person@example.test"))!;
    expect(userId).toBeTruthy();
    const user = (
      await db.execute(sql`select role, email_verified from "user" where id = ${userId}`)
    ).rows[0] as { role: string; email_verified: boolean };
    expect(user).toEqual({ role: "user", email_verified: true });
    const member = (
      await db.execute(sql`select organization_id, role from member where user_id = ${userId}`)
    ).rows as Array<{ organization_id: string; role: string }>;
    expect(member).toHaveLength(1);
    expect(member[0]!.role).toBe("owner");
    const legal = (
      await db.execute(
        sql`select document, version, source from legal_acceptance where user_id = ${userId} order by document`,
      )
    ).rows;
    expect(legal).toEqual([
      { document: "health_data_consent", version: HEALTH_CONSENT_VERSION, source: "sign_up" },
      { document: "privacy", version: "privacy-2026-11", source: "sign_up" },
      { document: "terms", version: "terms-2026-11", source: "sign_up" },
    ]);
    const consentTime = (
      await db.execute(sql`
      select accepted_at from legal_acceptance
      where user_id = ${userId} and document = 'health_data_consent'
    `)
    ).rows[0] as { accepted_at: Date };
    expect(new Date(consentTime.accepted_at).getTime()).toBeGreaterThan(
      new Date("2020-01-01").getTime(),
    );
    expect((await accounts("google", userId)).map((row) => row.account_id)).toEqual([
      "cloud-google-sub",
    ]);
    const locale = (
      await db.execute(sql`select locale from user_preference where user_id = ${userId}`)
    ).rows[0] as { locale: string };
    expect(locale.locale).toBe("pt-PT");
    expect(created).toContainEqual({ userId, organizationId: member[0]!.organization_id });
    const session = await cloud.api.getSession({ headers: new Headers({ cookie: cookie! }) });
    expect(session?.user.id).toBe(userId);

    // Signing up again with the same identity just signs in.
    const before = await countUsers();
    const again = await roundTrip(
      cloud,
      "google",
      { sub: "cloud-google-sub", email: "new.person@example.test" },
      { additionalData: { acceptLegal: true } },
    );
    expect(again.cookie).not.toBeNull();
    expect(await countUsers()).toBe(before);
  });

  test("cloud: a new identity whose email has an account is not linked and creates nothing", async () => {
    const before = await countUsers();
    const ownerId = (await userIdByEmail("owner@example.test"))!;
    const { location, cookie } = await roundTrip(
      cloud,
      "apple",
      { sub: "cloud-owner-apple", email: "owner@example.test" },
      { additionalData: { acceptLegal: true } },
    );
    expect(location.searchParams.get("error")).toBe("account_not_linked");
    expect(cookie).toBeNull();
    expect(await countUsers()).toBe(before);
    expect(await accounts("apple", ownerId)).toHaveLength(0);
  });

  test("cloud: Apple web sign-up stores the first-sign-in name and the relay address", async () => {
    const relay = "web-relay@privaterelay.appleid.com";
    const { cookie } = await roundTrip(
      cloud,
      "apple",
      { sub: "cloud-apple-web", email: relay, private: true },
      {
        additionalData: acceptedSocialConsent,
        user: { name: { firstName: "Rui", lastName: "Costa" }, email: relay },
      },
    );
    expect(cookie).not.toBeNull();
    const user = (await db.execute(sql`select name from "user" where email = ${relay}`))
      .rows[0] as { name: string };
    expect(user.name).toBe("Rui Costa");
  });

  test("cloud: native Apple sign-up with the terms ticked", async () => {
    const response = await nativeAppleSignIn(
      cloud,
      { sub: "cloud-apple-native", email: "native@example.test" },
      {
        additionalData: acceptedSocialConsent,
        user: { name: { firstName: "Inês" } },
      },
    );
    expect(response.status).toBe(200);
    const userId = (await userIdByEmail("native@example.test"))!;
    expect((await accounts("apple", userId)).map((row) => row.account_id)).toEqual([
      "cloud-apple-native",
    ]);
    const user = (await db.execute(sql`select name from "user" where id = ${userId}`)).rows[0] as {
      name: string;
    };
    expect(user.name).toBe("Inês");
  });

  test("no authorization code, provider token, client secret or private key reaches the logs", () => {
    const output = captured.join("\n");
    expect(providers.issued.length).toBeGreaterThan(0);
    expect(providers.appleClientSecrets.length).toBeGreaterThan(0);
    for (const secret of [
      ...providers.issued,
      ...providers.appleClientSecrets,
      GOOGLE_CLIENT_SECRET,
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).not.toContain("PRIVATE KEY");
    expect(output).not.toContain("privaterelay.appleid.com");
    expect(output).not.toContain("owner@example.test");
  });
});
