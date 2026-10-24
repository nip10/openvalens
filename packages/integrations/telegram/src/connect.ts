import { createHash, randomBytes } from "node:crypto";
import type { Database } from "@openvalens/db";
import { telegramAccount, telegramConnectToken } from "@openvalens/db/schema/integrations";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

import { writeTelegramAuditLog } from "./audit";

/**
 * Telegram connect flow (Issue #14).
 *
 * Settings issues a one-time token and links to `https://t.me/<bot>?start=<token>`.
 * Telegram then sends `/start <token>` from the member's private chat to the
 * webhook, which consumes the token and binds that chat to the member.
 *
 * The token is 32 random bytes as base64url (43 characters), which fits
 * Telegram's deep-link limit of 64 characters from `A-Z a-z 0-9 _ -`. Only its
 * SHA-256 hash is stored, a member has at most one unused token, and a token
 * is consumed at most once.
 */

const CONNECT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashConnectToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isConnectTokenShaped(token: string): boolean {
  return CONNECT_TOKEN_PATTERN.test(token);
}

export type CreateConnectTokenInput = {
  userId: string;
  organizationId: string;
  ttlSeconds: number;
  /** Injectable clock for tests; defaults to `new Date()`. */
  now?: Date;
};

/** Issues a fresh token for the member, replacing any unused one. */
export async function createConnectToken(
  db: Database,
  input: CreateConnectTokenInput,
): Promise<{ token: string; expiresAt: string }> {
  const now = input.now ?? new Date();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000).toISOString();

  await db.transaction(async (tx) => {
    await tx
      .delete(telegramConnectToken)
      .where(
        and(eq(telegramConnectToken.userId, input.userId), isNull(telegramConnectToken.usedAt)),
      );
    await tx.insert(telegramConnectToken).values({
      organizationId: input.organizationId,
      userId: input.userId,
      tokenHash: hashConnectToken(token),
      expiresAt,
      createdAt: now.toISOString(),
    });
  });

  return { token, expiresAt };
}

export type ConnectChatInput = {
  token: string;
  /** The private chat the `/start` message came from. */
  chatId: string;
  /** The Telegram user who sent it. */
  telegramUserId: string;
  correlationId: string;
  now?: Date;
};

export type ConnectChatResult =
  | { status: "connected"; userId: string; organizationId: string; telegramAccountId: number }
  | { status: "invalid" };

/**
 * Consumes a connect token and binds the chat to its member. Unknown, used
 * and expired tokens all return `invalid`, so a reply cannot tell them apart.
 */
export async function connectChatWithToken(
  db: Database,
  input: ConnectChatInput,
): Promise<ConnectChatResult> {
  if (!isConnectTokenShaped(input.token)) return { status: "invalid" };
  const nowIso = (input.now ?? new Date()).toISOString();

  const result = await db.transaction(async (tx): Promise<ConnectChatResult> => {
    const [claimed] = await tx
      .update(telegramConnectToken)
      .set({ usedAt: nowIso })
      .where(
        and(
          eq(telegramConnectToken.tokenHash, hashConnectToken(input.token)),
          isNull(telegramConnectToken.usedAt),
          gt(telegramConnectToken.expiresAt, nowIso),
        ),
      )
      .returning({
        userId: telegramConnectToken.userId,
        organizationId: telegramConnectToken.organizationId,
      });
    if (!claimed) return { status: "invalid" };

    // Revoke the member's current chat first so the one-active-chat-per-member
    // index (`telegram_account_user_id_active_key`) holds.
    await tx
      .update(telegramAccount)
      .set({ status: "revoked" })
      .where(and(eq(telegramAccount.userId, claimed.userId), eq(telegramAccount.status, "active")));

    const bound = {
      organizationId: claimed.organizationId,
      userId: claimed.userId,
      telegramUserId: input.telegramUserId,
      status: "active" as const,
      connectedAt: nowIso,
      lastWebhookAt: nowIso,
    };
    const [row] = await tx
      .insert(telegramAccount)
      .values({ ...bound, telegramChatId: input.chatId })
      .onConflictDoUpdate({ target: telegramAccount.telegramChatId, set: bound })
      .returning({ id: telegramAccount.id });
    if (!row) throw new Error("Failed to link the Telegram chat.");

    return {
      status: "connected",
      userId: claimed.userId,
      organizationId: claimed.organizationId,
      telegramAccountId: row.id,
    };
  });

  // Audited after commit: a failed audit insert inside the transaction would
  // abort the bind.
  if (result.status === "connected") {
    await writeTelegramAuditLog({
      db,
      eventType: "TELEGRAM_BIND_COMPLETED",
      organizationId: result.organizationId,
      actorUserId: result.userId,
      targetType: "telegram_account",
      targetId: String(result.telegramAccountId),
      correlationId: input.correlationId,
      metadata: { resource: "telegram_account", action: "connect" },
    });
  }
  return result;
}

export type TelegramConnection = {
  connected: boolean;
  chatId: string | null;
  status: "active" | "revoked" | null;
  lastWebhookAt: string | null;
};

/**
 * The member's chat in this organization: the active one, or else the most
 * recent. Re-linking leaves earlier chats as `revoked` rows, so the oldest
 * row is not the current one.
 */
export async function readTelegramConnection(
  db: Database,
  userId: string,
  organizationId: string,
): Promise<TelegramConnection> {
  const [row] = await db
    .select({
      chatId: telegramAccount.telegramChatId,
      status: telegramAccount.status,
      lastWebhookAt: telegramAccount.lastWebhookAt,
    })
    .from(telegramAccount)
    .where(
      and(eq(telegramAccount.userId, userId), eq(telegramAccount.organizationId, organizationId)),
    )
    .orderBy(sql`${telegramAccount.status} = 'active' desc`, desc(telegramAccount.connectedAt))
    .limit(1);
  if (!row) return { connected: false, chatId: null, status: null, lastWebhookAt: null };
  return { connected: row.status === "active", ...row };
}

/** Stops reminders to the member's chat and discards any unused connect token. */
export async function disconnectTelegramChat(
  db: Database,
  userId: string,
  organizationId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(telegramAccount)
      .set({ status: "revoked" })
      .where(
        and(
          eq(telegramAccount.userId, userId),
          eq(telegramAccount.organizationId, organizationId),
          eq(telegramAccount.status, "active"),
        ),
      );
    await tx
      .delete(telegramConnectToken)
      .where(and(eq(telegramConnectToken.userId, userId), isNull(telegramConnectToken.usedAt)));
  });
}
