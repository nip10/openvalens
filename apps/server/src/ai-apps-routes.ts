import { originValidation } from "@modelcontextprotocol/hono";
import type { AiAppsHttp } from "@openvalens/mcp/http";
import type { Hono } from "hono";

/** Streamable HTTP MCP endpoint (Issue #439). */
export const MCP_PATH = "/api/mcp";
/** REST tool API: `POST /api/v1/tools/<name>`, `GET /api/v1/tools`. */
export const REST_TOOLS_PATH = "/api/v1/tools";

/**
 * Mounts the MCP server and the REST tool API (Issue #439). Called only when
 * `MCP_ENABLED` is on: with it off, none of these paths exist and they fall
 * through to the app's 404.
 *
 * Plain Hono, before the oRPC catch-all: the caller is an AI app with a
 * personal API key (`Authorization: Bearer ov_…`), never a browser session.
 * A browser request from another site is refused by Origin validation
 * (`@modelcontextprotocol/hono`); clients that send no Origin (Claude Code,
 * Cursor, scripts, vendor clouds) pass on to bearer authentication.
 */
export function registerAiAppsRoutes(
  app: Hono,
  options: { http: AiAppsHttp | null; allowedOriginHosts: string[] },
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
