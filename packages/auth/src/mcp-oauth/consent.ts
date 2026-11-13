import {
  oauthProviderAuthServerMetadata,
  verifyOAuthQueryParams,
} from "@better-auth/oauth-provider";

import {
  MCP_OAUTH_OFFLINE_SCOPE,
  MCP_OAUTH_REQUESTED_SCOPE_PARAM,
  withConsentReference,
} from "./plugin";

/**
 * Issue #439 (M1b) — the server side of the OAuth consent screen.
 *
 * The web consent page receives Better Auth's signed authorization query
 * (`oauth_query`). Before showing anything it asks {@link readRequest}, which
 * checks the signature and expiry and that the query was issued for **this**
 * browser session (`ba_pl`), then describes the client. Approving runs Better
 * Auth's consent endpoint with the member's own session headers, inside
 * {@link withConsentReference} so the consent and the authorization code carry
 * the `ai_app_grant` the member just approved.
 *
 * The grant itself (workspace, scopes, `mcp-v1`, audit, security email) is the
 * AI-apps service's job; this module only speaks OAuth.
 */

export type McpOAuthConsentRequest = {
  clientId: string;
  /** The client's self-declared name; always shown as unverified. */
  clientName: string | null;
  /** Host of a CIMD `client_id` URL; `null` for a dynamically registered client. */
  clientIdHost: string | null;
  /** `cimd` (metadata document) or `dcr` (dynamic registration). */
  registration: "cimd" | "dcr";
  /** Host the browser returns to with the authorization code. */
  redirectHost: string;
  /** Scopes the member may approve (the grantable reads). */
  offeredScopes: string[];
  /** Of those, the ones the client itself asked for. */
  requestedScopes: string[];
};

type AuthLike = {
  api: {
    oauth2Consent: (input: {
      headers: Headers;
      body: { accept: boolean; scope?: string; oauth_query: string };
    }) => Promise<unknown>;
  };
  $context: Promise<{
    secret: string;
    adapter: {
      findOne: <T>(input: {
        model: string;
        where: Array<{ field: string; value: unknown }>;
      }) => Promise<T | null>;
    };
  }>;
};

export class McpOAuthConsentError extends Error {
  readonly code: "INVALID_REQUEST" | "UNKNOWN_CLIENT" | "CONSENT_FAILED";

  constructor(code: McpOAuthConsentError["code"], message: string) {
    super(message);
    this.name = "McpOAuthConsentError";
    this.code = code;
  }
}

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.host : url.protocol;
  } catch {
    return null;
  }
}

function redirectUrl(result: unknown): string {
  const url = (result as { url?: unknown } | null)?.url;
  if (typeof url !== "string" || url.length === 0) {
    throw new McpOAuthConsentError("CONSENT_FAILED", "The authorization could not be completed.");
  }
  return url;
}

/**
 * `instance` is the server's Better Auth instance, built with `mcpOAuth`. Its
 * OAuth endpoints are added conditionally, so they are reached through the
 * structural {@link AuthLike} view rather than the inferred API type.
 */
export function createMcpOAuthConsent(instance: { api: object; $context: Promise<object> }) {
  const auth = instance as unknown as AuthLike;
  async function verified(oauthQuery: string, sessionId: string): Promise<URLSearchParams> {
    const { secret } = await auth.$context;
    if (oauthQuery.length > 8_192 || !(await verifyOAuthQueryParams(oauthQuery, secret))) {
      throw new McpOAuthConsentError(
        "INVALID_REQUEST",
        "This sign-in request is invalid or has expired. Start again from the app.",
      );
    }
    const params = new URLSearchParams(oauthQuery);
    // The consent redirect signs the session it was issued for; a query lifted
    // into another browser session is refused.
    if (params.get("ba_pl") !== sessionId) {
      throw new McpOAuthConsentError(
        "INVALID_REQUEST",
        "This sign-in request belongs to another session. Start again from the app.",
      );
    }
    return params;
  }

  /** Describes a pending authorization for the consent screen. */
  async function readRequest(input: {
    oauthQuery: string;
    sessionId: string;
    grantableScopes: readonly string[];
  }): Promise<McpOAuthConsentRequest> {
    const params = await verified(input.oauthQuery, input.sessionId);
    const clientId = params.get("client_id");
    const redirectUri = params.get("redirect_uri");
    if (!clientId || !redirectUri) {
      throw new McpOAuthConsentError("INVALID_REQUEST", "The sign-in request is incomplete.");
    }
    const { adapter } = await auth.$context;
    const client = await adapter.findOne<{
      clientId: string;
      name: string | null;
      clientDiscoveryId: string | null;
      disabled: boolean | null;
    }>({ model: "oauthClient", where: [{ field: "clientId", value: clientId }] });
    if (!client || client.disabled) {
      throw new McpOAuthConsentError("UNKNOWN_CLIENT", "This app is not registered here.");
    }
    const grantable = new Set(input.grantableScopes);
    const offered = (params.get("scope") ?? "").split(" ").filter((scope) => grantable.has(scope));
    const requested = (params.get(MCP_OAUTH_REQUESTED_SCOPE_PARAM) ?? "")
      .split(" ")
      .filter((scope) => grantable.has(scope));
    const discovered = Boolean(client.clientDiscoveryId);
    return {
      clientId,
      clientName: client.name?.trim() ? client.name.trim().slice(0, 80) : null,
      clientIdHost: discovered ? hostOf(clientId) : null,
      registration: discovered ? "cimd" : "dcr",
      redirectHost: hostOf(redirectUri) ?? redirectUri.slice(0, 80),
      offeredScopes: offered,
      requestedScopes: requested,
    };
  }

  /**
   * Completes the authorization for the grant `referenceId` with `scopes`
   * (plus `offline_access` when it was requested) and returns the client's
   * redirect URL carrying the code.
   */
  async function approve(input: {
    headers: Headers;
    oauthQuery: string;
    sessionId: string;
    referenceId: string;
    scopes: readonly string[];
  }): Promise<string> {
    const params = await verified(input.oauthQuery, input.sessionId);
    const offered = new Set((params.get("scope") ?? "").split(" "));
    const accepted = input.scopes.filter((scope) => offered.has(scope));
    if (offered.has(MCP_OAUTH_OFFLINE_SCOPE)) accepted.push(MCP_OAUTH_OFFLINE_SCOPE);
    try {
      return redirectUrl(
        await withConsentReference(input.referenceId, () =>
          auth.api.oauth2Consent({
            headers: input.headers,
            body: { accept: true, scope: accepted.join(" "), oauth_query: input.oauthQuery },
          }),
        ),
      );
    } catch (error) {
      if (error instanceof McpOAuthConsentError) throw error;
      throw new McpOAuthConsentError("CONSENT_FAILED", "The authorization could not be completed.");
    }
  }

  /** Denies the authorization; returns the client's redirect URL with `access_denied`. */
  async function deny(input: {
    headers: Headers;
    oauthQuery: string;
    sessionId: string;
  }): Promise<string> {
    await verified(input.oauthQuery, input.sessionId);
    try {
      return redirectUrl(
        await auth.api.oauth2Consent({
          headers: input.headers,
          body: { accept: false, oauth_query: input.oauthQuery },
        }),
      );
    } catch (error) {
      if (error instanceof McpOAuthConsentError) throw error;
      throw new McpOAuthConsentError("CONSENT_FAILED", "The authorization could not be completed.");
    }
  }

  return Object.freeze({ readRequest, approve, deny });
}

export type McpOAuthConsent = ReturnType<typeof createMcpOAuthConsent>;

/**
 * The well-known metadata documents, served at the server root by the app:
 * RFC 9728 protected resource metadata (answered by `@better-auth/mcp` inside
 * Better Auth's handler) and RFC 8414 authorization server metadata, which
 * advertises S256 PKCE, RFC 9207 `iss`, CIMD support and the `none` and
 * `private_key_jwt` token endpoint methods.
 */
export function createMcpOAuthMetadata(instance: {
  handler: (request: Request) => Promise<Response>;
}) {
  const auth = instance as unknown as {
    handler: (request: Request) => Promise<Response>;
    api: { getOAuthServerConfig: (...args: never[]) => unknown };
  };
  const authorizationServer = oauthProviderAuthServerMetadata(auth);
  return Object.freeze({
    protectedResourceMetadata: (request: Request): Promise<Response> => auth.handler(request),
    authorizationServerMetadata: (request: Request): Promise<Response> =>
      authorizationServer(request),
  });
}
