import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { storedObject } from "./storage";

/** Catalog records hold declared metadata only; importing/serving upstream content is separate work. */
export const exercise = pgTable(
  "exercise",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id").references(() => organization.id, { onDelete: "cascade" }),
    source: text("source").$type<"wger" | "user">().notNull(),
    externalId: text("external_id"),
    name: text("name").notNull(),
    category: text("category"),
    licenseCode: text("license_code"),
    licenseUrl: text("license_url"),
    author: text("author"),
    rawAttribution: text("raw_attribution"),
    sourceLicenseMetadata: text("source_license_metadata"),
    sourceRecordUrl: text("source_record_url"),
    snapshotVersion: text("snapshot_version"),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    exerciseOrganizationIdx: index("exercise_organization_id_idx").on(table.organizationId),
    exerciseNameIdx: index("exercise_name_idx").on(table.name),
    exerciseSourceIdx: index("exercise_source_idx").on(table.source),
    exerciseExternalIdUnique: uniqueIndex("exercise_source_external_id_key")
      .on(table.source, table.externalId)
      .where(sql`${table.externalId} is not null`),
    exerciseSourceOwnershipCheck: check(
      "exercise_source_ownership_check",
      sql`(${table.source} = 'wger' and ${table.organizationId} is null and ${table.externalId} is not null) or (${table.source} = 'user' and ${table.organizationId} is not null)`,
    ),
    exerciseTextCheck: check("exercise_text_check", sql`length(${table.name}) > 0 and (${table.externalId} is null or length(${table.externalId}) > 0)`),
    exerciseWgerProvenanceCheck: check(
      "exercise_wger_provenance_check",
      sql`${table.source} <> 'wger' or (${table.sourceRecordUrl} is not null and length(${table.sourceRecordUrl}) > 0 and ${table.snapshotVersion} is not null and length(${table.snapshotVersion}) > 0 and ${table.snapshotAt} is not null)`,
    ),
  }),
);

/** Translation attribution is independent: parent metadata is not proof of translation rights. */
export const exerciseTranslation = pgTable(
  "exercise_translation",
  {
    id: serial("id").primaryKey(),
    exerciseId: integer("exercise_id").notNull().references(() => exercise.id, { onDelete: "cascade" }),
    languageCode: text("language_code").notNull(),
    name: text("name").notNull(),
    instructions: text("instructions"),
    licenseCode: text("license_code"),
    licenseUrl: text("license_url"),
    author: text("author"),
    sourceUrl: text("source_url"),
    rawAttribution: text("raw_attribution"),
  },
  (table) => ({
    exerciseTranslationUnique: uniqueIndex("exercise_translation_exercise_language_key").on(table.exerciseId, table.languageCode),
    exerciseTranslationExerciseIdx: index("exercise_translation_exercise_id_idx").on(table.exerciseId),
    exerciseTranslationTextCheck: check("exercise_translation_text_check", sql`length(${table.languageCode}) > 0 and length(${table.name}) > 0`),
  }),
);

export const exerciseMuscle = pgTable(
  "exercise_muscle",
  {
    id: serial("id").primaryKey(),
    exerciseId: integer("exercise_id").notNull().references(() => exercise.id, { onDelete: "cascade" }),
    externalMuscleId: text("external_muscle_id"),
    name: text("name").notNull(),
    role: text("role").$type<"primary" | "secondary">().notNull(),
    location: text("location").$type<"front" | "back">(),
  },
  (table) => ({
    exerciseMuscleUnique: uniqueIndex("exercise_muscle_exercise_muscle_role_key").on(table.exerciseId, table.externalMuscleId, table.name, table.role),
    exerciseMuscleExerciseIdx: index("exercise_muscle_exercise_id_idx").on(table.exerciseId),
    exerciseMuscleRoleCheck: check("exercise_muscle_role_check", sql`${table.role} in ('primary', 'secondary') and (${table.location} is null or ${table.location} in ('front', 'back'))`),
  }),
);

export const exerciseEquipment = pgTable(
  "exercise_equipment",
  {
    id: serial("id").primaryKey(),
    exerciseId: integer("exercise_id").notNull().references(() => exercise.id, { onDelete: "cascade" }),
    externalEquipmentId: text("external_equipment_id"),
    name: text("name").notNull(),
  },
  (table) => ({
    exerciseEquipmentUnique: uniqueIndex("exercise_equipment_exercise_equipment_key").on(table.exerciseId, table.externalEquipmentId, table.name),
    exerciseEquipmentExerciseIdx: index("exercise_equipment_exercise_id_idx").on(table.exerciseId),
  }),
);

/** External URLs are provenance only; assets require future rights validation and self-hosted storage. */
export const exerciseMedia = pgTable(
  "exercise_media",
  {
    id: serial("id").primaryKey(),
    exerciseId: integer("exercise_id").notNull().references(() => exercise.id, { onDelete: "cascade" }),
    sourceExternalMediaId: text("source_external_media_id").notNull(),
    kind: text("kind").$type<"image" | "video">().notNull(),
    licenseCode: text("license_code"),
    licenseUrl: text("license_url"),
    author: text("author"),
    rawAttribution: text("raw_attribution"),
    sourceMediaUrl: text("source_media_url"),
    snapshotVersion: text("snapshot_version"),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true, mode: "date" }),
    publicationActive: boolean("publication_active").notNull().default(true),
    publicationRevision: integer("publication_revision").notNull().default(0),
    storedObjectId: text("stored_object_id").references(() => storedObject.id, { onDelete: "set null" }),
  },
  (table) => ({
    exerciseMediaUnique: uniqueIndex("exercise_media_exercise_source_id_key").on(table.exerciseId, table.sourceExternalMediaId),
    exerciseMediaExerciseIdx: index("exercise_media_exercise_id_idx").on(table.exerciseId),
    exerciseMediaKindCheck: check("exercise_media_kind_check", sql`${table.kind} in ('image', 'video') and length(${table.sourceExternalMediaId}) > 0`),
    exerciseMediaPublicationRevisionCheck: check("exercise_media_publication_revision_check", sql`${table.publicationRevision} >= 0`),
  }),
);

/** Global publication inventory; intentionally not linked to organization-owned data-rights exports. */
export const exerciseCatalogAsset = pgTable(
  "exercise_catalog_asset",
  {
    id: uuid("id").primaryKey(),
    exerciseMediaId: integer("exercise_media_id").notNull().references(() => exerciseMedia.id, { onDelete: "restrict" }),
    storageProvider: text("storage_provider").notNull(),
    storageStoreId: text("storage_store_id").notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    originalFileSha256: text("original_file_sha256").notNull(),
    sourceExerciseId: integer("source_exercise_id").notNull(),
    sourceExternalExerciseId: text("source_external_exercise_id").notNull(),
    sourceExternalMediaId: text("source_external_media_id").notNull(),
    snapshotVersion: text("snapshot_version").notNull(),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true, mode: "date" }).notNull(),
    licenseCode: text("license_code").notNull(),
    licenseUrl: text("license_url").notNull(),
    author: text("author"),
    attribution: text("attribution"),
    sourceUrl: text("source_url").notNull(),
    transformationNotice: text("transformation_notice").notNull(),
    bindingFingerprint: text("binding_fingerprint").notNull(),
    state: text("state").$type<"pending" | "ready" | "withdrawn">().notNull(),
    writeState: text("write_state").$type<"not_started" | "uncertain" | "settled">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    exerciseCatalogAssetKeyUnique: uniqueIndex("exercise_catalog_asset_storage_key_key").on(table.storageKey),
    exerciseCatalogAssetBindingUnique: uniqueIndex("exercise_catalog_asset_media_fingerprint_key").on(table.exerciseMediaId, table.bindingFingerprint),
    exerciseCatalogAssetMediaIdx: index("exercise_catalog_asset_media_id_idx").on(table.exerciseMediaId),
    exerciseCatalogAssetIdentityCheck: check("exercise_catalog_asset_identity_check", sql`${table.storageProvider} in ('local', 's3') and length(${table.storageStoreId}) > 0 and ${table.storageKey} = 'catalog/exercise/' || ${table.id}::text`),
    exerciseCatalogAssetStateCheck: check("exercise_catalog_asset_state_check", sql`${table.state} in ('pending', 'ready', 'withdrawn') and ${table.writeState} in ('not_started', 'uncertain', 'settled') and (${table.state} <> 'ready' or ${table.writeState} = 'settled')`),
    exerciseCatalogAssetContentCheck: check("exercise_catalog_asset_content_check", sql`${table.contentType} in ('image/jpeg', 'image/png') and ${table.sizeBytes} > 0 and ${table.width} > 0 and ${table.height} > 0 and ${table.sha256} ~ '^[0-9a-f]{64}$' and ${table.originalFileSha256} ~ '^[0-9a-f]{64}$' and ${table.bindingFingerprint} ~ '^[0-9a-f]{64}$'`),
  }),
);

/** Idempotency receipts are actor-owned; targetId deliberately has no FK so deleted targets remain tombstoned. */
export const exerciseCatalogMutation = pgTable(
  "exercise_catalog_mutation",
  {
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    clientMutationId: uuid("client_mutation_id").notNull(),
    kind: text("kind").$type<"create_custom" | "add_from_library">().notNull(),
    fingerprint: text("fingerprint").notNull(),
    targetId: integer("target_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    exerciseCatalogMutationKey: uniqueIndex("exercise_catalog_mutation_org_user_client_key").on(table.organizationId, table.userId, table.clientMutationId),
    exerciseCatalogMutationKindCheck: check("exercise_catalog_mutation_kind_check", sql`${table.kind} in ('create_custom', 'add_from_library')`),
    exerciseCatalogMutationFingerprintCheck: check("exercise_catalog_mutation_fingerprint_check", sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
  }),
);
