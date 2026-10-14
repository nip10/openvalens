import {
  AiConfigError,
  AiConsentError,
  CURRENT_CONSENT_VERSION,
  createAiHealthTools,
  extractStructured,
  generateInsight,
  readUserAiConsent,
  requireAiConsent,
  streamChat,
  type AiChatMessage,
} from "@openvalens/ai";
import { writeAuditLog, type AuditEventType } from "@openvalens/audit-security";
import {
  AuthzHttpError,
  requireOrgMembership,
  requirePermission,
} from "@openvalens/auth/authz/guard";
import type { Database } from "@openvalens/db";
import { userAiConsent } from "@openvalens/db/schema/auth";
import { chatMessage } from "@openvalens/db/schema/coach";
import { createStructuredLogger } from "@openvalens/observability";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure, raiseApiError, validateInput } from "../index";

/**
 * AI chat procedures (Issue #13).
 *
 * Three procedures today:
 *
 * - `ai.chat`         — protected; rate-limited; consent-gated; turns a
 *   client-provided message array into one assistant reply and persists
 *   every message under a shared `conversationId`. The `conversationId`
 *   is supplied by the client so a multi-turn thread round-trips intact.
 * - `ai.listThreads`   — read; one entry per distinct `conversationId` for
 *   the active org, with the latest message preview + message count.
 * - `ai.listMessages`  — read; all messages for one thread, oldest-first.
 *
 * Cross-domain reads are bound through the {@link createCockpitFacades}
 * factory: each facade receives its own domain read function, never
 * reaches into another package's tables directly. The facades can
 * be swapped out at test time so each procedure is fully
 * deterministic and never touches real DBs.
 *
 * No PHI is logged. Review notes round-trip as opaque strings the
 * caller owns. Logs contain only counts, IDs, and the correlation id.
 */

const logger = createStructuredLogger({ level: "info" });

const chatInput = z.strictObject({
  conversationId: z.string().min(1).max(80).optional(),
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
  conversationId: z.string(),
  chunks: z.number(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
  model: z.string(),
  correlationId: z.string(),
});

/**
 * `records:read` check the chat health tools re-run on every execution
 * (Issue #124). Resolves `false` instead of throwing so a denied tool call
 * becomes an honest "unavailable" tool result rather than a failed chat turn.
 * The remaining tools are tracked in #130.
 */
function createRecordsReadCheck(honoContext: Parameters<typeof requirePermission>[0]) {
  return async (): Promise<boolean> => {
    try {
      await requirePermission(honoContext, { resource: "records", action: "read" });
      return true;
    } catch {
      return false;
    }
  };
}

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

const threadShape = z.object({
  conversationId: z.string(),
  lastMessageAt: z.string(),
  lastMessagePreview: z.string(),
  messageCount: z.number(),
});

const messageShape = z.object({
  id: z.number(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  createdAt: z.string(),
});

/** Per-user AI consent state (Issue #123). Timestamps are ISO-8601 strings. */
const userAiConsentStateShape = z.object({
  granted: z.boolean(),
  grantedAt: z.string(),
  revokedAt: z.string().nullable(),
  consentVersion: z.string(),
});

/** Consent procedures take no input. */
const emptyInput = z.strictObject({});

export const aiRouter = {
  chat: protectedProcedure
    .use(validateInput(chatInput))
    .input(chatInput)
    .output(chatOutput)
    .handler(async ({ input, context }) => {
      const correlationId = context.correlationId;

      // 1. Active-org membership.
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

      // 2. Consent gate (org + per-user, Issue #123).
      try {
        await requireAiConsent(context.db, organizationId, "chat", userId);
      } catch (error) {
        if (error instanceof AiConsentError) {
          logger.warn("ai.chat.consent_blocked", {
            correlationId,
            organizationId,
          });
          throw raiseApiError("AI_DISABLED", "AI processing is disabled by org policy.");
        }
        throw raiseApiError("INTERNAL", "Consent check failed.");
      }

      // 3. Rate limit.
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
      const conversationId = input.conversationId ?? correlationId;

      logger.info("ai.chat.requested", {
        correlationId,
        organizationId,
        model,
        messageCount: messages.length,
        conversationId,
      });

      await writeAiAudit({
        db: context.db,
        organizationId,
        userId,
        eventType: "AI_CHAT_REQUESTED",
        correlationId,
        metadata: { model, messageCount: messages.length, conversationId },
      });

      const startedAt = Date.now();

      try {
        const result = await streamChat({
          config: context.aiConfig,
          messages,
          correlationId,
          // Built per request: bound to the session's org + user, never input.
          tools: createAiHealthTools({
            db: context.db,
            organizationId,
            userId,
            canReadRecords: createRecordsReadCheck(context.honoContext),
            correlationId,
            logger,
          }),
          logger,
        });

        // Persist the turn under the shared conversationId.
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
            conversationId,
          },
        });

        return {
          status: "ok" as const,
          conversationId,
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
          metadata: { model, errorCode, conversationId },
        });

        if (error instanceof AiConfigError) {
          throw raiseApiError("INTERNAL", "AI provider is not configured.");
        }
        throw raiseApiError("INTERNAL", "AI provider failure.");
      }
    }),

  listThreads: protectedProcedure
    .use(validateInput(z.strictObject({ limit: z.number().int().min(1).max(100).optional() })))
    .input(z.strictObject({ limit: z.number().int().min(1).max(100).optional() }))
    .output(z.array(threadShape))
    .handler(async ({ input, context }) => {
      let authz;
      try {
        authz = await requireOrgMembership(context.honoContext);
      } catch (error) {
        if (error instanceof AuthzHttpError) {
          throw raiseApiError(error.code, error.message);
        }
        throw error;
      }
      const organizationId = authz.activeOrganizationId;
      const safeLimit = input.limit ?? 50;

      const rows = await context.db
        .select({
          conversationId: chatMessage.conversationId,
          lastMessageAt: chatMessage.createdAt,
          role: chatMessage.role,
          content: chatMessage.content,
          id: chatMessage.id,
        })
        .from(chatMessage)
        .where(eq(chatMessage.organizationId, organizationId))
        .orderBy(desc(chatMessage.createdAt), desc(chatMessage.id))
        .limit(500);

      const byConversation = new Map<
        string,
        { lastMessageAt: string; lastContent: string; count: number }
      >();
      for (const row of rows) {
        const existing = byConversation.get(row.conversationId);
        if (existing) {
          existing.count += 1;
        } else {
          byConversation.set(row.conversationId, {
            lastMessageAt: row.lastMessageAt,
            lastContent: row.content,
            count: 1,
          });
        }
      }

      return Array.from(byConversation.entries())
        .map(([conversationId, info]) => ({
          conversationId,
          lastMessageAt: info.lastMessageAt,
          lastMessagePreview: info.lastContent.slice(0, 200),
          messageCount: info.count,
        }))
        .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1))
        .slice(0, safeLimit);
    }),

  listMessages: protectedProcedure
    .use(
      validateInput(
        z.strictObject({
          conversationId: z.string().min(1).max(80),
        }),
      ),
    )
    .input(z.strictObject({ conversationId: z.string().min(1).max(80) }))
    .output(z.array(messageShape))
    .handler(async ({ input, context }) => {
      let authz;
      try {
        authz = await requireOrgMembership(context.honoContext);
      } catch (error) {
        if (error instanceof AuthzHttpError) {
          throw raiseApiError(error.code, error.message);
        }
        throw error;
      }
      const organizationId = authz.activeOrganizationId;
      const rows = await context.db
        .select({
          id: chatMessage.id,
          role: chatMessage.role,
          content: chatMessage.content,
          createdAt: chatMessage.createdAt,
        })
        .from(chatMessage)
        .where(
          and(
            eq(chatMessage.organizationId, organizationId),
            eq(chatMessage.conversationId, input.conversationId),
          ),
        )
        .orderBy(chatMessage.id);
      return rows.map((row: { id: number; role: string; content: string; createdAt: string }) => ({
        id: row.id,
        role: row.role as "user" | "assistant" | "system",
        content: row.content,
        createdAt: row.createdAt,
      }));
    }),

  extract: protectedProcedure
    .use(
      validateInput(
        z.strictObject({
          text: z.string().min(1).max(20_000),
          promptHint: z.string().min(1).max(500),
          jsonShape: z.string().min(1).max(1000),
        }),
      ),
    )
    .input(
      z.strictObject({
        text: z.string().min(1).max(20_000),
        promptHint: z.string().min(1).max(500),
        jsonShape: z.string().min(1).max(1000),
      }),
    )
    .output(
      z.object({
        // `unparseable` (Issue #59): no attempt produced valid JSON; `data` is
        // then `null` — values are never invented.
        status: z.enum(["ok", "unparseable"]),
        data: z.unknown(),
        model: z.string(),
      }),
    )
    .handler(async ({ input, context }) => {
      let authz;
      try {
        authz = await requireOrgMembership(context.honoContext);
      } catch (error) {
        if (error instanceof AuthzHttpError) throw raiseApiError(error.code, error.message);
        throw raiseApiError("INTERNAL", "Authorization failed.");
      }
      await requireAiConsent(context.db, authz.activeOrganizationId, "insights", authz.user.id);
      try {
        const result = await extractStructured({
          config: context.aiConfig,
          text: input.text,
          promptHint: input.promptHint,
          jsonShape: input.jsonShape,
        });
        return { status: result.status, data: result.data, model: result.model };
      } catch (error) {
        if (error instanceof AiConfigError) {
          throw raiseApiError("INTERNAL", "AI provider is not configured.");
        }
        throw raiseApiError("INTERNAL", "AI extraction failed.");
      }
    }),

  generateInsight: protectedProcedure
    .use(
      validateInput(
        z.strictObject({
          topic: z.string().min(1).max(120),
          snapshot: z.unknown(),
        }),
      ),
    )
    .input(
      z.strictObject({
        topic: z.string().min(1).max(120),
        snapshot: z.unknown(),
      }),
    )
    .output(
      z.object({
        title: z.string(),
        body: z.string(),
        severity: z.enum(["info", "warning", "critical"]),
        model: z.string(),
      }),
    )
    .handler(async ({ input, context }) => {
      let authz;
      try {
        authz = await requireOrgMembership(context.honoContext);
      } catch (error) {
        if (error instanceof AuthzHttpError) throw raiseApiError(error.code, error.message);
        throw raiseApiError("INTERNAL", "Authorization failed.");
      }
      await requireAiConsent(context.db, authz.activeOrganizationId, "insights", authz.user.id);
      try {
        const result = await generateInsight({
          config: context.aiConfig,
          topic: input.topic,
          snapshot: input.snapshot,
        });
        return {
          title: result.title,
          body: result.body,
          severity: result.severity,
          model: result.model,
        };
      } catch (error) {
        if (error instanceof AiConfigError) {
          throw raiseApiError("INTERNAL", "AI provider is not configured.");
        }
        throw raiseApiError("INTERNAL", "AI insight failed.");
      }
    }),

  /**
   * Per-user AI consent (Issue #123).
   *
   * `get` reads the caller's own consent row (or `null` when none exists);
   * `grant`/`revoke` upsert it. This gate is deliberately independent of
   * organization role — an org owner still needs their own grant — and is
   * enforced *in addition to* the org-level `organization.metadata.aiConsent`
   * gate for every AI call.
   */
  consent: {
    get: protectedProcedure
      .use(validateInput(emptyInput))
      .input(emptyInput)
      .output(userAiConsentStateShape.nullable())
      .handler(async ({ context }) => {
        let authz;
        try {
          authz = await requireOrgMembership(context.honoContext);
        } catch (error) {
          if (error instanceof AuthzHttpError) throw raiseApiError(error.code, error.message);
          throw raiseApiError("INTERNAL", "Authorization failed.");
        }

        return readUserAiConsent(context.db, authz.user.id);
      }),

    grant: protectedProcedure
      .use(validateInput(emptyInput))
      .input(emptyInput)
      .output(userAiConsentStateShape)
      .handler(async ({ context }) => {
        let authz;
        try {
          authz = await requireOrgMembership(context.honoContext);
        } catch (error) {
          if (error instanceof AuthzHttpError) throw raiseApiError(error.code, error.message);
          throw raiseApiError("INTERNAL", "Authorization failed.");
        }

        const userId = authz.user.id;
        const now = new Date();

        try {
          await context.db
            .insert(userAiConsent)
            .values({
              userId,
              granted: true,
              grantedAt: now,
              revokedAt: null,
              source: "api",
              consentVersion: CURRENT_CONSENT_VERSION,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: userAiConsent.userId,
              set: {
                granted: true,
                grantedAt: now,
                revokedAt: null,
                source: "api",
                consentVersion: CURRENT_CONSENT_VERSION,
                updatedAt: now,
              },
            });
        } catch {
          throw raiseApiError("INTERNAL", "Consent update failed.");
        }

        logger.info("ai.consent.granted", {
          correlationId: context.correlationId,
          consentVersion: CURRENT_CONSENT_VERSION,
        });

        const state = await readUserAiConsent(context.db, userId);
        if (state === null) {
          throw raiseApiError("INTERNAL", "Consent update failed.");
        }
        return state;
      }),

    revoke: protectedProcedure
      .use(validateInput(emptyInput))
      .input(emptyInput)
      .output(userAiConsentStateShape)
      .handler(async ({ context }) => {
        let authz;
        try {
          authz = await requireOrgMembership(context.honoContext);
        } catch (error) {
          if (error instanceof AuthzHttpError) throw raiseApiError(error.code, error.message);
          throw raiseApiError("INTERNAL", "Authorization failed.");
        }

        const userId = authz.user.id;
        const now = new Date();

        try {
          await context.db
            .insert(userAiConsent)
            .values({
              userId,
              granted: false,
              grantedAt: now,
              revokedAt: now,
              source: "api",
              consentVersion: CURRENT_CONSENT_VERSION,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: userAiConsent.userId,
              set: {
                granted: false,
                revokedAt: now,
                source: "api",
                consentVersion: CURRENT_CONSENT_VERSION,
                updatedAt: now,
              },
            });
        } catch {
          throw raiseApiError("INTERNAL", "Consent update failed.");
        }

        logger.info("ai.consent.revoked", {
          correlationId: context.correlationId,
          consentVersion: CURRENT_CONSENT_VERSION,
        });

        const state = await readUserAiConsent(context.db, userId);
        if (state === null) {
          throw raiseApiError("INTERNAL", "Consent update failed.");
        }
        return state;
      }),
  },
};
