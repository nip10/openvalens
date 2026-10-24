import {
  createConnectToken,
  disconnectTelegramChat,
  readTelegramConnection,
} from "@openvalens/telegram";
import { z } from "zod";

import { protectedProcedure, raiseApiError, validateInput } from "../index";

/**
 * Telegram connect procedures (Issue #14).
 *
 * `issueConnectToken` stores a one-time token for the member and returns the
 * `https://t.me/<bot>?start=<token>` link. Opening it sends `/start <token>`
 * to the bot, and the webhook (a plain Hono route in
 * `apps/server/src/index.ts`) binds that chat. `link` is `null` when the bot's
 * username is unknown (no bot token, or `getMe` failed); the settings screens
 * then show the `/start` command to send instead.
 */

const issueConnectTokenInput = z.object({});
const issueConnectTokenOutput = z.object({
  token: z.string(),
  expiresAt: z.string(),
  link: z.url().nullable(),
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
      return readTelegramConnection(context.db, userId, organizationId);
    }),

  disconnect: protectedProcedure
    .use(validateInput(z.object({})))
    .input(z.object({}))
    .output(z.object({ connected: z.literal(false) }))
    .handler(async ({ context }) => {
      const userId = context.session?.user?.id;
      const organizationId = context.session?.session?.activeOrganizationId;
      if (!userId || !organizationId) {
        throw raiseApiError("UNAUTHENTICATED", "An active organization is required.");
      }
      await disconnectTelegramChat(context.db, userId, organizationId);
      return { connected: false };
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

      const { token, expiresAt } = await createConnectToken(context.db, {
        userId,
        organizationId,
        ttlSeconds: context.telegram.connectTokenTtlSeconds,
      });
      const username = await (context.telegramBotUsername?.() ?? null);
      return {
        token,
        expiresAt,
        link: username ? `https://t.me/${encodeURIComponent(username)}?start=${token}` : null,
      };
    }),
};
