import {
  pgTable,
  pgEnum,
  text,
  integer,
  serial,
  bigint,
  index,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { orgId, user, member } from "./auth";

export const dailyReminderStatus = pgEnum("daily_reminder_status", ["pending", "done", "skipped"]);

export const dailyReminderSourceType = pgEnum("daily_reminder_source_type", [
  "supplement",
  "medication",
  "activity",
]);

export const telegramAccountStatus = pgEnum("telegram_account_status", ["active", "revoked"]);

export const telegramAccount = pgTable(
  "telegram_account",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    telegramChatId: text("telegram_chat_id").notNull(),
    telegramUserId: text("telegram_user_id").notNull(),
    status: telegramAccountStatus("status").notNull().default("active"),
    connectedAt: text("connected_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    lastWebhookAt: text("last_webhook_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    telegramAccountUserIdIdx: index("telegram_account_user_id_idx").on(table.userId),
    telegramAccountChatIdUnique: uniqueIndex("telegram_account_telegram_chat_id_key").on(
      table.telegramChatId,
    ),
    telegramAccountSingleActivePerUserUnique: uniqueIndex("telegram_account_user_id_active_key")
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),
    telegramAccountStatusIdx: index("telegram_account_status_idx").on(table.status),
    telegramAccountOrgIdx: index("telegram_account_organization_id_idx").on(table.organizationId),
    telegramAccountMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "telegram_account_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

export const telegramConnectToken = pgTable(
  "telegram_connect_token",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    telegramConnectTokenTokenHashUnique: uniqueIndex("telegram_connect_token_token_hash_key").on(
      table.tokenHash,
    ),
    telegramConnectTokenSingleUnusedPerUserUnique: uniqueIndex(
      "telegram_connect_token_user_id_unused_key",
    )
      .on(table.userId)
      .where(sql`${table.usedAt} is null`),
    telegramConnectTokenUserIdIdx: index("telegram_connect_token_user_id_idx").on(table.userId),
    telegramConnectTokenExpiresAtIdx: index("telegram_connect_token_expires_at_idx").on(
      table.expiresAt,
    ),
    telegramConnectTokenUsedAtIdx: index("telegram_connect_token_used_at_idx").on(table.usedAt),
    telegramConnectTokenOrgIdx: index("telegram_connect_token_organization_id_idx").on(
      table.organizationId,
    ),
    telegramConnectTokenMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "telegram_connect_token_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

export const telegramWebhookEvent = pgTable(
  "telegram_webhook_event",
  {
    id: serial("id").primaryKey(),
    telegramUpdateId: bigint("telegram_update_id", { mode: "number" }).notNull(),
    status: text("status").notNull().default("processing"),
    claimedAt: text("claimed_at")
      .notNull()
      .default(sql`now()`),
    processedAt: text("processed_at"),
  },
  (table) => ({
    telegramWebhookEventTelegramUpdateIdUnique: uniqueIndex(
      "telegram_webhook_event_telegram_update_id_key",
    ).on(table.telegramUpdateId),
  }),
);

export const dailyReminder = pgTable(
  "daily_reminder",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    sourceType: dailyReminderSourceType("source_type").notNull(),
    sourceId: integer("source_id").notNull(),
    label: text("label").notNull(),
    status: dailyReminderStatus("status").notNull().default("pending"),
    telegramMessageId: integer("telegram_message_id"),
    actedAt: text("acted_at"),
    actedVia: text("acted_via"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    // Issue #125 — slot uniqueness is per-organization so a user belonging to
    // multiple orgs cannot have their slots collide across tenants.
    dailyReminderUserDateSourceUnique: uniqueIndex(
      "daily_reminder_organization_id_user_id_date_source_type_source_id_key",
    ).on(table.organizationId, table.userId, table.date, table.sourceType, table.sourceId),
    dailyReminderUserDateStatusIdx: index("daily_reminder_user_id_date_status_idx").on(
      table.userId,
      table.date,
      table.status,
    ),
    dailyReminderTelegramMessageIdIdx: index("daily_reminder_telegram_message_id_idx").on(
      table.telegramMessageId,
    ),
    dailyReminderOrgIdx: index("daily_reminder_organization_id_idx").on(table.organizationId),
    // Backs the daily cron's tenant-scoped pending-reminder selection.
    dailyReminderOrgDatePendingIdx: index("daily_reminder_organization_id_date_pending_idx")
      .on(table.organizationId, table.date)
      .where(sql`${table.status} = 'pending' AND ${table.telegramMessageId} IS NULL`),
    dailyReminderMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "daily_reminder_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);
