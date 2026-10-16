import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

import { createDb, sql, type Database } from "@openvalens/db";
import type { EmailService, SendEmailInput } from "@openvalens/email";

import { createAdmissionService } from "./admission";
import { createAuth } from "./index";

/**
 * Issue #65 — generic OIDC sign-in over the real Better Auth HTTP boundary
 * (`auth.handler`), a disposable PostgreSQL and a local mock OIDC issuer (no
 * real IdP, no network beyond loopback). Proves:
 *
 * - an unknown identity is refused and nothing is provisioned;
 * - an identity whose email matches an existing user is NOT linked implicitly;
 * - an invitation accepted through admission, then an explicit signed-in
 *   binding, stores `iss` + `sub`, and later OIDC sign-ins land in the same
 *   user and organization;
 * - a client-submitted ID token is refused;
 * - nothing the IdP issued (codes, tokens, client secret) reaches the logs.
 */

const url = process.env.OIDC_AUTH_TEST_DATABASE_URL;

function assertDisposable(candidate: string | undefined, database: string): void {
  if (!candidate) return;
  const parsed = new URL(candidate);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== `/${database}`)
    throw new Error(`Empty disposable loopback ${database} database required.`);
}
assertDisposable(url, "oidc_auth_test");

const BASE = "http://localhost:3000";
const ENV = {
  BETTER_AUTH_URL: BASE,
  BETTER_AUTH_SECRET: "s".repeat(32),
  CORS_ORIGIN: BASE,
  NODE_ENV: "test",
};
const PROVIDER_ID = "mock-idp";
const CLIENT_ID = "openvalens-test-client";
const CLIENT_SECRET = "synthetic-oidc-client-secret-0123456789";

// ─── Mock OIDC issuer ────────────────────────────────────────────

type Identity = { sub: string; email: string; emailVerified?: boolean };
type PendingCode = {
  identity: Identity;
  nonce: string | null;
  challenge: string | null;
  redirectUri: string;
};

const base64url = (input: ArrayBuffer | Uint8Array | string): string =>
  Buffer.from(typeof input === "string" ? input : new Uint8Array(input)).toString("base64url");

class MockIssuer {
  readonly issued: string[] = [];
  private readonly codes = new Map<string, PendingCode>();
  private server: ReturnType<typeof Bun.serve> | null = null;
  private keys: CryptoKeyPair | null = null;
  private jwk: Record<string, unknown> | null = null;

  get issuer(): string {
    // Placeholder while the suite is skipped (no database configured).
    return `http://127.0.0.1:${this.server?.port ?? 9}`;
  }

  get discoveryUrl(): string {
    return `${this.issuer}/.well-known/openid-configuration`;
  }

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
    this.jwk = {
      ...(await crypto.subtle.exportKey("jwk", this.keys.publicKey)),
      kid: "k1",
      alg: "RS256",
      use: "sig",
    };
    this.server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => this.handle(req) });
  }

  stop(): void {
    this.server?.stop(true);
  }

  /**
   * Plays the user's browser at the IdP: accepts the authorization URL Better
   * Auth produced and returns the callback URL with a fresh code.
   */
  authorize(authorizationUrl: string, identity: Identity): string {
    const parsed = new URL(authorizationUrl);
    expect(parsed.origin).toBe(this.issuer);
    expect(parsed.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("scope")?.split(" ")).toContain("openid");
    const redirectUri = parsed.searchParams.get("redirect_uri")!;
    const code = base64url(crypto.getRandomValues(new Uint8Array(24)));
    this.codes.set(code, {
      identity,
      nonce: parsed.searchParams.get("nonce"),
      challenge: parsed.searchParams.get("code_challenge"),
      redirectUri,
    });
    this.issued.push(code);
    const callback = new URL(redirectUri);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", parsed.searchParams.get("state")!);
    return callback.toString();
  }

  private async sign(claims: Record<string, unknown>): Promise<string> {
    const header = base64url(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
    const payload = base64url(JSON.stringify(claims));
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      this.keys!.privateKey,
      new TextEncoder().encode(`${header}.${payload}`),
    );
    return `${header}.${payload}.${base64url(signature)}`;
  }

  private async handle(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === "/.well-known/openid-configuration") {
      return Response.json({
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        userinfo_endpoint: `${this.issuer}/userinfo`,
        jwks_uri: `${this.issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (path === "/jwks") {
      return Response.json({ keys: [this.jwk] });
    }
    if (path === "/token" && req.method === "POST") {
      const form = new URLSearchParams(await req.text());
      const pending = this.codes.get(form.get("code") ?? "");
      this.codes.delete(form.get("code") ?? "");
      if (
        !pending ||
        form.get("client_id") !== CLIENT_ID ||
        form.get("client_secret") !== CLIENT_SECRET ||
        form.get("redirect_uri") !== pending.redirectUri
      ) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(form.get("code_verifier") ?? ""),
      );
      if (base64url(digest) !== pending.challenge) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      const now = Math.floor(Date.now() / 1000);
      const idToken = await this.sign({
        iss: this.issuer,
        aud: CLIENT_ID,
        sub: pending.identity.sub,
        email: pending.identity.email,
        email_verified: pending.identity.emailVerified ?? true,
        iat: now,
        exp: now + 300,
        ...(pending.nonce ? { nonce: pending.nonce } : {}),
      });
      const accessToken = base64url(crypto.getRandomValues(new Uint8Array(24)));
      this.issued.push(idToken, accessToken);
      return Response.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 300,
        id_token: idToken,
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

const issuer = new MockIssuer();
if (url) await issuer.start();

describe.skipIf(!url)(
  "generic OIDC sign-in against a mock issuer and disposable PostgreSQL",
  () => {
    const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/oidc_auth_test" });
    const sent: SendEmailInput[] = [];
    const email: EmailService = {
      organizationName: "OpenValens",
      sendEmail: async (input) => {
        sent.push(input);
        return { id: "msg-1", dryRun: false };
      },
    };
    const auth = createAuth(ENV, db, {
      email,
      oidc: {
        providerId: PROVIDER_ID,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        discoveryUrl: issuer.discoveryUrl,
        displayName: "Mock IdP",
      },
    });

    const proofs: Array<{ email: string; code: string }> = [];
    const invitations: Array<{ email: string; token: string }> = [];
    const admission = createAdmissionService({
      db,
      deliverVerification: async ({ email: to, verificationCode }) => {
        proofs.push({ email: to, code: verificationCode });
      },
      deliverInvitation: async ({ email: to, invitationToken }) => {
        invitations.push({ email: to, token: invitationToken });
      },
    });

    // Everything written to the console/stdio while the suite runs.
    const captured: string[] = [];
    const restore: Array<() => void> = [];

    const countUsers = async () =>
      Number(
        ((await db.execute(sql`select count(*)::int as n from "user"`)).rows[0] as { n: number }).n,
      );
    const accountsFor = async (userId: string) =>
      (
        await db.execute(
          sql`select provider_id, account_id from account where user_id = ${userId} and provider_id = ${PROVIDER_ID}`,
        )
      ).rows as Array<{ provider_id: string; account_id: string }>;
    const userIdByEmail = async (address: string) =>
      (
        (await db.execute(sql`select id from "user" where email = ${address}`)).rows[0] as
          | { id: string }
          | undefined
      )?.id;

    async function magicLinkSignIn(address: string): Promise<string> {
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

    /** Starts an OIDC redirect flow (sign-in or link) and returns the callback outcome. */
    async function oidcRoundTrip(
      identity: Identity,
      options: { linkWithCookie?: string } = {},
    ): Promise<{ location: URL; cookie: string | null }> {
      const start = await auth.handler(
        new Request(
          `${BASE}/api/auth/${options.linkWithCookie ? "link-social" : "sign-in/social"}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(options.linkWithCookie ? { cookie: options.linkWithCookie } : {}),
            },
            body: JSON.stringify({
              provider: PROVIDER_ID,
              callbackURL: `${BASE}/dashboard`,
              errorCallbackURL: `${BASE}/login`,
            }),
          },
        ),
      );
      expect(start.status).toBe(200);
      const { url: authorizationUrl } = (await start.json()) as { url: string };
      const callbackUrl = issuer.authorize(authorizationUrl, identity);
      const cookies = [...cookiePairs(start)];
      if (options.linkWithCookie) cookies.push(options.linkWithCookie);
      const callback = await auth.handler(
        new Request(callbackUrl, { headers: { cookie: cookies.join("; ") } }),
      );
      expect(callback.status).toBe(302);
      return {
        location: new URL(callback.headers.get("location")!, BASE),
        cookie: sessionCookie(callback),
      };
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

      // The first administrator is always a local account (setup token).
      const minted = await admission.mintSetupToken();
      const { enrollmentId } = await admission.begin({
        kind: "setup",
        credential: minted.token,
        email: "owner@example.test",
      });
      await admission.complete(
        { enrollmentId, credential: minted.token, verificationCode: proofs.at(-1)!.code },
        null,
      );
    });

    afterAll(() => {
      for (const undo of restore) undo();
      issuer.stop();
    });

    test("an unknown OIDC identity is refused and nothing is provisioned", async () => {
      const usersBefore = await countUsers();
      const { location, cookie } = await oidcRoundTrip({
        sub: "stranger-sub",
        email: "stranger@example.test",
      });
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("error")).toBe("signup_disabled");
      expect(cookie).toBeNull();
      expect(await countUsers()).toBe(usersBefore);
      const accounts = await db.execute(
        sql`select 1 from account where provider_id = ${PROVIDER_ID}`,
      );
      expect(accounts.rows).toHaveLength(0);
    });

    test("an identity whose verified email matches an existing user is not linked implicitly", async () => {
      const ownerId = (await userIdByEmail("owner@example.test"))!;
      const { location, cookie } = await oidcRoundTrip({
        sub: "owner-lookalike",
        email: "owner@example.test",
        emailVerified: true,
      });
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("error")).toBe("account_not_linked");
      expect(cookie).toBeNull();
      expect(await accountsFor(ownerId)).toHaveLength(0);
    });

    test("invite accepted, then an explicit binding by iss+sub; later sign-ins land in the same user and org", async () => {
      // Admission: the owner invites, the invitee proves the email and is created.
      const ownerCookie = await magicLinkSignIn("owner@example.test");
      const ownerSession = await auth.api.getSession({
        headers: new Headers({ cookie: ownerCookie }),
      });
      await admission.issueInvitation({ email: "invitee@example.test" }, ownerSession);
      const invitation = invitations.at(-1)!;
      const { enrollmentId } = await admission.begin({
        kind: "invitation",
        credential: invitation.token,
        email: "invitee@example.test",
      });
      await admission.complete(
        { enrollmentId, credential: invitation.token, verificationCode: proofs.at(-1)!.code },
        null,
      );
      const inviteeId = (await userIdByEmail("invitee@example.test"))!;
      expect(inviteeId).toBeTruthy();
      const usersAfterAdmission = await countUsers();
      await db.execute(
        sql`insert into organization (id, name, slug) values ('org-oidc', 'Acme', 'acme-oidc')`,
      );
      await db.execute(
        sql`insert into member (id, organization_id, user_id, role) values ('m-oidc', 'org-oidc', ${inviteeId}, 'member')`,
      );

      // Before binding, the invitee's IdP identity is refused like any other.
      const refused = await oidcRoundTrip({ sub: "invitee-sub", email: "invitee@example.test" });
      expect(refused.location.searchParams.get("error")).toBe("account_not_linked");

      // Explicit binding from the invitee's own signed-in session.
      const inviteeCookie = await magicLinkSignIn("invitee@example.test");
      const linked = await oidcRoundTrip(
        { sub: "invitee-sub", email: "invitee@example.test" },
        { linkWithCookie: inviteeCookie },
      );
      expect(linked.location.pathname).toBe("/dashboard");
      expect(linked.location.searchParams.get("error")).toBeNull();
      expect(await accountsFor(inviteeId)).toEqual([
        { provider_id: PROVIDER_ID, account_id: `${issuer.issuer}#invitee-sub` },
      ]);

      // A later OIDC sign-in, with no prior session, lands in the same user.
      const later = await oidcRoundTrip({ sub: "invitee-sub", email: "invitee@example.test" });
      expect(later.location.pathname).toBe("/dashboard");
      expect(later.cookie).not.toBeNull();
      const session = await auth.api.getSession({
        headers: new Headers({ cookie: later.cookie! }),
      });
      expect(session?.user.id).toBe(inviteeId);
      const membership = await db.execute(
        sql`select organization_id from member where user_id = ${session!.user.id}`,
      );
      expect(membership.rows).toEqual([{ organization_id: "org-oidc" }]);
      // OIDC sign-in and binding never created another user.
      expect(await countUsers()).toBe(usersAfterAdmission);
    });

    test("binding is by subject, not email: another subject with the same email is refused", async () => {
      const { location, cookie } = await oidcRoundTrip({
        sub: "different-sub",
        email: "invitee@example.test",
      });
      expect(location.searchParams.get("error")).toBe("account_not_linked");
      expect(cookie).toBeNull();
    });

    test("an explicit binding whose IdP email differs from the account is refused", async () => {
      const ownerId = (await userIdByEmail("owner@example.test"))!;
      const ownerCookie = await magicLinkSignIn("owner@example.test");
      const { location } = await oidcRoundTrip(
        { sub: "owner-other-email", email: "someone-else@example.test" },
        { linkWithCookie: ownerCookie },
      );
      expect(location.searchParams.get("error")).toBe("email_does_not_match");
      expect(await accountsFor(ownerId)).toHaveLength(0);
    });

    test("linking requires a session; a client-submitted ID token is never accepted", async () => {
      const anonymous = await auth.handler(
        new Request(`${BASE}/api/auth/link-social`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: PROVIDER_ID, callbackURL: `${BASE}/dashboard` }),
        }),
      );
      expect(anonymous.status).toBe(401);

      const direct = await auth.handler(
        new Request(`${BASE}/api/auth/sign-in/social`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: PROVIDER_ID,
            callbackURL: `${BASE}/dashboard`,
            idToken: { token: "header.payload.signature" },
          }),
        }),
      );
      expect(direct.status).toBe(400);
      expect(sessionCookie(direct)).toBeNull();
    });

    test("no authorization code, IdP token or client secret reaches the logs", () => {
      const output = captured.join("\n");
      expect(issuer.issued.length).toBeGreaterThan(0);
      for (const secret of [...issuer.issued, CLIENT_SECRET]) {
        expect(output).not.toContain(secret);
      }
    });
  },
);
