import { InMemoryRateLimiter } from "@openvalens/ai/rate-limit";
import type { Database } from "@openvalens/db";
import { createStructuredLogger, type StructuredLogger } from "@openvalens/observability";
import {
  createMcpHandler,
  McpServer,
  type AuthInfo,
  type CallToolResult,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import type { McpConfig } from "./config";
import { safeTimeZone, ToolInputError } from "./format";
import type { AiAppAuthFailure, AiAppGrantPrincipal, AiAppsService } from "./grants";
import { hasScope } from "./scopes";
import type { McpDataSources } from "./sources";
import { findTool, toolsForScopes, type McpToolContext, type McpToolDefinition } from "./tools";

/**
 * HTTP faces of connected AI apps (Issue #439): the MCP server at
 * `/api/mcp` (Streamable HTTP, MCP TypeScript SDK v2, 2025-era clients served
 * through the stateless legacy fallback) and the REST tool API at
 * `POST /api/v1/tools/<name>`. Both run the same tool definitions.
 *
 * Every request:
 *
 * 1. authenticates `Authorization: Bearer ov_…` against its grant (never a
 *    cookie session), re-checking revoke, expiry, ownership and the
 *    workspace switch;
 * 2. counts against 60 calls a minute per grant and 120 per member (env), and
 *    is answered `429` with `Retry-After` past either;
 * 3. records one usage row per tool call: grant, tool, time, status and row
 *    count, never the arguments or results.
 *
 * Framework-free: each face takes a web `Request` and returns a `Response`;
 * the server mounts them on Hono.
 */

export const MCP_SERVER_NAME = "openvalens";

/** The intended-purpose statement every MCP client receives (`instructions`). */
export const MCP_SERVER_INSTRUCTIONS = [
  "OpenValens holds one person's own wellness records: labs, sleep, workouts, vitals, weight, body composition, supplements, goals and, when they allow it, nutrition, private body measurements and notes.",
  "Every tool returns the member's recorded values as stored, with units, ISO 8601 times with the member's UTC offset and days in the member's time zone. Results are facts only, with no interpretation beyond the flags the app already shows.",
  "OpenValens is a personal record-keeping and wellness tool. It is not a medical device and does not give medical advice, diagnosis or treatment. Do not present its data as a diagnosis; encourage the member to talk to a qualified health professional about medical questions.",
  "Cycle data and progress photos are never available through this server.",
].join("\n\n");

export type AiAppsHttpOptions = {
  db: Database;
  service: AiAppsService;
  sources: McpDataSources;
  config: McpConfig;
  /** Reported as the server version to MCP clients. */
  version: string;
  logger?: StructuredLogger;
  now?: () => Date;
};

type Authorized = { principal: AiAppGrantPrincipal };

const FAILURE_MESSAGES: Record<AiAppAuthFailure, string> = {
  missing: "Send a personal API key as `Authorization: Bearer ov_…`.",
  invalid: "This key is not valid.",
  revoked: "This key was revoked.",
  expired: "This key has expired.",
  not_owner: "This key no longer has access to its workspace.",
  workspace_disabled: "The workspace owner has turned off connected AI apps.",
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

function authFailure(reason: AiAppAuthFailure): Response {
  if (reason === "workspace_disabled") {
    return json(403, { error: "access_denied", error_description: FAILURE_MESSAGES[reason] });
  }
  const error = reason === "missing" ? "invalid_request" : "invalid_token";
  return json(
    401,
    { error, error_description: FAILURE_MESSAGES[reason] },
    {
      "www-authenticate":
        reason === "missing"
          ? 'Bearer realm="OpenValens"'
          : `Bearer realm="OpenValens", error="invalid_token", error_description="${FAILURE_MESSAGES[reason]}"`,
    },
  );
}

type ToolOutcome =
  | { ok: true; result: unknown }
  | { ok: false; status: "insufficient_scope" | "invalid_input" | "error"; message: string };

export function createAiAppsHttp(options: AiAppsHttpOptions) {
  const logger = options.logger ?? createStructuredLogger({ level: "info" });
  const now = options.now ?? (() => new Date());
  const grantLimiter = new InMemoryRateLimiter({
    limitPerMinute: options.config.rateLimits.perGrantPerMinute,
    now: () => now().getTime(),
  });
  const memberLimiter = new InMemoryRateLimiter({
    limitPerMinute: options.config.rateLimits.perMemberPerMinute,
    now: () => now().getTime(),
  });
  // Keys are grant and member ids from the database, never caller input; still
  // swept so memory follows recent traffic only.
  setInterval(() => {
    grantLimiter.sweep();
    memberLimiter.sweep();
  }, 5 * 60_000).unref();

  async function authorize(
    request: Request,
    correlationId: string | undefined,
  ): Promise<Authorized | Response> {
    const auth = await options.service.authenticate(request.headers.get("authorization"), {
      correlationId,
    });
    if (!auth.ok) {
      logger.info("ai_apps.request.refused", { correlationId, reason: auth.reason });
      return authFailure(auth.reason);
    }
    const { principal } = auth;
    for (const [limiter, key] of [
      [grantLimiter, `grant:${principal.grantId}`],
      [memberLimiter, `member:${principal.userId}`],
    ] as const) {
      const decision = limiter.check(key);
      if (!decision.allowed) {
        const retryAfter = Math.max(1, Math.ceil((decision.retryAfterMs ?? 60_000) / 1000));
        logger.info("ai_apps.request.rate_limited", {
          correlationId,
          grantId: principal.grantId,
          scope: key.split(":")[0],
        });
        return json(
          429,
          {
            error: "rate_limited",
            error_description: `Too many calls. Try again in ${retryAfter} seconds.`,
          },
          { "retry-after": String(retryAfter) },
        );
      }
    }
    return { principal };
  }

  async function toolContext(
    principal: AiAppGrantPrincipal,
    correlationId: string | undefined,
  ): Promise<McpToolContext> {
    const preferences = await options.sources.preferences(principal);
    return {
      db: options.db,
      principal,
      sources: options.sources,
      now: now(),
      timeZone: safeTimeZone(preferences.timeZone),
      units: preferences.units,
      logger,
      correlationId,
    };
  }

  /** Runs one tool for one grant and records the call. */
  async function invoke(
    tool: McpToolDefinition,
    principal: AiAppGrantPrincipal,
    input: unknown,
    transport: "mcp" | "rest",
    correlationId: string | undefined,
  ): Promise<ToolOutcome> {
    if (!hasScope(principal.scopes, tool.scope)) {
      await options.service.recordCall({
        principal,
        tool: tool.name,
        transport,
        status: "insufficient_scope",
      });
      return {
        ok: false,
        status: "insufficient_scope",
        message: `This key does not have the ${tool.scope} scope needed by ${tool.name}.`,
      };
    }
    const parsed = tool.input.safeParse(input ?? {});
    if (!parsed.success) {
      await options.service.recordCall({
        principal,
        tool: tool.name,
        transport,
        status: "invalid_input",
      });
      return { ok: false, status: "invalid_input", message: z.prettifyError(parsed.error) };
    }
    try {
      const context = await toolContext(principal, correlationId);
      const { result, rowCount } = await tool.run(context, parsed.data);
      await options.service.recordCall({
        principal,
        tool: tool.name,
        transport,
        status: "ok",
        rowCount,
      });
      return { ok: true, result };
    } catch (error) {
      if (error instanceof ToolInputError) {
        await options.service.recordCall({
          principal,
          tool: tool.name,
          transport,
          status: "invalid_input",
        });
        return { ok: false, status: "invalid_input", message: error.message };
      }
      logger.error("ai_apps.tool.failed", {
        correlationId,
        grantId: principal.grantId,
        tool: tool.name,
        error,
      });
      await options.service.recordCall({ principal, tool: tool.name, transport, status: "error" });
      return { ok: false, status: "error", message: "The tool failed. Try again later." };
    }
  }

  function toCallToolResult(outcome: ToolOutcome): CallToolResult {
    if (outcome.ok) {
      const structured =
        outcome.result && typeof outcome.result === "object" && !Array.isArray(outcome.result)
          ? (outcome.result as Record<string, unknown>)
          : { result: outcome.result };
      return {
        content: [{ type: "text", text: JSON.stringify(outcome.result) }],
        structuredContent: structured,
      };
    }
    return { content: [{ type: "text", text: outcome.message }], isError: true };
  }

  /** One fresh MCP server per request, holding only the tools this grant may call. */
  function buildServer(
    principal: AiAppGrantPrincipal,
    correlationId: string | undefined,
  ): McpServer {
    const server = new McpServer(
      { name: MCP_SERVER_NAME, title: "OpenValens", version: options.version },
      { instructions: MCP_SERVER_INSTRUCTIONS },
    );
    for (const tool of toolsForScopes(principal.scopes)) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.input,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        async (args: unknown) =>
          toCallToolResult(await invoke(tool, principal, args, "mcp", correlationId)),
      );
    }
    return server;
  }

  const mcp = createMcpHandler(
    (context) => {
      const extra = context.authInfo?.extra as
        | { principal?: AiAppGrantPrincipal; correlationId?: string }
        | undefined;
      if (!extra?.principal) throw new Error("MCP request reached the server without a grant.");
      return buildServer(extra.principal, extra.correlationId);
    },
    {
      legacy: "stateless",
      onerror: (error) => logger.warn("ai_apps.mcp.request_error", { error }),
    },
  );

  /** `/api/mcp`: authenticate, rate-limit, then hand the request to the SDK. */
  async function handleMcp(request: Request, correlationId?: string): Promise<Response> {
    const authorized = await authorize(request, correlationId);
    if (authorized instanceof Response) return authorized;
    const authInfo: AuthInfo = {
      token: `grant:${authorized.principal.grantId}`,
      clientId: authorized.principal.grantId,
      scopes: [...authorized.principal.scopes],
      extra: { principal: authorized.principal, correlationId },
    };
    return mcp.fetch(request, { authInfo });
  }

  /** `POST /api/v1/tools/<name>`: the same tools as a small JSON contract. */
  async function handleRest(
    request: Request,
    name: string,
    correlationId?: string,
  ): Promise<Response> {
    const authorized = await authorize(request, correlationId);
    if (authorized instanceof Response) return authorized;
    const tool = findTool(name);
    if (!tool)
      return json(404, {
        error: "unknown_tool",
        error_description: `There is no tool named ${name}.`,
      });
    let body: unknown = {};
    const text = await request.text();
    if (text.trim()) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        return json(400, { error: "invalid_input", error_description: "The body must be JSON." });
      }
    }
    const outcome = await invoke(tool, authorized.principal, body, "rest", correlationId);
    if (outcome.ok) return json(200, { tool: tool.name, result: outcome.result });
    if (outcome.status === "insufficient_scope") {
      return json(
        403,
        { error: "insufficient_scope", error_description: outcome.message, scope: tool.scope },
        {
          "www-authenticate": `Bearer realm="OpenValens", error="insufficient_scope", scope="${tool.scope}"`,
        },
      );
    }
    if (outcome.status === "invalid_input") {
      return json(400, { error: "invalid_input", error_description: outcome.message });
    }
    return json(500, { error: "server_error", error_description: outcome.message });
  }

  /** `GET /api/v1/tools`: the tools this key may call, with their input schemas. */
  async function handleRestList(request: Request, correlationId?: string): Promise<Response> {
    const authorized = await authorize(request, correlationId);
    if (authorized instanceof Response) return authorized;
    return json(200, {
      tools: toolsForScopes(authorized.principal.scopes).map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        scope: tool.scope,
        inputSchema: z.toJSONSchema(tool.input),
      })),
    });
  }

  return Object.freeze({ handleMcp, handleRest, handleRestList, close: () => mcp.close() });
}

export type AiAppsHttp = ReturnType<typeof createAiAppsHttp>;
