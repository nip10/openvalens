import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { member, orgId, user } from "./auth";

// ─── Insights (Issue #92) ──────────────────────────────────────
//
// Insights themselves are never stored: they are recomputed from the
// workspace's records on every request. These tables hold only what the
// person chose (feedback, delivery preferences, registered phones) and what
// was sent (delivery history). None of them holds a health value: insight ids
// are `<rule id>:<window key>` where the window key is built from dates, week
// numbers, measure names and goal ids only.
//
// Rows are keyed by (organization, user) and reference the `member` row with
// ON DELETE CASCADE, so leaving a workspace removes its preferences and stops
// any delivery for it.

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
};

/**
 * Per-person delivery preferences for one workspace. Push and email default
 * to off; the email digest cannot be on without an acknowledged disclosure
 * version. `disabled_channels` lists `<kind>:<channel>` pairs switched off.
 */
export const insightPreference = pgTable(
  "insight_preference",
  {
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pushEnabled: boolean("push_enabled").notNull().default(false),
    pushShowTopic: boolean("push_show_topic").notNull().default(false),
    /** `not_offered` | `accepted` | `declined` — the in-context offer. */
    pushOfferState: text("push_offer_state").notNull().default("not_offered"),
    emailEnabled: boolean("email_enabled").notNull().default(false),
    emailAcknowledgedVersion: text("email_acknowledged_version"),
    emailAcknowledgedAt: timestamp("email_acknowledged_at", { withTimezone: true, mode: "date" }),
    /** SHA-256 of the one-step unsubscribe token sent in each digest. */
    emailUnsubscribeTokenHash: text("email_unsubscribe_token_hash"),
    deliveryHour: integer("delivery_hour").notNull().default(9),
    timeZone: text("time_zone").notNull().default("UTC"),
    disabledChannels: text("disabled_channels")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps,
  },
  (table) => ({
    insightPreferencePk: primaryKey({
      columns: [table.organizationId, table.userId],
      name: "insight_preference_pkey",
    }),
    insightPreferenceUserIdx: index("insight_preference_user_id_idx").on(table.userId),
    insightPreferenceUnsubscribeUnique: uniqueIndex(
      "insight_preference_email_unsubscribe_token_hash_key",
    ).on(table.emailUnsubscribeTokenHash),
    insightPreferenceMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "insight_preference_org_user_member_fk",
    }).onDelete("cascade"),
    insightPreferenceOfferCheck: check(
      "insight_preference_push_offer_state_check",
      sql`${table.pushOfferState} in ('not_offered', 'accepted', 'declined')`,
    ),
    insightPreferenceEmailAckCheck: check(
      "insight_preference_email_ack_check",
      sql`${table.emailEnabled} = false or ${table.emailAcknowledgedVersion} is not null`,
    ),
    insightPreferenceHourCheck: check(
      "insight_preference_delivery_hour_check",
      sql`${table.deliveryHour} between 0 and 23`,
    ),
    insightPreferenceChannelsCheck: check(
      "insight_preference_disabled_channels_check",
      sql`${table.disabledChannels} <@ array[
        'change:in_app', 'change:push', 'change:email',
        'goal_milestone:in_app', 'goal_milestone:push', 'goal_milestone:email',
        'data_quality:in_app', 'data_quality:push', 'data_quality:email',
        'streak:in_app', 'streak:push', 'streak:email',
        'reminder:in_app', 'reminder:push', 'reminder:email'
      ]::text[]`,
    ),
  }),
);

/**
 * Dismiss / "not useful" feedback. Dismiss hides one insight (rule + window);
 * "not useful" also mutes the rule for this person until `muted_until`. Never
 * used for analytics.
 */
export const insightFeedback = pgTable(
  "insight_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    insightId: text("insight_id").notNull(),
    ruleId: text("rule_id").notNull(),
    ruleVersion: text("rule_version").notNull(),
    /** `dismiss` | `not_useful`. */
    action: text("action").notNull(),
    mutedUntil: timestamp("muted_until", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    insightFeedbackUnique: uniqueIndex("insight_feedback_org_user_insight_key").on(
      table.organizationId,
      table.userId,
      table.insightId,
    ),
    insightFeedbackUserIdx: index("insight_feedback_user_id_idx").on(table.userId),
    insightFeedbackMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "insight_feedback_org_user_member_fk",
    }).onDelete("cascade"),
    insightFeedbackActionCheck: check(
      "insight_feedback_action_check",
      sql`${table.action} in ('dismiss', 'not_useful')`,
    ),
  }),
);

/**
 * Phones registered for push (Expo push tokens). Keyed by user: a push only
 * ever says "You have a new insight" (or names a topic when allowed), so it
 * carries nothing workspace-specific.
 */
export const pushDevice = pgTable(
  "push_device",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expoPushToken: text("expo_push_token").notNull(),
    /** `ios` | `android`. */
    platform: text("platform").notNull(),
    ...timestamps,
  },
  (table) => ({
    pushDeviceTokenUnique: uniqueIndex("push_device_expo_push_token_key").on(table.expoPushToken),
    pushDeviceUserIdx: index("push_device_user_id_idx").on(table.userId),
    pushDevicePlatformCheck: check(
      "push_device_platform_check",
      sql`${table.platform} in ('ios', 'android')`,
    ),
  }),
);

/**
 * Delivery history and the idempotency claim. One row per (workspace, person,
 * channel, period): the period is the local date for push (at most one a day)
 * and the ISO week for the email digest. Holds rule ids, versions and insight
 * ids only — never a value.
 */
export const insightDelivery = pgTable(
  "insight_delivery",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** `push` | `email`. */
    channel: text("channel").notNull(),
    periodKey: text("period_key").notNull(),
    insightIds: text("insight_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** `<rule id>@<version>` per delivered insight. */
    ruleVersions: text("rule_versions")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** `claimed` | `sent` | `failed`. */
    status: text("status").notNull().default("claimed"),
    attempts: integer("attempts").notNull().default(1),
    errorCode: text("error_code"),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
  },
  (table) => ({
    insightDeliveryPeriodUnique: uniqueIndex("insight_delivery_org_user_channel_period_key").on(
      table.organizationId,
      table.userId,
      table.channel,
      table.periodKey,
    ),
    insightDeliveryUserIdx: index("insight_delivery_user_id_idx").on(table.userId),
    insightDeliveryMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "insight_delivery_org_user_member_fk",
    }).onDelete("cascade"),
    insightDeliveryChannelCheck: check(
      "insight_delivery_channel_check",
      sql`${table.channel} in ('push', 'email')`,
    ),
    insightDeliveryStatusCheck: check(
      "insight_delivery_status_check",
      sql`${table.status} in ('claimed', 'sent', 'failed')`,
    ),
  }),
);
