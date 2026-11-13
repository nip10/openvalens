import { cimd } from "@better-auth/cimd";
import { mcp } from "@better-auth/mcp";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { createStructuredLogger } from "@openvalens/observability";
import { createAuthMiddleware } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";
import { AsyncLocalStorage } from "node:async_hooks";

import {
  hashOAuthToken,
  MCP_OAUTH_ACCESS_TOKEN_PREFIX,
  MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  MCP_OAUTH_REFRESH_TOKEN_PREFIX,
  MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS,
} from "./tokens";
import { createPinnedMetadataFetch } from "./transport";

/**
 * Issue #439 (M1b) — OAuth 2.1 sign-in for connected AI apps (claude.ai,
 * ChatGPT, Claude Code, Cursor) through `@better-auth/mcp` (the OAuth provider
 * configured for MCP; never registered next to a separate `oauthProvider()`)
 * and `@better-auth/cimd`.
 *
 * - **Tokens:** opaque (`disableJwtPlugin`), so revoking stops the next call.
 *   Access tokens last an hour; refresh tokens rotate on every use with no
 *   reuse window and expire after 90 days unused. A rotated refresh token
 *   presented again is a replay: Better Auth tears down the token family and
 *   {@link McpOAuthOptions.onRefreshTokenReplay} revokes the grant.
 * - **Audience:** every token is bound to the MCP resource (RFC 8707). A
 *   request that names no resource gets this server's only one.
 * - **Registration:** CIMD preferred (metadata documents fetched through the
 *   pinned transport in `./transport`), DCR also on, rate-limited per IP by
 *   Better Auth (5 a minute); clients that never complete a grant are deleted
 *   after 24 hours by the AI-apps service.
 * - **Consent:** nothing is pre-approved. The consent row carries the id of
 *   the `ai_app_grant` the member approved (`referenceId`), set by
 *   {@link withConsentReference} around the consent call; every token issued
 *   from it inherits that id.
 */

/** OAuth-only scopes on top of the grant scopes. */
export const MCP_OAUTH_OFFLINE_SCOPE = "offline_access";

/**
 * Authorization query parameter recording the scopes the client itself asked
 * for, before the request is widened to every grantable scope so the consent
 * screen can offer each one (sensitive ones unticked).
 */
export const MCP_OAUTH_REQUESTED_SCOPE_PARAM = "ov_scope";

export type RefreshTokenReplayEvent = {
  clientId: string;
  userId: string;
  /** The `ai_app_grant` the replayed token belonged to. */
  referenceId: string | null;
};

export type McpOAuthOptions = {
  /** Canonical MCP resource URL (`https://<server>/api/mcp`); tokens are bound to it. */
  resource: string;
  /** Web page that signs the member in, then resumes the authorization. */
  loginPage: string;
  /** Web consent screen. */
  consentPage: string;
  /** Every scope a grant may hold (`records:read` and the opt-in reads). */
  grantableScopes: readonly string[];
  /** Called once per replayed refresh token, before Better Auth answers `invalid_grant`. */
  onRefreshTokenReplay?: (event: RefreshTokenReplayEvent) => Promise<void>;
  /** CIMD fetch transport; defaults to the pinned Bun transport. Tests inject a fake. */
  fetchClientMetadataResource?: ClientMetadataResourceFetch;
  /** Dynamic client registration (RFC 7591); on unless set to `false`. */
  dynamicClientRegistration?: boolean;
};

const consentReference = new AsyncLocalStorage<{ referenceId: string }>();

/**
 * Runs `fn` (the Better Auth consent call) so the consent it stores, and the
 * authorization code it issues, carry `referenceId`: the `ai_app_grant` id.
 */
export function withConsentReference<T>(referenceId: string, fn: () => Promise<T>): Promise<T> {
  return consentReference.run({ referenceId }, fn);
}

/** Whether `resource` is acceptable to `@better-auth/mcp`: HTTPS, or HTTP on loopback. */
export function isMcpOAuthResourceUrl(resource: string): boolean {
  try {
    const url = new URL(resource);
    if (url.username || url.password || url.search || url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

type HookContext = {
  path?: string;
  method?: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  context: {
    adapter: {
      findOne: <T>(input: {
        model: string;
        where: Array<{ field: string; value: unknown }>;
      }) => Promise<T | null>;
    };
  };
};

function scopeList(value: unknown): string[] {
  return typeof value === "string" ? value.split(" ").filter(Boolean) : [];
}

/**
 * Widens an incoming authorization request: every grantable scope plus
 * `offline_access` (so every connection gets a rotating refresh token), the
 * client's own request kept in {@link MCP_OAUTH_REQUESTED_SCOPE_PARAM}, and the
 * MCP resource when none was named. A request already widened (the consent
 * step re-entering authorize) or naming a scope outside the grantable set
 * (Better Auth then refuses it with `invalid_scope`) is left as it is.
 */
export function widenAuthorizationRequest(
  params: Record<string, unknown>,
  options: Pick<McpOAuthOptions, "resource" | "grantableScopes">,
): Record<string, unknown> | null {
  if (typeof params.client_id !== "string") return null;
  const widened: Record<string, unknown> = { ...params };
  let changed = false;
  if (params.resource === undefined) {
    widened.resource = options.resource;
    changed = true;
  }
  if (params[MCP_OAUTH_REQUESTED_SCOPE_PARAM] === undefined) {
    const requested = scopeList(params.scope);
    const allowed = new Set([...options.grantableScopes, MCP_OAUTH_OFFLINE_SCOPE]);
    if (requested.every((scope) => allowed.has(scope))) {
      widened.scope = [...allowed].join(" ");
      widened[MCP_OAUTH_REQUESTED_SCOPE_PARAM] = requested.join(" ");
      changed = true;
    }
  }
  return changed ? widened : null;
}

/** The Better Auth plugins for OAuth 2.1, in registration order. */
export function createMcpOAuthPlugins(options: McpOAuthOptions): BetterAuthPlugin[] {
  const logger = createStructuredLogger({ level: "info" }).child({ component: "mcp-oauth" });
  const scopes = [...options.grantableScopes, MCP_OAUTH_OFFLINE_SCOPE];
  const dcr = options.dynamicClientRegistration !== false;

  const provider = mcp({
    resource: options.resource,
    loginPage: options.loginPage,
    consentPage: options.consentPage,
    scopes,
    clientRegistrationDefaultScopes: scopes,
    grantTypes: ["authorization_code", "refresh_token"],
    disableJwtPlugin: true,
    accessTokenExpiresIn: MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenExpiresIn: MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS,
    refreshTokenReuseInterval: 0,
    allowDynamicClientRegistration: dcr,
    allowUnauthenticatedClientRegistration: dcr,
    clientRegistrationDefaultApplicationType: "infer",
    prefix: {
      opaqueAccessToken: MCP_OAUTH_ACCESS_TOKEN_PREFIX,
      refreshToken: MCP_OAUTH_REFRESH_TOKEN_PREFIX,
    },
    // No post-login page: the consent screen picks the workspace. The
    // consent reference is the grant created when the member approves.
    postLogin: {
      page: options.consentPage,
      shouldRedirect: () => false,
      consentReferenceId: () => consentReference.getStore()?.referenceId,
    },
    // Per IP (Better Auth's limiter, on in production). Registration is the
    // anonymous write, so it is tight. The token endpoint is called from the
    // vendors' clouds, where every member of claude.ai or ChatGPT shares a few
    // egress addresses, so its budget is wide; tokens are still bound to PKCE,
    // the client and the grant.
    rateLimit: {
      register: { window: 60, max: 5 },
      token: { window: 60, max: 600 },
      authorize: { window: 60, max: 30 },
    },
  });

  const discovery = cimd({
    fetchClientMetadataResource: options.fetchClientMetadataResource ?? createPinnedMetadataFetch(),
    metadataProfile: "mcp-2026-07-28",
  });

  const guard: BetterAuthPlugin = {
    id: "openvalens-mcp-oauth",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/oauth2/authorize",
          handler: createAuthMiddleware(async (raw) => {
            const ctx = raw as unknown as HookContext;
            const usesBody = ctx.method === "POST";
            const source = (usesBody ? ctx.body : ctx.query) ?? {};
            const widened = widenAuthorizationRequest(source, options);
            if (!widened) return;
            return { context: usesBody ? { body: widened } : { query: widened } };
          }),
        },
        {
          matcher: (ctx) =>
            ctx.path === "/oauth2/token" &&
            (ctx.body as Record<string, unknown> | undefined)?.grant_type === "refresh_token",
          handler: createAuthMiddleware(async (raw) => {
            const ctx = raw as unknown as HookContext;
            const presented = ctx.body?.refresh_token;
            if (typeof presented !== "string") return;
            if (!presented.startsWith(MCP_OAUTH_REFRESH_TOKEN_PREFIX)) return;
            const row = await ctx.context.adapter.findOne<{
              clientId: string;
              userId: string;
              referenceId: string | null;
              revoked: Date | null;
            }>({
              model: "oauthRefreshToken",
              where: [
                {
                  field: "token",
                  value: hashOAuthToken(presented.slice(MCP_OAUTH_REFRESH_TOKEN_PREFIX.length)),
                },
              ],
            });
            // With no reuse window, any presentation of a rotated token is a
            // replay. Better Auth then deletes the token family and answers
            // `invalid_grant`; the grant is revoked here first.
            if (!row?.revoked) return;
            logger.warn("mcp_oauth.refresh_token.replayed", {
              clientId: row.clientId,
              grantId: row.referenceId,
            });
            try {
              await options.onRefreshTokenReplay?.({
                clientId: row.clientId,
                userId: row.userId,
                referenceId: row.referenceId ?? null,
              });
            } catch (error) {
              logger.error("mcp_oauth.refresh_token.replay_revoke_failed", { error });
            }
          }),
        },
      ],
    },
  };

  return [provider, discovery, guard] as BetterAuthPlugin[];
}
