-- Issue #127 — CSP violation sink.
--
-- Append-only, metadata-only log of accepted CSP violation reports. URIs are
-- reduced to host + path-prefix, the CSP policy literal is stored as an 8-byte
-- blake2b hash, and no user-controlled string exceeds 1024 characters. No
-- foreign keys on purpose: the table holds no personal identifiers and must
-- survive erasure.

CREATE TABLE IF NOT EXISTS "csp_violation_event" (
	"id" bigserial PRIMARY KEY,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"csp_mode_at_emit" text NOT NULL,
	"document_uri_host" text NOT NULL,
	"document_uri_path_prefix" text,
	"violated_directive" text NOT NULL,
	"effective_directive" text,
	"blocked_uri_host" text,
	"blocked_uri_path_prefix" text,
	"source_file" text,
	"source_line" integer,
	"source_column" integer,
	"original_policy_hash" bytea NOT NULL,
	"disposition" text NOT NULL,
	"correlation_id" text NOT NULL,
	CONSTRAINT "csp_violation_event_csp_mode_at_emit_check" CHECK ("csp_mode_at_emit" in ('report-only', 'enforce')),
	CONSTRAINT "csp_violation_event_document_uri_host_check" CHECK (length("document_uri_host") between 1 and 253),
	CONSTRAINT "csp_violation_event_document_uri_path_prefix_check" CHECK (length("document_uri_path_prefix") <= 1024),
	CONSTRAINT "csp_violation_event_violated_directive_check" CHECK (length("violated_directive") <= 200),
	CONSTRAINT "csp_violation_event_effective_directive_check" CHECK (length("effective_directive") <= 200),
	CONSTRAINT "csp_violation_event_blocked_uri_host_check" CHECK (length("blocked_uri_host") <= 253),
	CONSTRAINT "csp_violation_event_blocked_uri_path_prefix_check" CHECK (length("blocked_uri_path_prefix") <= 1024),
	CONSTRAINT "csp_violation_event_source_file_check" CHECK (length("source_file") <= 1024),
	CONSTRAINT "csp_violation_event_source_line_check" CHECK ("source_line" between 0 and 1000000),
	CONSTRAINT "csp_violation_event_source_column_check" CHECK ("source_column" between 0 and 100000),
	CONSTRAINT "csp_violation_event_disposition_check" CHECK ("disposition" in ('enforce', 'report')),
	CONSTRAINT "csp_violation_event_correlation_id_check" CHECK (length("correlation_id") <= 64)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "csp_violation_event_occurred_at_idx" ON "csp_violation_event" ("occurred_at");
