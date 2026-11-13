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

export type McpConfig = {
  enabled: boolean;
  rateLimits: { perGrantPerMinute: number; perMemberPerMinute: number };
};

export type McpEnv = {
  MCP_ENABLED?: boolean | string | null;
  DEPLOYMENT_MODE?: string | null;
  MCP_RATE_LIMIT_PER_GRANT_PER_MINUTE?: number | string | null;
  MCP_RATE_LIMIT_PER_MEMBER_PER_MINUTE?: number | string | null;
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
  };
}

export function describeMcpIntegration(
  config: McpConfig,
): IntegrationStatus<typeof MCP_PROVIDER_ID> {
  return config.enabled
    ? { provider: MCP_PROVIDER_ID, state: "configured" }
    : { provider: null, state: "off" };
}
