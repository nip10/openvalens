import type { Database } from "@openvalens/db";
import { createStructuredLogger, type StructuredLogger } from "@openvalens/observability";

import { AiConsentError, requireAiConsent, type AiConsentScope } from "../consent";
import { createDomainHealthToolSources, type AiHealthToolSources } from "./sources";

/**
 * Per-request access context for the AI health tools (Issue #124).
 *
 * The tools are built per chat request and close over the caller's identity
 * from the server session. Tool input never carries an organization or user
 * id, so the model cannot widen the tenant boundary.
 */
export type AiHealthToolContext = {
  db: Database;
  /** Active organization from server-side authz. */
  organizationId: string;
  /** Session user; the per-user consent gate is checked against it. */
  userId: string;
  /**
   * Re-checks the caller's `records:read` permission. Resolves `false` (never
   * throws) when the permission is missing; called on every tool execution.
   */
  canReadRecords: () => Promise<boolean>;
  correlationId?: string;
  /** Test seam: replace the domain read ports. */
  sources?: AiHealthToolSources;
  /** Test seam: clock. */
  now?: () => Date;
  logger?: StructuredLogger;
};

/**
 * Consent scope the health tools require. Reading health records into a model
 * prompt is data processing beyond plain conversation, so a `chat`-only org
 * grant is not enough.
 */
export const AI_HEALTH_TOOL_SCOPE: AiConsentScope = "insights";

export type AiToolUnavailableReason = "permission_denied" | "consent_required";

export type ResolvedToolAccess =
  | { allowed: true; sources: AiHealthToolSources; now: Date; logger: StructuredLogger }
  | { allowed: false; reason: AiToolUnavailableReason; now: Date; logger: StructuredLogger };

/**
 * Fresh permission + consent check performed at tool execution time (not when
 * the tool list is built), so a revoked grant or a downgraded role takes effect
 * on the very next call. Fails closed on any unexpected error.
 */
export async function resolveToolAccess(
  context: AiHealthToolContext,
  toolName: string,
): Promise<ResolvedToolAccess> {
  const now = context.now?.() ?? new Date();
  const logger = context.logger ?? createStructuredLogger({ level: "info" });

  let permitted = false;
  try {
    permitted = await context.canReadRecords();
  } catch {
    permitted = false;
  }
  if (!permitted) {
    logger.warn("ai.tool.blocked", {
      correlationId: context.correlationId,
      organizationId: context.organizationId,
      tool: toolName,
      reason: "permission_denied",
    });
    return { allowed: false, reason: "permission_denied", now, logger };
  }

  try {
    await requireAiConsent(
      context.db,
      context.organizationId,
      AI_HEALTH_TOOL_SCOPE,
      context.userId,
    );
  } catch (error) {
    logger.warn("ai.tool.blocked", {
      correlationId: context.correlationId,
      organizationId: context.organizationId,
      tool: toolName,
      reason: "consent_required",
      ...(error instanceof AiConsentError ? {} : { error }),
    });
    return { allowed: false, reason: "consent_required", now, logger };
  }

  return {
    allowed: true,
    sources: context.sources ?? createDomainHealthToolSources(context.db),
    now,
    logger,
  };
}

/**
 * Emits the value-free `ai.tool.executed` line. `counts` must hold statuses,
 * counts and booleans only — never a measured value, date or model input.
 */
export function logToolExecuted(
  context: AiHealthToolContext,
  logger: StructuredLogger,
  toolName: string,
  status: string,
  counts: Record<string, number | boolean | string> = {},
): void {
  logger.info("ai.tool.executed", {
    correlationId: context.correlationId,
    organizationId: context.organizationId,
    tool: toolName,
    status,
    ...counts,
  });
}
