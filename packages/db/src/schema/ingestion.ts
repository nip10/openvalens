import {
  pgTable,
  pgEnum,
  text,
  integer,
  serial,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql, desc } from "drizzle-orm";

import { organization, orgId, user, member } from "./auth";

export const mobilePairingCode = pgTable(
  "mobile_pairing_code",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    mobilePairingCodeCodeHashUnique: uniqueIndex("mobile_pairing_code_code_hash_key")
      .on(table.codeHash)
      .where(sql`${table.usedAt} is null`),
    mobilePairingCodeUserIdIdx: index("mobile_pairing_code_user_id_idx").on(table.userId),
    mobilePairingCodeExpiresAtIdx: index("mobile_pairing_code_expires_at_idx").on(table.expiresAt),
    mobilePairingCodeUsedAtIdx: index("mobile_pairing_code_used_at_idx").on(table.usedAt),
  }),
);

export const mobilePairingRateLimit = pgTable(
  "mobile_pairing_rate_limit",
  {
    keyHash: text("key_hash").primaryKey(),
    attemptCount: integer("attempt_count").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true, mode: "date" }).notNull(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    mobilePairingRateLimitBlockedUntilIdx: index("mobile_pairing_rate_limit_blocked_until_idx").on(
      table.blockedUntil,
    ),
    mobilePairingRateLimitWindowStartedAtIdx: index(
      "mobile_pairing_rate_limit_window_started_at_idx",
    ).on(table.windowStartedAt),
  }),
);

export const mobileDeviceSession = pgTable(
  "mobile_device_session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceName: text("device_name").notNull(),
    platform: text("platform").notNull(),
    accessTokenHash: text("access_token_hash").notNull(),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    previousRefreshTokenHash: text("previous_refresh_token_hash"),
    deviceRenewTokenHash: text("device_renew_token_hash"),
    previousDeviceRenewTokenHash: text("previous_device_renew_token_hash"),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true, mode: "date" }).notNull(),
    refreshExpiresAt: timestamp("refresh_expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    deviceRenewExpiresAt: timestamp("device_renew_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }),
  },
  (table) => ({
    mobileDeviceSessionAccessTokenHashUnique: uniqueIndex(
      "mobile_device_session_access_token_hash_key",
    ).on(table.accessTokenHash),
    mobileDeviceSessionRefreshTokenHashUnique: uniqueIndex(
      "mobile_device_session_refresh_token_hash_key",
    ).on(table.refreshTokenHash),
    mobileDeviceSessionPreviousRefreshTokenHashUnique: uniqueIndex(
      "mobile_device_session_previous_refresh_token_hash_key",
    ).on(table.previousRefreshTokenHash),
    mobileDeviceSessionDeviceRenewTokenHashUnique: uniqueIndex(
      "mobile_device_session_device_renew_token_hash_key",
    ).on(table.deviceRenewTokenHash),
    mobileDeviceSessionPreviousDeviceRenewTokenHashUnique: uniqueIndex(
      "mobile_device_session_previous_device_renew_token_hash_key",
    ).on(table.previousDeviceRenewTokenHash),
    mobileDeviceSessionUserIdIdx: index("mobile_device_session_user_id_idx").on(table.userId),
    mobileDeviceSessionRevokedAtIdx: index("mobile_device_session_revoked_at_idx").on(
      table.revokedAt,
    ),
    mobileDeviceSessionAccessExpiresAtIdx: index("mobile_device_session_access_expires_at_idx").on(
      table.accessExpiresAt,
    ),
  }),
);

export const mobileSyncSessionStatus = pgEnum("mobile_sync_session_status", [
  "running",
  "finalized",
  "expired",
]);

export const mobileSyncSession = pgTable(
  "mobile_sync_session",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    payloadVersion: text("payload_version").notNull(),
    timezone: text("timezone").notNull(),
    windowStart: text("window_start").notNull(),
    windowEnd: text("window_end").notNull(),
    expectedChunkCount: integer("expected_chunk_count").notNull(),
    status: mobileSyncSessionStatus("status").notNull().default("running"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true, mode: "date" }),
  },
  (table) => ({
    mobileSyncSessionStatusIdx: index("mobile_sync_session_status_idx").on(table.status),
    mobileSyncSessionExpiresAtIdx: index("mobile_sync_session_expires_at_idx").on(table.expiresAt),
    mobileSyncSessionOrganizationUserDeviceIdx: index(
      "mobile_sync_session_organization_id_user_id_device_id_idx",
    ).on(table.organizationId, table.userId, table.deviceId),
    mobileSyncSessionMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "mobile_sync_session_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

export const mobileSyncSessionChunk = pgTable(
  "mobile_sync_session_chunk",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => mobileSyncSession.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    chunkCount: integer("chunk_count").notNull(),
    chunkHash: text("chunk_hash").notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    retentionUntil: timestamp("retention_until", { withTimezone: true, mode: "date" }),
    purgedAt: timestamp("purged_at", { withTimezone: true, mode: "date" }),
    payloadHash: text("payload_hash"),
  },
  (table) => ({
    mobileSyncSessionChunkSessionIdIdx: index("mobile_sync_session_chunk_session_id_idx").on(
      table.sessionId,
    ),
    mobileSyncSessionChunkPurgeIdx: index("mobile_sync_session_chunk_retention_until_purged_idx")
      .on(table.retentionUntil, table.purgedAt)
      .where(sql`${table.purgedAt} IS NULL`),
    mobileSyncSessionChunkSessionChunkUnique: uniqueIndex(
      "mobile_sync_session_chunk_session_id_chunk_index_key",
    ).on(table.sessionId, table.chunkIndex),
  }),
);

// ─── Health Connect ───────────────────────────────────────────

export const healthConnectSyncStatus = pgEnum("health_connect_sync_status", [
  "running",
  "success",
  "partial",
  "failed",
]);

export const healthConnectSync = pgTable(
  "health_connect_sync",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    source: text("source").notNull().default("android_health_connect"),
    attempt: integer("attempt").notNull().default(1),
    status: healthConnectSyncStatus("status").notNull().default("running"),
    payloadVersion: text("payload_version").notNull(),
    windowStart: text("window_start").notNull(),
    windowEnd: text("window_end").notNull(),
    startedAt: text("started_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    startedAtTs: timestamp("started_at_ts", { withTimezone: true, mode: "date" }).notNull(),
    completedAt: text("completed_at"),
    durationMs: integer("duration_ms"),
    errorSummary: text("error_summary"),
    failureCode: text("failure_code"),
    failureStage: text("failure_stage"),
    recordCountsJson: jsonb("record_counts_json"),
    conflictCountsJson: jsonb("conflict_counts_json"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    healthConnectSyncOrgIdx: index("health_connect_sync_organization_id_idx").on(
      table.organizationId,
    ),
    healthConnectSyncOrgIdUnique: uniqueIndex("health_connect_sync_org_id_key").on(
      table.organizationId,
      table.id,
    ),
    healthConnectSyncOrgStartedAtTsIdx: index(
      "health_connect_sync_organization_id_started_at_ts_idx",
    ).on(table.organizationId, sql`${table.startedAtTs} desc nulls last`, desc(table.id)),
    healthConnectSyncOrgFailuresStartedAtTsIdx: index(
      "health_connect_sync_organization_id_started_at_ts_failed_partial_idx",
    )
      .on(table.organizationId, sql`${table.startedAtTs} desc nulls last`, desc(table.id))
      .where(sql`${table.status} in ('failed', 'partial')`),
    healthConnectSyncOrgStatusStartedAtTsIdx: index(
      "health_connect_sync_organization_id_status_started_at_ts_idx",
    ).on(
      table.organizationId,
      table.status,
      sql`${table.startedAtTs} desc nulls last`,
      desc(table.id),
    ),
  }),
);

export const healthConnectRecord = pgTable(
  "health_connect_record",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    syncId: integer("sync_id")
      .notNull()
      .references(() => healthConnectSync.id),
    recordType: text("record_type").notNull(),
    externalRecordId: text("external_record_id"),
    startTime: text("start_time").notNull(),
    startTimeTs: timestamp("start_time_ts", { withTimezone: true, mode: "date" }).notNull(),
    endTime: text("end_time"),
    valueJson: jsonb("value_json").notNull(),
    sourceApp: text("source_app"),
    hash: text("hash").notNull(),
    ingestedAt: text("ingested_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    recordTypeExternalIdUnique: uniqueIndex(
      "health_connect_record_organization_id_type_external_id_key",
    )
      .on(table.organizationId, table.recordType, table.externalRecordId)
      .where(sql`${table.externalRecordId} is not null`),
    recordTypeHashUnique: uniqueIndex("health_connect_record_organization_id_type_hash_key").on(
      table.organizationId,
      table.recordType,
      table.hash,
    ),
    syncIdIdx: index("health_connect_record_sync_id_idx").on(table.syncId),
    startTimeIdx: index("health_connect_record_start_time_idx").on(table.startTime),
    startTimeTsIdx: index("health_connect_record_start_time_ts_idx").on(table.startTimeTs),
    healthConnectRecordOrgStartTimeTsIdx: index(
      "health_connect_record_organization_id_start_time_ts_idx",
    ).on(table.organizationId, table.startTimeTs),
    healthConnectRecordOrgTypeStartTimeTsIdx: index(
      "health_connect_record_organization_id_record_type_start_time_ts_idx",
    ).on(
      table.organizationId,
      table.recordType,
      sql`${table.startTimeTs} desc nulls last`,
      desc(table.id),
    ),
    healthConnectRecordOrgIdx: index("health_connect_record_organization_id_idx").on(
      table.organizationId,
    ),
    healthConnectRecordSyncFk: foreignKey({
      columns: [table.organizationId, table.syncId],
      foreignColumns: [healthConnectSync.organizationId, healthConnectSync.id],
      name: "health_connect_record_org_sync_fk",
    }).onDelete("restrict"),
  }),
);

export const ingestionLog = pgTable(
  "ingestion_log",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    sourcePath: text("source_path"),
    sourceType: text("source_type"), // "pdf", "markdown"
    status: text("status").notNull(), // "pending", "extracted", "approved", "failed"
    extractedData: text("extracted_data"), // JSON
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    ingestionLogOrgIdx: index("ingestion_log_organization_id_idx").on(table.organizationId),
    ingestionLogOrgIdUnique: uniqueIndex("ingestion_log_org_id_key").on(
      table.organizationId,
      table.id,
    ),
  }),
);

export const providerConnectionStatusEnum = pgEnum("provider_connection_status", [
  "active",
  "revoked",
  "disconnected",
]);

export const providerConnection = pgTable(
  "provider_connection",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalUserId: text("external_user_id").notNull(),
    status: providerConnectionStatusEnum("status").notNull().default("active"),
    accessScope: text("access_scope"),
    connectedAt: timestamp("connected_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true, mode: "date" }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    providerConnectionOrgIdx: index("provider_connection_organization_id_idx").on(
      table.organizationId,
    ),
    providerConnectionStatusIdx: index("provider_connection_status_idx").on(table.status),
    providerConnectionOrgIdUnique: uniqueIndex("provider_connection_org_id_key").on(
      table.organizationId,
      table.id,
    ),
    providerConnectionOrgProviderUserUnique: uniqueIndex(
      "provider_connection_org_provider_user_key",
    ).on(table.organizationId, table.provider, table.externalUserId),
  }),
);
