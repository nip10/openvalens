import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// ─── Backup status (Issue #64) ─────────────────────────────────
//
// Written only by the self-host backup service (deploy/backup), with psql.
// The server reads these tables for the readiness probe and the admin backup
// panel. No personal data: ids, sizes, times and value-free failure reasons.

/** One backup, verify, restore or off-site upload run. Append-only; the scheduler prunes old rows. */
export const backupRun = pgTable(
  "backup_run",
  {
    id: serial("id").primaryKey(),
    operation: text("operation").notNull(),
    trigger: text("trigger").notNull(),
    outcome: text("outcome").notNull(),
    backupId: text("backup_id"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    /** Short, value-free failure reason (a step name), never a path or value. */
    detail: text("detail"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    backupRunOperationCheck: check(
      "backup_run_operation_check",
      sql`${table.operation} in ('backup', 'verify', 'restore', 'offsite')`,
    ),
    backupRunTriggerCheck: check(
      "backup_run_trigger_check",
      sql`${table.trigger} in ('daily', 'pre-migrate', 'manual')`,
    ),
    backupRunOutcomeCheck: check(
      "backup_run_outcome_check",
      sql`${table.outcome} in ('ok', 'failed')`,
    ),
    backupRunDetailLengthCheck: check(
      "backup_run_detail_length_check",
      sql`${table.detail} is null or char_length(${table.detail}) <= 200`,
    ),
    backupRunOperationFinishedAtIdx: index("backup_run_operation_finished_at_idx").on(
      table.operation,
      table.finishedAt,
    ),
  }),
);

/** Singleton (`id = 'instance'`) the scheduler upserts with its next planned run. */
export const backupSchedule = pgTable(
  "backup_schedule",
  {
    id: text("id").primaryKey(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true, mode: "date" }),
    hourUtc: integer("hour_utc").notNull(),
    dailyRetain: integer("daily_retain").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    backupScheduleIdCheck: check("backup_schedule_id_check", sql`${table.id} = 'instance'`),
    backupScheduleHourUtcCheck: check(
      "backup_schedule_hour_utc_check",
      sql`${table.hourUtc} between 0 and 23`,
    ),
    backupScheduleDailyRetainCheck: check(
      "backup_schedule_daily_retain_check",
      sql`${table.dailyRetain} >= 0`,
    ),
  }),
);
