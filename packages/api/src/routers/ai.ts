import {
  AiConfigError,
  AiConsentError,
  healthSnapshotTool,
  markerTrendTool,
  requireAiConsent,
  streamChat,
  type AiChatMessage,
} from "@openhealth/ai";
import { writeAuditLog, type AuditEventType } from "@openhealth/audit-security";
import { AuthzHttpError, requireOrgMembership } from "@openhealth/auth/authz/guard";
import type { Database } from "@openhealth/db";
import { chatMessage } from "@openhealth/db/schema/coach";
import { createStructuredLogger } from "@openhealth/observability";
import { z } from "zod";

import { protectedProcedure, raiseApiError, validateInput } from "../index";

/**
 * AI chat procedure (Issue #13, MVP).
 *
 * Scope: one streaming-capable chat procedure behind the org AI-consent gate
 * and a per-`(userId, organizationId)` rate limit. The assistant reply is
 * **aggregated** and persisted to `chatMessage`; it is intentionally absent
 * from the oRPC response (privacy + cost).
 *
 * TODO(#13-streaming): return true token streaming via oRPC's `streamed(...)`
 * helper once the client contract for streaming lands.
 * TODO(#13-ui): no web/native chat route is wired in Issue #13 — this is Phase 2
 * infrastructure; the Phase 5 UI will call `ai.chat` through the oRPC client.
 * TODO(#13b): coach policy engine.
 * TODO(#13c): the remaining 8 domain tools (`labs`, `panelCompare`,
 * `outOfRange`, `bodyComp`, `weightTrend`, `supplements`, `goals`,
 * `timelineSummary`).
 * TODO(#13d): `ai.extract` + `ai.insights` procedures.
 * TODO(#13e): context minimization (`buildContextWithScope`).
 * TODO(#13f): scheduled streaming insights / auto-summarization.
 */

const logger = createStructuredLogger({ level: "info" });

const chatInput = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().min(1).max(10000),
      }),
    )
    .min(1)
    .max(50),
});

const chatOutput = z.object({
  status: z.literal("ok"),
  chunks: z.number(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
  model: z.string(),
  correlationId: z.string(),
});

/** The demo tool set wired into chat. The other 8 tools are deferred (#13c). */
const chatTools = {
  healthSnapshot: healthSnapshotTool,
  markerTrend: markerTrendTool,
};

// TODO(audit-taxonomy): `AI_CHAT_*` are not yet members of the closed
// `AuditEventType` union (#14). Cast at the boundary and drop the cast once the
// taxonomy lands.
type AiAuditEventType = "AI_CHAT_REQUESTED" | "AI_CHAT_COMPLETED" | "AI_CHAT_FAILED";

async function writeAiAudit(input: {
  db: Database;
  organizationId: string;
  userId: string;
  eventType: AiAuditEventType;
  correlationId: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  await writeAuditLog({
    db: input.db,
    organizationId: input.organizationId,
    actorUserId: input.userId,
    eventType: input.eventType as unknown as AuditEventType,
    targetType: "ai_chat",
    correlationId: input.correlationId,
    metadata: input.metadata,
  });
}

export const aiRouter = {
  chat: protectedProcedure
    .use(validateInput(chatInput))
    .input(chatInput)
    .output(chatOutput)
    .handler(async ({ input, context }) => {
      const correlationId = context.correlationId;

      // 1. Active-org membership (Issue #6 guard).
      let authz;
      try {
        authz = await requireOrgMembership(context.honoContext);
      } catch (error) {
        if (error instanceof AuthzHttpError) {
          throw raiseApiError(error.code, error.message);
        }
        throw error;
      }
      const userId = authz.user.id;
      const organizationId = authz.activeOrganizationId;

      // 2. Consent gate — default disabled, `403 AI_DISABLED` otherwise.
      try {
        await requireAiConsent(context.db, organizationId, "chat");
      } catch (error) {
        if (error instanceof AiConsentError) {
          logger.warn("ai.chat.consent_blocked", {
            correlationId,
            organizationId,
            status: 403,
            outcome: "blocked",
          });
          throw raiseApiError("AI_DISABLED", error.message);
        }
        throw error;
      }

      // 3. Rate limit per (userId, organizationId).
      const rate = context.aiRateLimiter.check(`${userId}:${organizationId}`);
      if (!rate.allowed) {
        logger.warn("ai.chat.rate_limited", {
          correlationId,
          organizationId,
          status: 429,
          retryAfterMs: rate.retryAfterMs,
        });
        throw raiseApiError("RATE_LIMITED", "AI usage limit reached. Try again later.", {
          retryAfterMs: rate.retryAfterMs,
        });
      }

      const model = context.aiConfig.AI_MODEL;
      const messages: AiChatMessage[] = input.messages;

      logger.info("ai.chat.requested", {
        correlationId,
        organizationId,
        model,
        messageCount: messages.length,
      });

      // 4. Audit the request before the provider call.
      await writeAiAudit({
        db: context.db,
        organizationId,
        userId,
        eventType: "AI_CHAT_REQUESTED",
        correlationId,
        metadata: { model, messageCount: messages.length },
      });

      const startedAt = Date.now();

      try {
        const result = await streamChat({
          config: context.aiConfig,
          messages,
          correlationId,
          tools: chatTools,
          logger,
        });

        // 5. Persist the turn. `chatMessage` has no correlation column, so the
        // correlation id is stored as the conversation id (org-scoped).
        const conversationId = correlationId;
        const rows = [
          ...messages.map((message) => ({
            organizationId,
            conversationId,
            role: message.role,
            content: message.content,
          })),
          {
            organizationId,
            conversationId,
            role: "assistant" as const,
            content: result.text,
          },
        ];
        await context.db.insert(chatMessage).values(rows);

        logger.info("ai.chat.completed", {
          correlationId,
          organizationId,
          model: result.model,
          chunks: result.totalChunks,
          durationMs: Date.now() - startedAt,
        });

        // 6. Audit success.
        await writeAiAudit({
          db: context.db,
          organizationId,
          userId,
          eventType: "AI_CHAT_COMPLETED",
          correlationId,
          metadata: {
            model: result.model,
            chunks: result.totalChunks,
            inputTokens: result.usage?.inputTokens,
            outputTokens: result.usage?.outputTokens,
          },
        });

        return {
          status: "ok" as const,
          chunks: result.totalChunks,
          ...(result.usage ? { usage: result.usage } : {}),
          model: result.model,
          correlationId,
        };
      } catch (error) {
        const errorCode = error instanceof AiConfigError ? error.code : "AI_PROVIDER_FAILURE";

        logger.error("ai.chat.failed", {
          correlationId,
          organizationId,
          model,
          durationMs: Date.now() - startedAt,
          error,
        });

        await writeAiAudit({
          db: context.db,
          organizationId,
          userId,
          eventType: "AI_CHAT_FAILED",
          correlationId,
          metadata: { model, errorCode },
        });

        if (error instanceof AiConfigError) {
          throw raiseApiError("INTERNAL", "AI provider is not configured.");
        }
        throw raiseApiError("INTERNAL", "AI provider failure.");
      }
    }),
};
