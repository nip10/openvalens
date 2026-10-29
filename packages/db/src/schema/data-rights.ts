import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
  bigint,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// ─── Erasure ledger (Issue #89 / #64) ─────────────────────────

/**
 * One row per completed "delete everything" request. Deliberately has no
 * foreign keys: it must outlive the erased user and organizations so a
 * restored backup can be re-erased (#64). Holds identifiers and row counts
 * only, never health values.
 */
export const erasureLedger = pgTable(
  "erasure_ledger",
  {
    id: serial("id").primaryKey(),
    subjectUserId: text("subject_user_id").notNull(),
    organizationIds: jsonb("organization_ids").$type<string[]>().notNull(),
    rowCounts: jsonb("row_counts").$type<Record<string, number>>().notNull(),
    erasedAt: timestamp("erased_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    erasureLedgerSubjectUserIdx: index("erasure_ledger_subject_user_id_idx").on(
      table.subjectUserId,
    ),
  }),
);

export const dataExportJobState = pgEnum("data_export_job_state", [
  "queued",
  "running",
  "ready",
  "failed",
  "cancelled",
  "expired",
]);
export const dataExportFailure = pgEnum("data_export_failure", [
  "LIMIT_EXCEEDED",
  "ATTACHMENT_UNAVAILABLE",
  "STORAGE_UNAVAILABLE",
  "INTERRUPTED",
  "INTERNAL",
]);

/** Private, user-scoped export job metadata. Payload bytes live only on private disk. */
export const dataExportJob = pgTable(
  "data_export_job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectUserId: text("subject_user_id").references(() => user.id, { onDelete: "set null" }),
    state: dataExportJobState("state").notNull().default("queued"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    leaseUntil: timestamp("lease_until", { withTimezone: true, mode: "date" }),
    attemptId: uuid("attempt_id"),
    organizationIds: jsonb("organization_ids").$type<string[]>().notNull().default([]),
    bytes: bigint("bytes", { mode: "number" }),
    checksum: text("checksum"),
    failure: dataExportFailure("failure"),
    cleanupPending: text("cleanup_pending"),
  },
  (table) => ({
    ownerStateIdx: index("data_export_job_owner_state_idx").on(
      table.subjectUserId,
      table.state,
      table.createdAt,
    ),
    stateCreatedIdx: index("data_export_job_state_created_idx").on(table.state, table.createdAt),
  }),
);
