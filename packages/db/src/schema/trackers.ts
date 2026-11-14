import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { member, orgId, user } from "./auth";

// ─── Custom trackers (Issue #441) ─────────────────────────────
// A member defines their own small trackers (mood, sauna, dead hangs, …).
// Rows are keyed by the owning member: organization plus user, with a
// composite foreign key to `member`, as `cycle_period` does. A tracker is
// private to its owner unless `shared` is on; then members with read access
// see it and collaborators and above add entries (`logged_by_user_id`).
// Only the owner changes, shares or deletes a tracker.

export const customTracker = pgTable(
  "custom_tracker",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    /** The owning member. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** A platform-neutral icon key (see `@openvalens/trackers`). */
    icon: text("icon").notNull(),
    /** The template it was created from, or null for a custom one. */
    template: text("template"),
    /** `number`, `scale` (1-5), `yes_no` or `duration` (stored in seconds). */
    type: text("type").notNull(),
    /** Free-text unit for `number` trackers; null for the other types. */
    unit: text("unit"),
    /** Decimal places shown for `number` trackers (0-2). */
    decimals: integer("decimals").notNull().default(0),
    /** How several entries in a day combine: `sum`, `average` or `last`. */
    aggregation: text("aggregation").notNull(),
    /** Optional target per day or per week, in the tracker's unit. */
    targetValue: doublePrecision("target_value"),
    targetPeriod: text("target_period"),
    /** "Share with this workspace". Off by default. */
    shared: boolean("shared").notNull().default(false),
    /** "Coach and connected AI apps can read this". */
    aiVisible: boolean("ai_visible").notNull().default(true),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    customTrackerMemberIdx: index("custom_tracker_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
    customTrackerSharedIdx: index("custom_tracker_org_shared_idx")
      .on(table.organizationId)
      .where(sql`${table.shared}`),
    /** Target of the entry's composite key, so an entry always matches its tracker's owner. */
    customTrackerOwnerKey: uniqueIndex("custom_tracker_id_org_user_key").on(
      table.id,
      table.organizationId,
      table.userId,
    ),
    customTrackerMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "custom_tracker_org_user_member_fk",
    }).onDelete("cascade"),
    customTrackerNameCheck: check(
      "custom_tracker_name_check",
      sql`length(btrim(${table.name})) between 1 and 40`,
    ),
    customTrackerIconCheck: check(
      "custom_tracker_icon_check",
      sql`length(${table.icon}) between 1 and 40`,
    ),
    customTrackerTypeCheck: check(
      "custom_tracker_type_check",
      sql`${table.type} in ('number', 'scale', 'yes_no', 'duration')`,
    ),
    customTrackerUnitCheck: check(
      "custom_tracker_unit_check",
      sql`(${table.type} = 'number' and ${table.unit} is not null and length(btrim(${table.unit})) between 1 and 12) or (${table.type} <> 'number' and ${table.unit} is null)`,
    ),
    customTrackerDecimalsCheck: check(
      "custom_tracker_decimals_check",
      sql`${table.decimals} between 0 and 2`,
    ),
    customTrackerAggregationCheck: check(
      "custom_tracker_aggregation_check",
      sql`(${table.type} = 'number' and ${table.aggregation} in ('sum', 'average', 'last')) or (${table.type} = 'duration' and ${table.aggregation} = 'sum') or (${table.type} = 'scale' and ${table.aggregation} = 'average') or (${table.type} = 'yes_no' and ${table.aggregation} = 'any')`,
    ),
    customTrackerTargetCheck: check(
      "custom_tracker_target_check",
      sql`(${table.targetValue} is null and ${table.targetPeriod} is null) or (${table.targetValue} > 0 and ${table.targetPeriod} in ('day', 'week'))`,
    ),
  }),
);

export const customTrackerEntry = pgTable(
  "custom_tracker_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trackerId: uuid("tracker_id").notNull(),
    organizationId: orgId(),
    /** The tracker's owner (not who logged it): export and erasure follow the owner. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Who logged it: the owner, or a collaborator on a shared tracker. */
    loggedByUserId: text("logged_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** number: the value; scale: 1-5; yes_no: 1 or 0; duration: seconds. */
    value: doublePrecision("value").notNull(),
    loggedAt: timestamp("logged_at", { withTimezone: true, mode: "date" }).notNull(),
    /** The calendar day of `logged_at` in the member's time zone (YYYY-MM-DD). */
    localDate: text("local_date").notNull(),
    note: text("note"),
    source: text("source").notNull().default("manual"),
    /** The platform record id, for idempotent re-import; null for manual rows. */
    sourceRecordId: text("source_record_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    customTrackerEntryTrackerIdx: index("custom_tracker_entry_tracker_date_idx").on(
      table.trackerId,
      table.localDate,
    ),
    customTrackerEntryMemberIdx: index("custom_tracker_entry_org_user_logged_idx").on(
      table.organizationId,
      table.userId,
      table.loggedAt,
    ),
    customTrackerEntrySourceRecordKey: uniqueIndex("custom_tracker_entry_source_record_key")
      .on(table.organizationId, table.userId, table.trackerId, table.source, table.sourceRecordId)
      .where(sql`${table.sourceRecordId} is not null`),
    customTrackerEntryTrackerFk: foreignKey({
      columns: [table.trackerId, table.organizationId, table.userId],
      foreignColumns: [customTracker.id, customTracker.organizationId, customTracker.userId],
      name: "custom_tracker_entry_tracker_fk",
    }).onDelete("cascade"),
    customTrackerEntryMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "custom_tracker_entry_org_user_member_fk",
    }).onDelete("cascade"),
    customTrackerEntryDateCheck: check(
      "custom_tracker_entry_date_check",
      sql`${table.localDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
    ),
    customTrackerEntryNoteCheck: check(
      "custom_tracker_entry_note_check",
      sql`${table.note} is null or length(${table.note}) <= 500`,
    ),
    customTrackerEntrySourceCheck: check(
      "custom_tracker_entry_source_check",
      sql`(${table.source} = 'manual' and ${table.sourceRecordId} is null) or (${table.source} in ('health_connect', 'healthkit') and ${table.sourceRecordId} is not null)`,
    ),
  }),
);

// ─── Phone feeds (Issue #452) ─────────────────────────────────
// Which tracker a feed from the member's phone fills: HealthKit mindful
// sessions or Health Connect mindfulness into a duration tracker, HealthKit
// State of Mind (daily moods) into a 1-5 scale tracker. One tracker per feed
// per member. Stored here, not on the phone, so every phone of the member
// knows the link and the server refuses imports once it is gone. Unlinking
// deletes the row and keeps the entries already imported.

export const customTrackerFeed = pgTable(
  "custom_tracker_feed",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    /** The owning member; only the tracker's owner links a feed. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** `healthkit_mindful_sessions`, `health_connect_mindfulness` or `healthkit_state_of_mind`. */
    feed: text("feed").notNull(),
    trackerId: uuid("tracker_id").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    customTrackerFeedMemberKey: uniqueIndex("custom_tracker_feed_org_user_feed_key").on(
      table.organizationId,
      table.userId,
      table.feed,
    ),
    customTrackerFeedTrackerIdx: index("custom_tracker_feed_tracker_idx").on(table.trackerId),
    customTrackerFeedTrackerFk: foreignKey({
      columns: [table.trackerId, table.organizationId, table.userId],
      foreignColumns: [customTracker.id, customTracker.organizationId, customTracker.userId],
      name: "custom_tracker_feed_tracker_fk",
    }).onDelete("cascade"),
    customTrackerFeedMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "custom_tracker_feed_org_user_member_fk",
    }).onDelete("cascade"),
    customTrackerFeedFeedCheck: check(
      "custom_tracker_feed_feed_check",
      sql`${table.feed} in ('healthkit_mindful_sessions', 'health_connect_mindfulness', 'healthkit_state_of_mind')`,
    ),
  }),
);
