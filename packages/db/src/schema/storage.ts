import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { orgId, user } from "./auth";

// ─── Stored objects (Issue #62) ────────────────────────────────
//
// One row per object kept in object storage (local disk or S3-compatible).
// The bytes live in the storage backend; this row is the only index of them,
// so data-rights export and delete (#89) can find every object a subject owns.
//
// The storage key is opaque — `org/<organization id>/<object id>` — and never
// carries a filename, metric name, date or any other health detail. No column
// holds a user-supplied filename.

export const STORED_OBJECT_PURPOSES = [
  "progress_photo",
  "clinical_export",
  "lab_document",
  "export_bundle",
] as const;

export const storedObject = pgTable(
  "stored_object",
  {
    /** Random UUID; also the last segment of `storage_key`. */
    id: text("id").primaryKey(),
    organizationId: orgId(),
    /** Uploader. Nulled when that account is erased; the object stays with its record. */
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    purpose: text("purpose").notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    /** Lowercase hex SHA-256 of the stored bytes. */
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    storedObjectStorageKeyUnique: uniqueIndex("stored_object_storage_key_key").on(table.storageKey),
    storedObjectOrgPurposeIdx: index("stored_object_organization_id_purpose_idx").on(
      table.organizationId,
      table.purpose,
      table.createdAt,
    ),
    storedObjectPurposeCheck: check(
      "stored_object_purpose_check",
      sql`${table.purpose} in ('progress_photo', 'clinical_export', 'lab_document', 'export_bundle')`,
    ),
    storedObjectSizeCheck: check("stored_object_size_bytes_check", sql`${table.sizeBytes} >= 0`),
    storedObjectSha256Check: check(
      "stored_object_sha256_check",
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
  }),
);
