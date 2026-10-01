import { telegramAccount } from "@openhealth/db/schema/integrations";
import {
  issueConnectToken,
  TelegramConnectTokenError,
  verifyConnectToken,
  writeTelegramAuditLog,
} from "@openhealth/telegram";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure, raiseApiError, validateInput } from "../index";

/**
 * Telegram connect-token procedures (Issue #14).
 *
 * These are the server-side primitives the Phase 5 web UI will call: issue a
 * short-lived deep-link token bound to the active org, then bind a chat id once
 * the user completes the `/start <token>` handshake. The public webhook itself
 * is a plain Hono route in `apps/server/src/index.ts`, not oRPC.
 */

const issueConnectTokenInput = z.object({});
const issueConnectTokenOutput = z.object({
  token: z.string(),
  expiresAt: z.string(),
});

const bindChatInput = z.object({
  token: z.string().min(1),
  chatId: z.string().min(1),
});
const bindChatOutput = z.object({
  telegramAccountId: z.string(),
});

export const telegramRouter = {
  status: protectedProcedure
    .use(validateInput(z.object({}).optional().default({})))
    .input(z.object({}).optional().default({}))
    .output(
      z.object({
        connected: z.boolean(),
        chatId: z.string().nullable(),
        status: z.string().nullable(),
        lastWebhookAt: z.string().nullable(),
      }),
    )
    .handler(async ({ context }) => {
      const userId = context.session?.user?.id;
      const organizationId = context.session?.session?.activeOrganizationId;
      if (!userId || !organizationId) {
        return { connected: false, chatId: null, status: null, lastWebhookAt: null };
      }
      const rows = await context.db
        .select({
          chatId: telegramAccount.telegramChatId,
          status: telegramAccount.status,
          lastWebhookAt: telegramAccount.lastWebhookAt,
        })
        .from(telegramAccount)
        .where(
          and(
            eq(telegramAccount.userId, userId),
            eq(telegramAccount.organizationId, organizationId),
          ),
        )
        .orderBy(telegramAccount.createdAt)
        .limit(1);
      const row = rows[0];
      if (!row) return { connected: false, chatId: null, status: null, lastWebhookAt: null };
      return {
        connected: row.status === "active",
        chatId: row.chatId,
        status: row.status,
        lastWebhookAt: row.lastWebhookAt,
      };
    }),

  issueConnectToken: protectedProcedure
    .use(validateInput(issueConnectTokenInput))
    .input(issueConnectTokenInput)
    .output(issueConnectTokenOutput)
    .handler(async ({ context }) => {
      const userId = context.session?.user?.id;
      const organizationId = context.session?.session?.activeOrganizationId;

      if (!userId || !organizationId) {
        throw raiseApiError("UNAUTHENTICATED", "An active organization is required.");
      }

      return issueConnectToken(
        {
          userId,
          organizationId,
          expiresInSeconds: context.telegram.connectTokenTtlSeconds,
        },
        context.telegram.webhookSecret,
      );
    }),

  bindChat: protectedProcedure
    .use(validateInput(bindChatInput))
    .input(bindChatInput)
    .output(bindChatOutput)
    .handler(async ({ input, context }) => {
      let payload: Awaited<ReturnType<typeof verifyConnectToken>>;
      try {
        payload = await verifyConnectToken(input.token, context.telegram.webhookSecret);
      } catch (error) {
        if (error instanceof TelegramConnectTokenError) {
          throw raiseApiError("INVALID_INPUT", "Connect token is invalid or expired.");
        }
        throw error;
      }

      const nowIso = new Date().toISOString();

      // Revoke any existing active account for the user first so the partial
      // unique index (`telegram_account_user_id_active_key`) is not violated.
      await context.db
        .update(telegramAccount)
        .set({ status: "revoked" })
        .where(
          and(eq(telegramAccount.userId, payload.userId), eq(telegramAccount.status, "active")),
        );

      const rows = await context.db
        .insert(telegramAccount)
        .values({
          organizationId: payload.organizationId,
          userId: payload.userId,
          telegramChatId: input.chatId,
          // For the `/start` connect flow the chat id is the private chat with
          // the user, which is also their Telegram user id.
          telegramUserId: input.chatId,
          status: "active",
          connectedAt: nowIso,
          lastWebhookAt: nowIso,
        })
        .onConflictDoUpdate({
          target: telegramAccount.telegramChatId,
          set: {
            organizationId: payload.organizationId,
            userId: payload.userId,
            telegramUserId: input.chatId,
            status: "active",
            connectedAt: nowIso,
            lastWebhookAt: nowIso,
          },
        })
        .returning({ id: telegramAccount.id });

      const id = rows[0]?.id;
      if (typeof id !== "number") {
        throw raiseApiError("INTERNAL", "Failed to link the Telegram account.");
      }

      await writeTelegramAuditLog({
        db: context.db,
        eventType: "TELEGRAM_BIND_COMPLETED",
        organizationId: payload.organizationId,
        actorUserId: payload.userId,
        targetType: "telegram_account",
        targetId: String(id),
        correlationId: context.correlationId,
        metadata: { resource: "telegram_account", action: "connect" },
      });

      return { telegramAccountId: String(id) };
    }),
};
