import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
    /** P2 lifecycle identity. NULL on legacy/unmanaged objects. */
    storageProvider: text("storage_provider"),
    storageStoreId: text("storage_store_id"),
    photoState: text("photo_state"),
    photoWriteState: text("photo_write_state"),
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
    storedObjectPhotoStateCheck: check(
      "stored_object_photo_state_check",
      sql`(${table.photoState} is null and ${table.photoWriteState} is null and ${table.storageProvider} is null and ${table.storageStoreId} is null) or (${table.purpose} = 'progress_photo' and ${table.photoState} is not null and ${table.photoState} in ('pending', 'ready', 'deleting') and ${table.photoWriteState} is not null and ${table.photoWriteState} in ('not_started', 'uncertain', 'settled') and ${table.storageProvider} is not null and ${table.storageStoreId} is not null and ${table.createdByUserId} is not null)`,
    ),
    storedObjectReadySettledCheck: check(
      "stored_object_ready_settled_check",
      sql`${table.photoState} is distinct from 'ready' or ${table.photoWriteState} = 'settled'`,
    ),
  }),
);

/** Durable physical deletion intent. Deliberately has no FK: parent/org/user
 * cascades must not erase the only record of bytes still in object storage. */
export const photoCleanupIntent = pgTable(
  "photo_cleanup_intent",
  {
    id: text("id").primaryKey(),
    storageKey: text("storage_key").notNull(),
    storageProvider: text("storage_provider").notNull(),
    storageStoreId: text("storage_store_id").notNull(),
    subjectUserId: text("subject_user_id").notNull(),
    organizationId: text("organization_id").notNull(),
    writeState: text("write_state").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, mode: "date" }),
  },
  (table) => ({
    photoCleanupDueIdx: index("photo_cleanup_intent_due_idx").on(table.nextAttemptAt),
    photoCleanupStateCheck: check("photo_cleanup_intent_write_state_check", sql`${table.writeState} in ('not_started', 'uncertain', 'settled')`),
    photoCleanupAttemptsCheck: check("photo_cleanup_intent_attempts_check", sql`${table.attempts} >= 0`),
  }),
);
