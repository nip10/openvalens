import { readdir } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, test } from "bun:test";
import { createAuth } from "@openvalens/auth";
import {
  createMcpOAuthConsent,
  createMcpOAuthMetadata,
  createPinnedMetadataFetch,
  hashOAuthToken,
  type PinnedFetchImpl,
} from "@openvalens/auth/mcp-oauth";
import { createDb, sql } from "@openvalens/db";
import { aiAppGrant } from "@openvalens/db/schema/ai-apps";
import { oauthAccessToken, oauthClient } from "@openvalens/db/schema/oauth";
import type { EmailService, SendEmailInput } from "@openvalens/email";
import { eq } from "drizzle-orm";

import { mcpOAuthEndpointsFor, parseMcpConfig } from "./config";
import {
  AI_APP_CONSENT_VERSION,
  createAiAppsService,
  type AiAppOAuthConnectedEvent,
} from "./grants";
import { createAiAppsHttp } from "./http";
import { BASE_SCOPE, GRANTABLE_SCOPES } from "./scopes";
import { createMcpDataSources } from "./sources";

/**
 * OAuth 2.1 for connected AI apps (Issue #439, M1b) end to end against a
 * disposable PostgreSQL, over the real Better Auth handler and the real MCP
 * handler (plain fetch, no network): CIMD client discovery through the pinned
 * transport (fake DNS and fetch), authorize → login → consent → code → token →
 * MCP call, RFC 8707 audience checks, refresh rotation and replay revocation,
 * revoking a grant, step-up and the 24-hour DCR cleanup. Synthetic data only.
 */

const url = process.env.AI_APPS_OAUTH_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/ai_apps_oauth_test"
  )
    throw new Error("Empty disposable loopback ai_apps_oauth_test database required.");
}

const BASE = "http://localhost:3000";
const ENV = {
  BETTER_AUTH_URL: BASE,
  BETTER_AUTH_SECRET: "s".repeat(32),
  CORS_ORIGIN: BASE,
  NODE_ENV: "test",
};
const endpoints = mcpOAuthEndpointsFor({ serverUrl: BASE, webOrigin: BASE })!;
const RESOURCE = endpoints.resource;
const WHO = "oauth";
const USER = `user-${WHO}`;
const ORG = `org-${WHO}`;
const EMAIL = `${WHO}@example.test`;

/** A CIMD client the fake DNS resolves to a public address. */
const CIMD_CLIENT = "https://app.example.com/oauth/client.json";
const CIMD_REDIRECT = "https://app.example.com/oauth/callback";
const PRIVATE_CLIENT = "https://internal.example.com/oauth/client.json";
const REDIRECTING_CLIENT = "https://moved.example.com/oauth/client.json";

describe.skipIf(!url)("OAuth 2.1 for AI apps against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/ai_apps_oauth_test" });
  const sent: SendEmailInput[] = [];
  const email: EmailService = {
    organizationName: "OpenValens",
    prepareEmail: (input) => input,
    sendEmail: async (input) => {
      sent.push(input);
      return { id: "msg", dryRun: false };
    },
  };
  const connected: AiAppOAuthConnectedEvent[] = [];
  const service = createAiAppsService({
    db,
    oauth: { resource: RESOURCE },
    onOAuthConnected: async (event) => {
      connected.push(event);
    },
  });

  // The real pinned transport over a fake resolver and fake fetch.
  const metadataFetches: string[] = [];
  const fetchImpl: PinnedFetchImpl = async (target, init) => {
    metadataFetches.push(`${new Headers(init.headers).get("host")} ${target}`);
    const host = new Headers(init.headers).get("host");
    if (host === "moved.example.com") {
      return new Response(null, {
        status: 302,
        headers: { location: "https://169.254.169.254/" },
      }) as Awaited<ReturnType<PinnedFetchImpl>>;
    }
    return new Response(
      JSON.stringify({
        client_id: CIMD_CLIENT,
        client_name: "Example Assistant",
        client_uri: "https://app.example.com",
        redirect_uris: [CIMD_REDIRECT],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ) as Awaited<ReturnType<PinnedFetchImpl>>;
  };
  const transport = createPinnedMetadataFetch({
    resolve: async (hostname) => {
      if (hostname === "internal.example.com") return [{ address: "10.0.0.7", family: 4 }];
      return [{ address: "93.184.215.14", family: 4 }];
    },
    fetchImpl,
  });

  const auth = createAuth(ENV, db, {
    email,
    rateLimitEnabled: false,
    mcpOAuth: {
      resource: RESOURCE,
      loginPage: endpoints.loginPage,
      consentPage: endpoints.consentPage,
      grantableScopes: GRANTABLE_SCOPES,
      fetchClientMetadataResource: transport,
      onRefreshTokenReplay: async (event) => {
        await service.revokeOAuthAfterReplay(event);
      },
    },
  });
  const consent = createMcpOAuthConsent(auth);
  const metadata = createMcpOAuthMetadata(auth);
  const http = createAiAppsHttp({
    db,
    service,
    sources: createMcpDataSources(db, async () => []),
    config: parseMcpConfig({ MCP_ENABLED: true }),
    version: "1.0.0",
    oauth: { resourceMetadataUrl: endpoints.resourceMetadataUrl, challengeScopes: [BASE_SCOPE] },
  });

  let cookie = "";
  let sessionId = "";

  async function signIn(): Promise<void> {
    await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL }),
      }),
    );
    const message = [...sent].reverse().find((entry) => entry.to === EMAIL);
    const token = message?.html?.match(/magic-link\/verify\?token=([^"'&]+)/)?.[1];
    if (!token) throw new Error("no magic link captured");
    const verify = await auth.handler(
      new Request(`${BASE}/api/auth/magic-link/verify?token=${token}`),
    );
    const session = verify.headers.getSetCookie().find((value) => value.includes("session_token"));
    if (!session) throw new Error("no session cookie");
    cookie = session.split(";")[0]!;
    const current = await auth.api.getSession({ headers: new Headers({ cookie }) });
    sessionId = current!.session.id;
  }

  function pkce() {
    const verifier = randomBytes(32).toString("base64url");
    return {
      verifier,
      challenge: createHash("sha256").update(verifier).digest("base64url"),
    };
  }

  function authorizeUrl(input: {
    clientId: string;
    redirectUri: string;
    challenge: string;
    scope?: string;
    resource?: string | null;
  }): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      state: "state-123",
      code_challenge: input.challenge,
      code_challenge_method: "S256",
      scope: input.scope ?? BASE_SCOPE,
    });
    if (input.resource !== null) params.set("resource", input.resource ?? RESOURCE);
    return `${BASE}/api/auth/oauth2/authorize?${params}`;
  }

  async function authorize(target: string, withSession = true): Promise<Response> {
    return auth.handler(new Request(target, { headers: withSession ? { cookie } : {} }));
  }

  async function token(body: Record<string, string>): Promise<{ status: number; json: any }> {
    const response = await auth.handler(
      new Request(`${BASE}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body).toString(),
      }),
    );
    return { status: response.status, json: await response.json() };
  }

  /** authorize → consent (approve `scopes` for ORG) → code → tokens. */
  async function connect(input: {
    clientId: string;
    redirectUri: string;
    scopes?: string[];
    requested?: string;
  }) {
    const { verifier, challenge } = pkce();
    const toConsent = await authorize(
      authorizeUrl({ ...input, challenge, scope: input.requested }),
    );
    expect(toConsent.status).toBe(302);
    const consentUrl = new URL(toConsent.headers.get("location")!);
    expect(`${consentUrl.origin}${consentUrl.pathname}`).toBe(endpoints.consentPage);
    const oauthQuery = consentUrl.search.slice(1);
    const request = await consent.readRequest({
      oauthQuery,
      sessionId,
      grantableScopes: GRANTABLE_SCOPES,
    });
    const result = await service.connectOAuthClient({
      userId: USER,
      organizationId: ORG,
      clientId: request.clientId,
      clientName: request.clientName,
      clientIdHost: request.clientIdHost,
      scopes: input.scopes ?? [],
      consentVersion: AI_APP_CONSENT_VERSION,
      authorize: (grant) =>
        consent.approve({
          headers: new Headers({ cookie }),
          oauthQuery,
          sessionId,
          referenceId: grant.grantId,
          scopes: grant.scopes,
        }),
    });
    const back = new URL(result.redirectUrl);
    expect(`${back.origin}${back.pathname}`).toBe(input.redirectUri);
    expect(back.searchParams.get("state")).toBe("state-123");
    expect(back.searchParams.get("iss")).toBe(`${BASE}/api/auth`);
    const code = back.searchParams.get("code")!;
    const issued = await token({
      grant_type: "authorization_code",
      code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      code_verifier: verifier,
      resource: RESOURCE,
    });
    expect(issued.status).toBe(200);
    return { request, result, tokens: issued.json as Record<string, any> };
  }

  async function mcp(bearer: string | null, method: string, params: unknown = {}) {
    const response = await http.handleMcp(
      new Request(`${BASE}/api/mcp`, {
        method: "POST",
        headers: {
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
    const text = await response.text();
    const payload = text.trimStart().startsWith("{")
      ? text
      : (text
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .at(-1) ?? "null");
    return {
      status: response.status,
      challenge: response.headers.get("www-authenticate"),
      body: JSON.parse(payload) as Record<string, any>,
    };
  }

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    const root = new URL("../../db/src/migrations/", import.meta.url);
    for (const directory of (await readdir(root)).sort()) {
      if (!/^\d/.test(directory)) continue;
      const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
      for (const statement of text.split("--> statement-breakpoint"))
        if (statement.trim()) await db.execute(sql.raw(statement));
    }
    await db.execute(
      sql.raw(`
        insert into "user" (id, email, email_verified) values ('${USER}', '${EMAIL}', true);
        insert into organization (id, name, slug) values ('${ORG}', 'Record ${WHO}', 'record-${WHO}');
        insert into member (id, organization_id, user_id, role) values ('m-${WHO}', '${ORG}', '${USER}', 'owner');
      `),
    );
    await signIn();
  });

  test("serves RFC 9728 and RFC 8414 metadata for CIMD, PKCE S256 and RFC 9207", async () => {
    for (const path of [
      "/.well-known/oauth-protected-resource/api/mcp",
      "/.well-known/oauth-protected-resource",
    ]) {
      const response = await metadata.protectedResourceMetadata(new Request(`${BASE}${path}`));
      expect(response.status).toBe(200);
      const document = (await response.json()) as Record<string, any>;
      expect(document.resource).toBe(RESOURCE);
      expect(document.authorization_servers).toEqual([`${BASE}/api/auth`]);
      expect(document.scopes_supported).toEqual([...GRANTABLE_SCOPES]);
    }
    for (const path of [
      "/.well-known/oauth-authorization-server/api/auth",
      "/.well-known/oauth-authorization-server",
    ]) {
      const response = await metadata.authorizationServerMetadata(new Request(`${BASE}${path}`));
      const document = (await response.json()) as Record<string, any>;
      expect(document.issuer).toBe(`${BASE}/api/auth`);
      expect(document.code_challenge_methods_supported).toEqual(["S256"]);
      expect(document.authorization_response_iss_parameter_supported).toBe(true);
      expect(document.client_id_metadata_document_supported).toBe(true);
      expect(document.token_endpoint_auth_methods_supported).toEqual(
        expect.arrayContaining(["none", "private_key_jwt"]),
      );
      expect(document.registration_endpoint).toBe(`${BASE}/api/auth/oauth2/register`);
      expect(document.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
      expect(document.jwks_uri).toBeUndefined();
    }
  });

  test("an unauthenticated MCP request is challenged with resource_metadata and scope", async () => {
    const response = await mcp(null, "tools/list");
    expect(response.status).toBe(401);
    expect(response.challenge).toContain(`resource_metadata="${endpoints.resourceMetadataUrl}"`);
    expect(response.challenge).toContain('scope="records:read"');
  });

  test("CIMD fetches refuse private and redirecting hosts", async () => {
    for (const clientId of [PRIVATE_CLIENT, REDIRECTING_CLIENT, "https://127.0.0.1/client.json"]) {
      const response = await authorize(
        authorizeUrl({ clientId, redirectUri: CIMD_REDIRECT, challenge: pkce().challenge }),
      );
      // Refused before any redirect: a 400 `invalid_client`, or Better Auth's
      // error page for a client id it rejects outright.
      const location = response.headers.get("location");
      if (location) expect(location).toContain("error=invalid_client");
      else {
        expect(response.status).toBe(400);
        expect(((await response.json()) as { error: string }).error).toBe("invalid_client");
      }
      const [stored] = await db
        .select({ id: oauthClient.id })
        .from(oauthClient)
        .where(eq(oauthClient.clientId, clientId));
      expect(stored).toBeUndefined();
    }
    expect(metadataFetches.some((fetch) => fetch.startsWith("internal.example.com"))).toBe(false);
    expect(metadataFetches.some((fetch) => fetch.startsWith("moved.example.com"))).toBe(true);
  });

  test("authorize → login → consent → token → MCP call, then refresh rotation and replay", async () => {
    // Signed out: the login page, carrying the signed request.
    const signedOut = await authorize(
      authorizeUrl({
        clientId: CIMD_CLIENT,
        redirectUri: CIMD_REDIRECT,
        challenge: "x".repeat(43),
      }),
      false,
    );
    expect(signedOut.status).toBe(302);
    const login = new URL(signedOut.headers.get("location")!);
    expect(`${login.origin}${login.pathname}`).toBe(endpoints.loginPage);
    expect(login.searchParams.get("sig")).toBeTruthy();

    const { request, result, tokens } = await connect({
      clientId: CIMD_CLIENT,
      redirectUri: CIMD_REDIRECT,
    });
    expect(request).toMatchObject({
      clientName: "Example Assistant",
      clientIdHost: "app.example.com",
      registration: "cimd",
      redirectHost: "app.example.com",
      requestedScopes: ["records:read"],
    });
    expect(request.offeredScopes.sort()).toEqual([...GRANTABLE_SCOPES].sort());
    expect(result.created).toBe(true);
    // The settings list shows the host the app's client id lives on.
    expect(result.grant.clientIdHost).toBe("app.example.com");
    expect(connected.at(-1)).toMatchObject({
      label: "Example Assistant",
      clientIdHost: "app.example.com",
    });

    // Opaque, prefixed, an hour, with a rotating refresh token.
    expect(tokens.access_token).toMatch(/^ovat_[A-Za-z]{32}$/);
    expect(tokens.refresh_token).toMatch(/^ovrt_/);
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.scope.split(" ").sort()).toEqual(["offline_access", "records:read"]);

    const [grant] = await db.select().from(aiAppGrant).where(eq(aiAppGrant.id, result.grant.id));
    expect(grant).toMatchObject({
      kind: "oauth",
      oauthClientId: CIMD_CLIENT,
      scopes: ["records:read"],
    });

    const list = await mcp(tokens.access_token, "tools/list");
    expect(list.status).toBe(200);
    const names = (list.body.result.tools as Array<{ name: string }>).map((tool) => tool.name);
    expect(names).toContain("goals");
    expect(names).not.toContain("nutritionContext");
    const call = await mcp(tokens.access_token, "tools/call", { name: "goals", arguments: {} });
    expect(call.status).toBe(200);
    expect(call.body.result.isError).toBeUndefined();

    // A scope the grant lacks: 403 insufficient_scope for step-up.
    const stepUp = await mcp(tokens.access_token, "tools/call", {
      name: "nutritionContext",
      arguments: {},
    });
    expect(stepUp.status).toBe(403);
    expect(stepUp.challenge).toContain('error="insufficient_scope"');
    expect(stepUp.challenge).toContain('scope="records:read nutrition:read"');
    expect(stepUp.challenge).toContain("resource_metadata=");

    // OAuth tokens are bound to /api/mcp: the REST API refuses them.
    const rest = await http.handleRest(
      new Request(`${BASE}/api/v1/tools/goals`, {
        method: "POST",
        headers: { authorization: `Bearer ${tokens.access_token}` },
        body: "{}",
      }),
      "goals",
    );
    expect(rest.status).toBe(401);

    // Rotation: a new pair; the new access token works.
    const rotated = await token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: CIMD_CLIENT,
    });
    expect(rotated.status).toBe(200);
    expect(rotated.json.refresh_token).not.toBe(tokens.refresh_token);
    expect((await mcp(rotated.json.access_token, "tools/list")).status).toBe(200);

    // Replay of the rotated token: invalid_grant, the grant is revoked and
    // every token of it stops working.
    const replay = await token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: CIMD_CLIENT,
    });
    expect(replay.status).toBe(400);
    expect(replay.json.error).toBe("invalid_grant");
    const grants = await service.listGrants({ userId: USER, organizationId: ORG });
    expect(grants.find((entry) => entry.id === result.grant.id)?.status).toBe("revoked");
    expect((await mcp(rotated.json.access_token, "tools/list")).status).toBe(401);
    const dead = await token({
      grant_type: "refresh_token",
      refresh_token: rotated.json.refresh_token,
      client_id: CIMD_CLIENT,
    });
    expect(dead.status).toBe(400);
    expect(dead.json.error).toBe("invalid_grant");
  });

  test("a token for another resource is rejected, and a request naming none gets this one", async () => {
    const { result, tokens } = await connect({
      clientId: CIMD_CLIENT,
      redirectUri: CIMD_REDIRECT,
    });
    const [stored] = await db
      .select()
      .from(oauthAccessToken)
      .where(eq(oauthAccessToken.referenceId, result.grant.id));
    expect(stored!.resources).toEqual([RESOURCE]);

    for (const resources of [["https://other.example.com/api/mcp"], []]) {
      const forged = `ovat_${"Q".repeat(31)}${resources.length ? "A" : "B"}`;
      await db.insert(oauthAccessToken).values({
        id: `forged-${resources.length}`,
        token: hashOAuthToken(forged.slice("ovat_".length)),
        clientId: CIMD_CLIENT,
        userId: USER,
        referenceId: result.grant.id,
        resources,
        scopes: ["records:read"],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const refused = await mcp(forged, "tools/list");
      expect(refused.status).toBe(401);
      expect(refused.challenge).toContain('error="invalid_token"');
    }

    // An authorization request without `resource` is bound to the MCP resource.
    const { verifier, challenge } = pkce();
    const toConsent = await authorize(
      authorizeUrl({
        clientId: CIMD_CLIENT,
        redirectUri: CIMD_REDIRECT,
        challenge,
        resource: null,
      }),
    );
    const oauthQuery = new URL(toConsent.headers.get("location")!).search.slice(1);
    expect(new URLSearchParams(oauthQuery).get("resource")).toBe(RESOURCE);
    // A request for an unknown resource never reaches consent.
    const unknown = await authorize(
      authorizeUrl({
        clientId: CIMD_CLIENT,
        redirectUri: CIMD_REDIRECT,
        challenge,
        resource: "https://other.example.com/api/mcp",
      }),
    );
    expect(unknown.headers.get("location")).toContain("error=invalid_target");
    expect(verifier).toBeTruthy();
    expect(tokens.access_token).toBeTruthy();
  });

  test("revoking a grant stops the next call; approving more scopes steps the grant up", async () => {
    const first = await connect({ clientId: CIMD_CLIENT, redirectUri: CIMD_REDIRECT });
    expect((await mcp(first.tokens.access_token, "tools/list")).status).toBe(200);

    // Step-up: the same client approved again with nutrition reuses the grant.
    const second = await connect({
      clientId: CIMD_CLIENT,
      redirectUri: CIMD_REDIRECT,
      scopes: ["nutrition:read"],
      requested: "records:read nutrition:read",
    });
    expect(second.result.created).toBe(false);
    expect(second.result.grant.id).toBe(first.result.grant.id);
    expect(second.request.requestedScopes.sort()).toEqual(["nutrition:read", "records:read"]);
    const stepped = await mcp(second.tokens.access_token, "tools/list");
    expect(
      (stepped.body.result.tools as Array<{ name: string }>).map((tool) => tool.name),
    ).toContain("nutritionContext");

    const revoked = await service.revokeGrant({
      userId: USER,
      organizationId: ORG,
      grantId: first.result.grant.id,
    });
    expect(revoked.revoked).toBe(true);
    expect((await mcp(second.tokens.access_token, "tools/list")).status).toBe(401);
    const refresh = await token({
      grant_type: "refresh_token",
      refresh_token: second.tokens.refresh_token,
      client_id: CIMD_CLIENT,
    });
    expect(refresh.json.error).toBe("invalid_grant");
  });

  test("a dynamically registered client that never completes a grant is deleted after 24 hours", async () => {
    async function register(name: string): Promise<string> {
      const response = await auth.handler(
        new Request(`${BASE}/api/auth/oauth2/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            client_name: name,
            redirect_uris: ["http://127.0.0.1:33418/callback"],
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
          }),
        }),
      );
      expect(response.status).toBe(201);
      return ((await response.json()) as { client_id: string }).client_id;
    }
    const abandoned = await register("Abandoned client");
    const fresh = await register("Fresh client");
    const used = await register("Used client");
    const usedConnection = await connect({
      clientId: used,
      redirectUri: "http://127.0.0.1:33418/callback",
    });
    expect(usedConnection.request.registration).toBe("dcr");
    expect(usedConnection.request.clientIdHost).toBeNull();
    expect(usedConnection.result.grant.clientIdHost).toBeNull();

    const old = new Date(Date.now() - 25 * 3_600_000);
    for (const clientId of [abandoned, used]) {
      await db
        .update(oauthClient)
        .set({ createdAt: old })
        .where(eq(oauthClient.clientId, clientId));
    }
    // The CIMD client is never purged, however old.
    await db
      .update(oauthClient)
      .set({ createdAt: old })
      .where(eq(oauthClient.clientId, CIMD_CLIENT));

    expect(await service.purgeAbandonedOAuthClients()).toBe(1);
    const remaining = (await db.select({ clientId: oauthClient.clientId }).from(oauthClient)).map(
      (row) => row.clientId,
    );
    expect(remaining).not.toContain(abandoned);
    expect(remaining).toEqual(expect.arrayContaining([fresh, used, CIMD_CLIENT]));
  });

  test("the consent request is bound to the session it was issued for", async () => {
    const toConsent = await authorize(
      authorizeUrl({
        clientId: CIMD_CLIENT,
        redirectUri: CIMD_REDIRECT,
        challenge: pkce().challenge,
      }),
    );
    const oauthQuery = new URL(toConsent.headers.get("location")!).search.slice(1);
    await expect(
      consent.readRequest({
        oauthQuery,
        sessionId: "another-session",
        grantableScopes: GRANTABLE_SCOPES,
      }),
    ).rejects.toThrow("another session");
    const tampered = oauthQuery.replace("records%3Aread", "notes%3Aread");
    await expect(
      consent.readRequest({ oauthQuery: tampered, sessionId, grantableScopes: GRANTABLE_SCOPES }),
    ).rejects.toThrow("invalid or has expired");
  });
});
