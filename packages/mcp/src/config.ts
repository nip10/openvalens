import type { IntegrationStatus } from "@openvalens/config/integrations";

/**
 * `mcp` integration family (Issue #439): the MCP server and the REST tool API
 * that let a member point an AI app (Claude, ChatGPT, Cursor, a local model)
 * at their own records.
 *
 * - **Self-host:** off until the operator sets `MCP_ENABLED=true`.
 * - **Cloud:** on unless the operator sets `MCP_ENABLED=false`.
 *
 * With the family off the server mounts no MCP or REST tool route, the grant
 * procedures answer `NOT_FOUND`, and readiness reports `mcp: off`. It needs no
 * vendor account either way: the server itself is the provider.
 *
 * Pure: takes explicit env values, never reads `process.env`.
 */

export const MCP_PROVIDER_ID = "openvalens";

/** Default per-grant budget (the issue's 60 calls a minute). */
export const DEFAULT_MCP_RATE_LIMIT_PER_GRANT = 60;
/** Default per-member budget across all of their grants (120 a minute). */
export const DEFAULT_MCP_RATE_LIMIT_PER_MEMBER = 120;

/** Default most entries one write call may hold (M2). */
export const DEFAULT_MCP_WRITE_ENTRIES_PER_CALL = 100;
/** Default most entries one grant may write in 24 hours (M2). */
export const DEFAULT_MCP_WRITE_ENTRIES_PER_DAY = 1_000;

export type McpConfig = {
  enabled: boolean;
  rateLimits: { perGrantPerMinute: number; perMemberPerMinute: number };
  /**
   * Write limits (M2): entries per call and per grant in any 24 hours. Larger
   * imports go through the app's own import flows.
   */
  writeLimits: { entriesPerCall: number; entriesPerDay: number };
};

export type McpEnv = {
  MCP_ENABLED?: boolean | string | null;
  DEPLOYMENT_MODE?: string | null;
  MCP_RATE_LIMIT_PER_GRANT_PER_MINUTE?: number | string | null;
  MCP_RATE_LIMIT_PER_MEMBER_PER_MINUTE?: number | string | null;
  MCP_WRITE_ENTRIES_PER_CALL?: number | string | null;
  MCP_WRITE_ENTRIES_PER_DAY?: number | string | null;
};

function readBoolean(value: boolean | string | null | undefined): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return null;
}

function readLimit(value: number | string | null | undefined, fallback: number): number {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof parsed === "number" && Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseMcpConfig(env: McpEnv): McpConfig {
  const explicit = readBoolean(env.MCP_ENABLED);
  const cloud = env.DEPLOYMENT_MODE?.trim().toLowerCase() === "cloud";
  return {
    enabled: explicit ?? cloud,
    rateLimits: {
      perGrantPerMinute: readLimit(
        env.MCP_RATE_LIMIT_PER_GRANT_PER_MINUTE,
        DEFAULT_MCP_RATE_LIMIT_PER_GRANT,
      ),
      perMemberPerMinute: readLimit(
        env.MCP_RATE_LIMIT_PER_MEMBER_PER_MINUTE,
        DEFAULT_MCP_RATE_LIMIT_PER_MEMBER,
      ),
    },
    writeLimits: {
      entriesPerCall: readLimit(env.MCP_WRITE_ENTRIES_PER_CALL, DEFAULT_MCP_WRITE_ENTRIES_PER_CALL),
      entriesPerDay: readLimit(env.MCP_WRITE_ENTRIES_PER_DAY, DEFAULT_MCP_WRITE_ENTRIES_PER_DAY),
    },
  };
}

/** Streamable HTTP MCP endpoint; also the OAuth resource path (RFC 8707). */
export const MCP_ENDPOINT_PATH = "/api/mcp";
/** RFC 9728 protected resource metadata, root form. */
export const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";
/** Web pages of the OAuth flow (Issue #439, M1b). */
export const OAUTH_LOGIN_PAGE_PATH = "/oauth/login";
export const OAUTH_CONSENT_PAGE_PATH = "/oauth/consent";

export type McpOAuthEndpoints = {
  /** Canonical resource every access token is bound to: `<server>/api/mcp`. */
  resource: string;
  /** RFC 9728 path-inserted metadata URL for the resource. */
  resourceMetadataUrl: string;
  loginPage: string;
  consentPage: string;
};

/**
 * OAuth endpoints for connected AI apps, derived from the server URL
 * (`BETTER_AUTH_URL`) and the web origin (`CORS_ORIGIN`). `null` when the
 * server URL is plain HTTP on a non-loopback host: OAuth needs HTTPS (web
 * connectors call from the vendor's cloud), so such a server offers personal
 * keys only.
 */
export function mcpOAuthEndpointsFor(input: {
  serverUrl: string;
  webOrigin: string;
}): McpOAuthEndpoints | null {
  let server: URL;
  let web: URL;
  try {
    server = new URL(input.serverUrl);
    web = new URL(input.webOrigin);
  } catch {
    return null;
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(server.hostname);
  if (server.protocol !== "https:" && !(server.protocol === "http:" && loopback)) return null;
  return {
    resource: `${server.origin}${MCP_ENDPOINT_PATH}`,
    resourceMetadataUrl: `${server.origin}${PROTECTED_RESOURCE_METADATA_PATH}${MCP_ENDPOINT_PATH}`,
    loginPage: `${web.origin}${OAUTH_LOGIN_PAGE_PATH}`,
    consentPage: `${web.origin}${OAUTH_CONSENT_PAGE_PATH}`,
  };
}

export function describeMcpIntegration(
  config: McpConfig,
): IntegrationStatus<typeof MCP_PROVIDER_ID> {
  return config.enabled
    ? { provider: MCP_PROVIDER_ID, state: "configured" }
    : { provider: null, state: "off" };
}
