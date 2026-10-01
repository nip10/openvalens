import {
  pgTable,
  pgEnum,
  text,
  integer,
  real,
  serial,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organization, user, member } from "./auth";
import { providerConnection } from "./ingestion";

export const metricDefinitionValueTypeEnum = pgEnum("metric_definition_value_type", [
  "number",
  "text",
  "boolean",
  "json",
]);

export const ingestionJobStatusEnum = pgEnum("ingestion_job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);

export const ingestionBatchStatusEnum = pgEnum("ingestion_batch_status", [
  "processing",
  "completed",
  "failed",
]);

export const ingestionErrorSeverityEnum = pgEnum("ingestion_error_severity", [
  "info",
  "warning",
  "error",
]);

export const dataSource = pgTable(
  "data_source",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    providerConnectionId: integer("provider_connection_id")
      .notNull()
      .references(() => providerConnection.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceKey: text("source_key").notNull(),
    importChannel: text("import_channel"),
    deviceType: text("device_type"),
    deviceModel: text("device_model"),
    softwareVersion: text("software_version"),
    originalSourceName: text("original_source_name"),
    sourceAppId: text("source_app_id"),
    displayName: text("display_name"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    dataSourceOrgIdx: index("data_source_organization_id_idx").on(table.organizationId),
    dataSourceProviderConnectionIdx: index("data_source_provider_connection_id_idx").on(
      table.providerConnectionId,
    ),
    dataSourceOrgProviderConnectionFk: foreignKey({
      columns: [table.organizationId, table.providerConnectionId],
      foreignColumns: [providerConnection.organizationId, providerConnection.id],
      name: "data_source_org_provider_connection_fk",
    }),
    dataSourceOrgIdUnique: uniqueIndex("data_source_org_id_key").on(table.organizationId, table.id),
    dataSourceOrgSourceKeyUnique: uniqueIndex("data_source_org_source_key_key").on(
      table.organizationId,
      table.sourceKey,
    ),
  }),
);

export const metricDefinition = pgTable(
  "metric_definition",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    displayName: text("display_name").notNull(),
    category: text("category"),
    unit: text("unit"),
    valueType: metricDefinitionValueTypeEnum("value_type").notNull().default("number"),
    aggregationDefault: text("aggregation_default"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    metricDefinitionOrgIdx: index("metric_definition_organization_id_idx").on(table.organizationId),
    metricDefinitionCategoryIdx: index("metric_definition_category_idx").on(table.category),
    metricDefinitionOrgIdUnique: uniqueIndex("metric_definition_org_id_key").on(
      table.organizationId,
      table.id,
    ),
    metricDefinitionOrgCodeUnique: uniqueIndex("metric_definition_org_code_key").on(
      table.organizationId,
      table.code,
    ),
  }),
);

export const metricSourcePreference = pgTable(
  "metric_source_preference",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    metricCode: text("metric_code").notNull(),
    preferredSources: jsonb("preferred_sources").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    metricSourcePreferenceOrgIdx: index("metric_source_preference_organization_id_idx").on(
      table.organizationId,
    ),
    metricSourcePreferenceUserIdx: index("metric_source_preference_user_id_idx").on(table.userId),
    metricSourcePreferenceOrgMetricCodeUnique: uniqueIndex(
      "metric_source_preference_org_metric_code_key",
    )
      .on(table.organizationId, table.metricCode)
      .where(sql`${table.userId} is null`),
    metricSourcePreferenceOrgUserMetricCodeUnique: uniqueIndex(
      "metric_source_preference_org_user_metric_code_key",
    )
      .on(table.organizationId, table.userId, table.metricCode)
      .where(sql`${table.userId} is not null`),
    metricSourcePreferenceOrgMetricCodeFk: foreignKey({
      columns: [table.organizationId, table.metricCode],
      foreignColumns: [metricDefinition.organizationId, metricDefinition.code],
      name: "metric_source_preference_org_metric_code_fk",
    }),
    metricSourcePreferenceMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "metric_source_preference_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

export const ingestionJob = pgTable(
  "ingestion_job",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    providerConnectionId: integer("provider_connection_id").references(
      () => providerConnection.id,
      {
        onDelete: "set null",
      },
    ),
    jobType: text("job_type").notNull(),
    status: ingestionJobStatusEnum("status").notNull().default("queued"),
    triggeredBy: text("triggered_by").notNull().default("system"),
    idempotencyKey: text("idempotency_key"),
    windowStart: timestamp("window_start", { withTimezone: true, mode: "date" }),
    windowEnd: timestamp("window_end", { withTimezone: true, mode: "date" }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    ingestionJobOrgIdx: index("ingestion_job_organization_id_idx").on(table.organizationId),
    ingestionJobStatusIdx: index("ingestion_job_status_idx").on(table.status),
    ingestionJobProviderConnectionIdx: index("ingestion_job_provider_connection_id_idx").on(
      table.providerConnectionId,
    ),
    ingestionJobQueuedClaimIdx: index("ingestion_job_queued_claim_idx")
      .on(table.createdAt, table.id)
      .where(sql`${table.status} = 'queued'`),
    ingestionJobRunningReclaimIdx: index("ingestion_job_running_reclaim_idx")
      .on(table.updatedAt, table.createdAt, table.id)
      .where(sql`${table.status} = 'running'`),
    ingestionJobOrgProviderConnectionFk: foreignKey({
      columns: [table.organizationId, table.providerConnectionId],
      foreignColumns: [providerConnection.organizationId, providerConnection.id],
      name: "ingestion_job_org_provider_connection_fk",
    }),
    ingestionJobOrgIdUnique: uniqueIndex("ingestion_job_org_id_key").on(
      table.organizationId,
      table.id,
    ),
    ingestionJobOrgIdempotencyUnique: uniqueIndex("ingestion_job_org_idempotency_key").on(
      table.organizationId,
      table.idempotencyKey,
    ),
  }),
);

export const ingestionBatch = pgTable(
  "ingestion_batch",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ingestionJobId: integer("ingestion_job_id")
      .notNull()
      .references(() => ingestionJob.id, { onDelete: "cascade" }),
    dataSourceId: integer("data_source_id").references(() => dataSource.id, {
      onDelete: "set null",
    }),
    externalBatchId: text("external_batch_id"),
    status: ingestionBatchStatusEnum("status").notNull().default("processing"),
    recordCount: integer("record_count").notNull().default(0),
    acceptedCount: integer("accepted_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    ingestionBatchOrgIdx: index("ingestion_batch_organization_id_idx").on(table.organizationId),
    ingestionBatchJobIdx: index("ingestion_batch_ingestion_job_id_idx").on(table.ingestionJobId),
    ingestionBatchStatusIdx: index("ingestion_batch_status_idx").on(table.status),
    ingestionBatchOrgIngestionJobFk: foreignKey({
      columns: [table.organizationId, table.ingestionJobId],
      foreignColumns: [ingestionJob.organizationId, ingestionJob.id],
      name: "ingestion_batch_org_ingestion_job_fk",
    }),
    ingestionBatchOrgDataSourceFk: foreignKey({
      columns: [table.organizationId, table.dataSourceId],
      foreignColumns: [dataSource.organizationId, dataSource.id],
      name: "ingestion_batch_org_data_source_fk",
    }),
    ingestionBatchOrgIdUnique: uniqueIndex("ingestion_batch_org_id_key").on(
      table.organizationId,
      table.id,
    ),
    ingestionBatchExternalUnique: uniqueIndex("ingestion_batch_org_job_external_batch_key").on(
      table.organizationId,
      table.ingestionJobId,
      table.externalBatchId,
    ),
  }),
);

export const metricSample = pgTable(
  "metric_sample",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    dataSourceId: integer("data_source_id").references(() => dataSource.id, {
      onDelete: "set null",
    }),
    metricDefinitionId: integer("metric_definition_id")
      .notNull()
      .references(() => metricDefinition.id, { onDelete: "cascade" }),
    ingestionBatchId: integer("ingestion_batch_id").references(() => ingestionBatch.id, {
      onDelete: "set null",
    }),
    sampledAt: timestamp("sampled_at", { withTimezone: true, mode: "date" }).notNull(),
    numericValue: real("numeric_value"),
    textValue: text("text_value"),
    unit: text("unit"),
    externalSampleId: text("external_sample_id"),
    dedupeHash: text("dedupe_hash").notNull(),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    /** Set when the source deleted or replaced this reading; the row is kept for lineage. */
    supersededAt: timestamp("superseded_at", { withTimezone: true, mode: "date" }),
  },
  (table) => ({
    metricSampleOrgIdx: index("metric_sample_organization_id_idx").on(table.organizationId),
    metricSampleOrgExternalIdx: index("metric_sample_organization_id_external_sample_id_idx").on(
      table.organizationId,
      table.externalSampleId,
    ),
    metricSampleMetricTimeIdx: index("metric_sample_metric_definition_id_sampled_at_idx").on(
      table.metricDefinitionId,
      table.sampledAt,
    ),
    metricSampleDataSourceIdx: index("metric_sample_data_source_id_idx").on(table.dataSourceId),
    metricSampleIngestionBatchIdx: index("metric_sample_ingestion_batch_id_idx").on(
      table.ingestionBatchId,
    ),
    metricSampleOrgMetricDefinitionFk: foreignKey({
      columns: [table.organizationId, table.metricDefinitionId],
      foreignColumns: [metricDefinition.organizationId, metricDefinition.id],
      name: "metric_sample_org_metric_definition_fk",
    }),
    metricSampleOrgDataSourceFk: foreignKey({
      columns: [table.organizationId, table.dataSourceId],
      foreignColumns: [dataSource.organizationId, dataSource.id],
      name: "metric_sample_org_data_source_fk",
    }),
    metricSampleOrgIngestionBatchFk: foreignKey({
      columns: [table.organizationId, table.ingestionBatchId],
      foreignColumns: [ingestionBatch.organizationId, ingestionBatch.id],
      name: "metric_sample_org_ingestion_batch_fk",
    }),
    metricSampleOrgIdUnique: uniqueIndex("metric_sample_org_id_key").on(
      table.organizationId,
      table.id,
    ),
    metricSampleOrgDedupeHashUnique: uniqueIndex("metric_sample_org_dedupe_hash_key").on(
      table.organizationId,
      table.dedupeHash,
    ),
  }),
);

export const healthEvent = pgTable(
  "health_event",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    dataSourceId: integer("data_source_id").references(() => dataSource.id, {
      onDelete: "set null",
    }),
    ingestionBatchId: integer("ingestion_batch_id").references(() => ingestionBatch.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    eventAt: timestamp("event_at", { withTimezone: true, mode: "date" }).notNull(),
    title: text("title"),
    payloadJson: jsonb("payload_json"),
    sourceEventId: text("source_event_id"),
    dedupeHash: text("dedupe_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    /** Set when the source deleted or replaced this event; the row is kept for lineage. */
    supersededAt: timestamp("superseded_at", { withTimezone: true, mode: "date" }),
  },
  (table) => ({
    healthEventOrgIdx: index("health_event_organization_id_idx").on(table.organizationId),
    healthEventOrgSourceEventIdx: index("health_event_organization_id_source_event_id_idx").on(
      table.organizationId,
      table.sourceEventId,
    ),
    healthEventTypeTimeIdx: index("health_event_event_type_event_at_idx").on(
      table.eventType,
      table.eventAt,
    ),
    healthEventDataSourceIdx: index("health_event_data_source_id_idx").on(table.dataSourceId),
    healthEventIngestionBatchIdx: index("health_event_ingestion_batch_id_idx").on(
      table.ingestionBatchId,
    ),
    healthEventOrgDataSourceFk: foreignKey({
      columns: [table.organizationId, table.dataSourceId],
      foreignColumns: [dataSource.organizationId, dataSource.id],
      name: "health_event_org_data_source_fk",
    }),
    healthEventOrgIngestionBatchFk: foreignKey({
      columns: [table.organizationId, table.ingestionBatchId],
      foreignColumns: [ingestionBatch.organizationId, ingestionBatch.id],
      name: "health_event_org_ingestion_batch_fk",
    }),
    healthEventOrgDedupeHashUnique: uniqueIndex("health_event_org_dedupe_hash_key").on(
      table.organizationId,
      table.dedupeHash,
    ),
  }),
);

export const ingestionError = pgTable(
  "ingestion_error",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ingestionJobId: integer("ingestion_job_id").references(() => ingestionJob.id, {
      onDelete: "cascade",
    }),
    ingestionBatchId: integer("ingestion_batch_id").references(() => ingestionBatch.id, {
      onDelete: "cascade",
    }),
    metricSampleId: integer("metric_sample_id").references(() => metricSample.id, {
      onDelete: "set null",
    }),
    errorCode: text("error_code").notNull(),
    severity: ingestionErrorSeverityEnum("severity").notNull().default("error"),
    message: text("message").notNull(),
    rawPayloadJson: jsonb("raw_payload_json"),
    dedupeHash: text("dedupe_hash"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    ingestionErrorOrgIdx: index("ingestion_error_organization_id_idx").on(table.organizationId),
    ingestionErrorJobIdx: index("ingestion_error_ingestion_job_id_idx").on(table.ingestionJobId),
    ingestionErrorBatchIdx: index("ingestion_error_ingestion_batch_id_idx").on(
      table.ingestionBatchId,
    ),
    ingestionErrorSeverityIdx: index("ingestion_error_severity_idx").on(table.severity),
    ingestionErrorOrgIngestionJobFk: foreignKey({
      columns: [table.organizationId, table.ingestionJobId],
      foreignColumns: [ingestionJob.organizationId, ingestionJob.id],
      name: "ingestion_error_org_ingestion_job_fk",
    }),
    ingestionErrorOrgIngestionBatchFk: foreignKey({
      columns: [table.organizationId, table.ingestionBatchId],
      foreignColumns: [ingestionBatch.organizationId, ingestionBatch.id],
      name: "ingestion_error_org_ingestion_batch_fk",
    }),
    ingestionErrorOrgMetricSampleFk: foreignKey({
      columns: [table.organizationId, table.metricSampleId],
      foreignColumns: [metricSample.organizationId, metricSample.id],
      name: "ingestion_error_org_metric_sample_fk",
    }),
    ingestionErrorOrgDedupeUnique: uniqueIndex("ingestion_error_org_dedupe_hash_key").on(
      table.organizationId,
      table.dedupeHash,
    ),
  }),
);

export const ingestionRawArtifact = pgTable(
  "ingestion_raw_artifact",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    providerConnectionId: integer("provider_connection_id").references(
      () => providerConnection.id,
      {
        onDelete: "set null",
      },
    ),
    ingestionJobId: integer("ingestion_job_id").references(() => ingestionJob.id, {
      onDelete: "cascade",
    }),
    ingestionBatchId: integer("ingestion_batch_id").references(() => ingestionBatch.id, {
      onDelete: "cascade",
    }),
    artifactType: text("artifact_type").notNull(),
    traceId: text("trace_id"),
    payloadJson: jsonb("payload_json").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    retentionUntil: timestamp("retention_until", { withTimezone: true, mode: "date" }),
    purgedAt: timestamp("purged_at", { withTimezone: true, mode: "date" }),
    payloadHash: text("payload_hash"),
    retentionClass: text("retention_class"),
  },
  (table) => ({
    ingestionRawArtifactOrgIdx: index("ingestion_raw_artifact_organization_id_idx").on(
      table.organizationId,
    ),
    ingestionRawArtifactProviderConnectionIdx: index(
      "ingestion_raw_artifact_provider_connection_id_idx",
    ).on(table.providerConnectionId),
    ingestionRawArtifactJobIdx: index("ingestion_raw_artifact_ingestion_job_id_idx").on(
      table.ingestionJobId,
    ),
    ingestionRawArtifactBatchIdx: index("ingestion_raw_artifact_ingestion_batch_id_idx").on(
      table.ingestionBatchId,
    ),
    ingestionRawArtifactTraceIdx: index("ingestion_raw_artifact_trace_id_idx").on(table.traceId),
    ingestionRawArtifactCapturedAtIdx: index("ingestion_raw_artifact_captured_at_idx").on(
      table.capturedAt,
    ),
    ingestionRawArtifactRetentionIdx: index("ingestion_raw_artifact_retention_until_purged_idx")
      .on(table.retentionUntil, table.purgedAt)
      .where(sql`${table.purgedAt} IS NULL`),
    ingestionRawArtifactOrgProviderConnectionFk: foreignKey({
      columns: [table.organizationId, table.providerConnectionId],
      foreignColumns: [providerConnection.organizationId, providerConnection.id],
      name: "ingestion_raw_artifact_org_provider_connection_fk",
    }),
    ingestionRawArtifactOrgIngestionJobFk: foreignKey({
      columns: [table.organizationId, table.ingestionJobId],
      foreignColumns: [ingestionJob.organizationId, ingestionJob.id],
      name: "ingestion_raw_artifact_org_ingestion_job_fk",
    }),
    ingestionRawArtifactOrgIngestionBatchFk: foreignKey({
      columns: [table.organizationId, table.ingestionBatchId],
      foreignColumns: [ingestionBatch.organizationId, ingestionBatch.id],
      name: "ingestion_raw_artifact_org_ingestion_batch_fk",
    }),
    ingestionRawArtifactOrgIdUnique: uniqueIndex("ingestion_raw_artifact_org_id_key").on(
      table.organizationId,
      table.id,
    ),
    ingestionRawArtifactSizeBytesNonNegative: check(
      "ingestion_raw_artifact_size_bytes_non_negative_check",
      sql`${table.sizeBytes} >= 0`,
    ),
  }),
);

export const provenanceLink = pgTable(
  "provenance_link",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    targetTable: text("target_table").notNull(),
    targetId: integer("target_id").notNull(),
    sourceTable: text("source_table").notNull(),
    sourceId: integer("source_id").notNull(),
    relation: text("relation").notNull().default("derived_from"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    provenanceLinkOrgIdx: index("provenance_link_organization_id_idx").on(table.organizationId),
    provenanceLinkTargetIdx: index("provenance_link_target_table_target_id_idx").on(
      table.targetTable,
      table.targetId,
    ),
    provenanceLinkSourceIdx: index("provenance_link_source_table_source_id_idx").on(
      table.sourceTable,
      table.sourceId,
    ),
    provenanceLinkUnique: uniqueIndex("provenance_link_org_target_source_relation_key").on(
      table.organizationId,
      table.targetTable,
      table.targetId,
      table.sourceTable,
      table.sourceId,
      table.relation,
    ),
  }),
);
