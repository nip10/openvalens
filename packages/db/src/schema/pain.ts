import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { member, orgId, user } from "./auth";

// ─── Pain log (Issue #442) ────────────────────────────────────
// A record of what the member rated: a body-map region, a 0-10 rating, an
// optional type and note. Rows are private to the member: keyed by the
// organization plus the user, with a composite foreign key to `member`, like
// `private_body_measurement`. Workspace roles never grant access to another
// member's rows. There is no score, no likely cause and no guidance.

export const painEntry = pgTable(
  "pain_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** A body-map region id (`front.thigh_left`) or a joint spot (`joint.knee_left`). */
    region: text("region").notNull(),
    /** What the member rated, 0 to 10. */
    rating: smallint("rating").notNull(),
    /** Optional: ache, sharp, burning, throbbing, stiffness or tingling. */
    type: text("type"),
    loggedAt: timestamp("logged_at", { withTimezone: true, mode: "date" }).notNull(),
    /** The calendar day of `logged_at` in the member's time zone (YYYY-MM-DD). */
    localDate: text("local_date").notNull(),
    note: text("note"),
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    painEntryMemberDateIdx: index("pain_entry_org_user_date_idx").on(
      table.organizationId,
      table.userId,
      table.localDate,
    ),
    painEntryMemberRegionIdx: index("pain_entry_org_user_region_logged_idx").on(
      table.organizationId,
      table.userId,
      table.region,
      table.loggedAt,
    ),
    painEntryMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "pain_entry_org_user_member_fk",
    }).onDelete("cascade"),
    painEntryRegionCheck: check(
      "pain_entry_region_check",
      sql`${table.region} ~ '^(front|back|joint)\\.[a-z_]{2,40}$'`,
    ),
    painEntryRatingCheck: check("pain_entry_rating_check", sql`${table.rating} between 0 and 10`),
    painEntryTypeCheck: check(
      "pain_entry_type_check",
      sql`${table.type} is null or ${table.type} in ('ache', 'sharp', 'burning', 'throbbing', 'stiffness', 'tingling')`,
    ),
    painEntryDateCheck: check(
      "pain_entry_date_check",
      sql`${table.localDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
    ),
    painEntryNoteCheck: check(
      "pain_entry_note_check",
      sql`${table.note} is null or length(${table.note}) <= 500`,
    ),
    painEntrySourceCheck: check("pain_entry_source_check", sql`${table.source} = 'manual'`),
  }),
);

/**
 * User-level opt-in, like `private_body_measurement_preference`. A missing
 * row means off. `ai_visible` is the separate "Coach and connected AI apps can
 * read my pain log" switch, off by default.
 */
export const painPreference = pgTable("pain_preference", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  aiVisible: boolean("ai_visible").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
