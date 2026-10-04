import { index, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

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
