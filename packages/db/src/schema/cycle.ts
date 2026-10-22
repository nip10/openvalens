import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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

// ─── Optional cycle logging (Issue #91) ───────────────────────
// Member-private, opt-in under its own consent. Rows are scoped to the
// authenticated member as well as the active organization; workspace roles
// never grant access. Dates are local calendar dates (YYYY-MM-DD).

/** Separate, user-level consent. Missing row and `enabled = false` both mean off. */
export const cyclePreference = pgTable("cycle_preference", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  /** Version of the consent text the member accepted; null while off. */
  consentVersion: text("consent_version"),
  consentedAt: timestamp("consented_at", { withTimezone: true, mode: "date" }),
  /** Hormonal contraception or no natural cycle: phase estimates are off. */
  noNaturalCycle: boolean("no_natural_cycle").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** One import run, so it can be undone as a whole. */
export const cycleImport = pgTable(
  "cycle_import",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    periodCount: integer("period_count").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    cycleImportMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "cycle_import_org_user_member_fk",
    }).onDelete("cascade"),
    cycleImportSourceCheck: check(
      "cycle_import_source_check",
      sql`${table.source} in ('health_connect', 'healthkit')`,
    ),
  }),
);

export const cyclePeriod = pgTable(
  "cycle_period",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    flow: text("flow"),
    notes: text("notes"),
    source: text("source").notNull().default("manual"),
    /** The platform record id, for idempotent re-import; null for manual rows. */
    sourceRecordId: text("source_record_id"),
    importId: uuid("import_id").references(() => cycleImport.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    cyclePeriodMemberIdx: index("cycle_period_org_user_start_idx").on(
      table.organizationId,
      table.userId,
      table.startDate,
    ),
    cyclePeriodSourceRecordKey: uniqueIndex("cycle_period_source_record_key")
      .on(table.organizationId, table.userId, table.source, table.sourceRecordId)
      .where(sql`${table.sourceRecordId} is not null`),
    cyclePeriodMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "cycle_period_org_user_member_fk",
    }).onDelete("cascade"),
    cyclePeriodDatesCheck: check(
      "cycle_period_dates_check",
      sql`${table.startDate} ~ '^\\d{4}-\\d{2}-\\d{2}$' and (${table.endDate} is null or (${table.endDate} ~ '^\\d{4}-\\d{2}-\\d{2}$' and ${table.endDate} >= ${table.startDate}))`,
    ),
    cyclePeriodFlowCheck: check(
      "cycle_period_flow_check",
      sql`${table.flow} is null or ${table.flow} in ('spotting', 'light', 'medium', 'heavy')`,
    ),
    cyclePeriodNotesCheck: check(
      "cycle_period_notes_check",
      sql`${table.notes} is null or length(${table.notes}) <= 500`,
    ),
    cyclePeriodSourceCheck: check(
      "cycle_period_source_check",
      sql`(${table.source} = 'manual' and ${table.importId} is null and ${table.sourceRecordId} is null) or (${table.source} in ('health_connect', 'healthkit') and ${table.importId} is not null and ${table.sourceRecordId} is not null)`,
    ),
  }),
);
