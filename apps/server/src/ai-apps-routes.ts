import { originValidation } from "@modelcontextprotocol/hono";
import type { AiAppsHttp } from "@openvalens/mcp/http";
import type { Hono } from "hono";

/** Streamable HTTP MCP endpoint (Issue #439). */
export const MCP_PATH = "/api/mcp";
/** REST tool API: `POST /api/v1/tools/<name>`, `GET /api/v1/tools`. */
export const REST_TOOLS_PATH = "/api/v1/tools";
/** RFC 9728 protected resource metadata, root and path-inserted for `/api/mcp`. */
export const PROTECTED_RESOURCE_METADATA_PATHS = [
  "/.well-known/oauth-protected-resource",
  `/.well-known/oauth-protected-resource${MCP_PATH}`,
] as const;
/**
 * RFC 8414 authorization server metadata. The issuer is `<server>/api/auth`, so
 * the path-inserted form is canonical; the root form serves older (2025-03)
 * MCP clients that look there.
 */
export const AUTHORIZATION_SERVER_METADATA_PATHS = [
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-authorization-server/api/auth",
] as const;

export type AiAppsOAuthRoutes = {
  /** Serves the RFC 9728 document (Better Auth's `@better-auth/mcp`). */
  protectedResourceMetadata: (request: Request) => Promise<Response>;
  /** Serves the RFC 8414 document (Better Auth's OAuth provider). */
  authorizationServerMetadata: (request: Request) => Promise<Response>;
};

/**
 * Mounts the MCP server and the REST tool API (Issue #439). Called only when
 * `MCP_ENABLED` is on: with it off, none of these paths exist and they fall
 * through to the app's 404.
 *
 * Plain Hono, before the oRPC catch-all: the caller is an AI app with a
 * personal API key (`Authorization: Bearer ov_…`) or an OAuth access token
 * (`Bearer ovat_…`, `/api/mcp` only), never a browser session. A browser
 * request from another site is refused by Origin validation
 * (`@modelcontextprotocol/hono`); clients that send no Origin (Claude Code,
 * Cursor, scripts, vendor clouds) pass on to bearer authentication.
 *
 * With OAuth on (M1b) it also mounts the well-known metadata documents. The
 * OAuth endpoints themselves live under `/api/auth/oauth2/*` (Better Auth).
 */
export function registerAiAppsRoutes(
  app: Hono,
  options: {
    http: AiAppsHttp | null;
    allowedOriginHosts: string[];
    oauth?: AiAppsOAuthRoutes | null;
  },
): void {
  const { http } = options;
  if (!http) return;
  const origins = originValidation(options.allowedOriginHosts);

  app.use(MCP_PATH, origins);
  app.use(`${REST_TOOLS_PATH}/*`, origins);
  app.use(REST_TOOLS_PATH, origins);

  app.on(["GET", "POST", "DELETE"], MCP_PATH, (c) =>
    http.handleMcp(c.req.raw, c.get("correlationId")),
  );
  app.get(REST_TOOLS_PATH, (c) => http.handleRestList(c.req.raw, c.get("correlationId")));
  app.post(`${REST_TOOLS_PATH}/:name`, (c) =>
    http.handleRest(c.req.raw, c.req.param("name"), c.get("correlationId")),
  );

  const oauth = options.oauth;
  if (!oauth) return;
  for (const path of PROTECTED_RESOURCE_METADATA_PATHS) {
    app.get(path, (c) => oauth.protectedResourceMetadata(c.req.raw));
  }
  for (const path of AUTHORIZATION_SERVER_METADATA_PATHS) {
    app.get(path, (c) => oauth.authorizationServerMetadata(c.req.raw));
  }
}

/** Hostnames a browser `Origin` may name: the web app and the API itself. */
export function aiAppsAllowedOriginHosts(urls: Array<string | undefined>): string[] {
  const hosts = new Set<string>();
  for (const url of urls) {
    if (!url) continue;
    try {
      hosts.add(new URL(url).hostname);
    } catch {
      // An unparseable URL adds nothing; Origin-less clients are unaffected.
    }
  }
  return [...hosts];
}
