import { sql } from "drizzle-orm";
import {
  bigserial,
  bytea,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// ─── CSP violation events (Issue #127) ─────────────────────────
//
// Append-only, metadata-only log of accepted CSP violation reports. Every value
// is reduced before it reaches this table: URIs are stored as host +
// path-prefix only, the CSP policy literal is stored as an 8-byte blake2b hash,
// and no user-controlled string exceeds 1024 characters. There are no foreign
// keys — the table holds no personal identifiers and must survive erasure.

export const cspViolationEvent = pgTable(
  "csp_violation_event",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    cspModeAtEmit: text("csp_mode_at_emit").notNull(),
    documentUriHost: text("document_uri_host").notNull(),
    documentUriPathPrefix: text("document_uri_path_prefix"),
    violatedDirective: text("violated_directive").notNull(),
    effectiveDirective: text("effective_directive"),
    blockedUriHost: text("blocked_uri_host"),
    blockedUriPathPrefix: text("blocked_uri_path_prefix"),
    sourceFile: text("source_file"),
    sourceLine: integer("source_line"),
    sourceColumn: integer("source_column"),
    originalPolicyHash: bytea("original_policy_hash").$type<Uint8Array>().notNull(),
    disposition: text("disposition").notNull(),
    correlationId: text("correlation_id").notNull(),
  },
  (table) => ({
    cspViolationEventModeCheck: check(
      "csp_violation_event_csp_mode_at_emit_check",
      sql`${table.cspModeAtEmit} in ('report-only', 'enforce')`,
    ),
    cspViolationEventDocumentHostCheck: check(
      "csp_violation_event_document_uri_host_check",
      sql`length(${table.documentUriHost}) between 1 and 253`,
    ),
    cspViolationEventDocumentPathCheck: check(
      "csp_violation_event_document_uri_path_prefix_check",
      sql`length(${table.documentUriPathPrefix}) <= 1024`,
    ),
    cspViolationEventViolatedDirectiveCheck: check(
      "csp_violation_event_violated_directive_check",
      sql`length(${table.violatedDirective}) <= 200`,
    ),
    cspViolationEventEffectiveDirectiveCheck: check(
      "csp_violation_event_effective_directive_check",
      sql`length(${table.effectiveDirective}) <= 200`,
    ),
    cspViolationEventBlockedHostCheck: check(
      "csp_violation_event_blocked_uri_host_check",
      sql`length(${table.blockedUriHost}) <= 253`,
    ),
    cspViolationEventBlockedPathCheck: check(
      "csp_violation_event_blocked_uri_path_prefix_check",
      sql`length(${table.blockedUriPathPrefix}) <= 1024`,
    ),
    cspViolationEventSourceFileCheck: check(
      "csp_violation_event_source_file_check",
      sql`length(${table.sourceFile}) <= 1024`,
    ),
    cspViolationEventSourceLineCheck: check(
      "csp_violation_event_source_line_check",
      sql`${table.sourceLine} between 0 and 1000000`,
    ),
    cspViolationEventSourceColumnCheck: check(
      "csp_violation_event_source_column_check",
      sql`${table.sourceColumn} between 0 and 100000`,
    ),
    cspViolationEventDispositionCheck: check(
      "csp_violation_event_disposition_check",
      sql`${table.disposition} in ('enforce', 'report')`,
    ),
    cspViolationEventCorrelationIdCheck: check(
      "csp_violation_event_correlation_id_check",
      sql`length(${table.correlationId}) <= 64`,
    ),
    cspViolationEventOccurredAtIdx: index("csp_violation_event_occurred_at_idx").on(
      table.occurredAt,
    ),
  }),
);
