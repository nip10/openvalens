/**
 * What an object is for (Issue #62). Each purpose fixes which content types
 * may be stored and which RBAC resource guards reading and deleting it, so
 * feature code (#85 progress photos, #132 clinical PDF export) never decides
 * that ad hoc. Adding a purpose also needs the `stored_object_purpose_check`
 * constraint widened in a migration.
 *
 * `resource` is a resource name from `@openvalens/auth/access/permissions`;
 * this package stays independent of auth, so it is a plain string here and the
 * API layer passes it to `requirePermission`.
 */

import { STORED_OBJECT_PURPOSES } from "@openvalens/db/schema/storage";

export type StoredObjectPurpose = (typeof STORED_OBJECT_PURPOSES)[number];

export { STORED_OBJECT_PURPOSES };

export type PurposePolicy = {
  /** RBAC resource checked for `read` (download) and `write` (upload, delete). */
  resource: "weight" | "records" | "blood";
  /** Allowed content types. SVG, HTML and other active content are never allowed. */
  contentTypes: readonly string[];
};

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;

export const PURPOSE_POLICIES: Readonly<Record<StoredObjectPurpose, PurposePolicy>> = Object.freeze(
  {
    progress_photo: { resource: "weight", contentTypes: IMAGE_TYPES },
    clinical_export: { resource: "records", contentTypes: ["application/pdf"] },
    lab_document: { resource: "blood", contentTypes: ["application/pdf", ...IMAGE_TYPES] },
    export_bundle: { resource: "records", contentTypes: ["application/zip", "application/json"] },
  },
);

export function isStoredObjectPurpose(value: unknown): value is StoredObjectPurpose {
  return typeof value === "string" && (STORED_OBJECT_PURPOSES as readonly string[]).includes(value);
}

/** Lowercased media type without parameters (`image/jpeg; q=1` → `image/jpeg`). */
export function normalizeContentType(value: string): string {
  return value.split(";")[0]!.trim().toLowerCase();
}
