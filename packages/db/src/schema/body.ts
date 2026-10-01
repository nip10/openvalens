import {
  pgTable,
  text,
  integer,
  real,
  serial,
  jsonb,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql, desc } from "drizzle-orm";

import { orgId, user, member } from "./auth";

// ─── DEXA / Body Composition ──────────────────────────────────

export const dexaScan = pgTable(
  "dexa_scan",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    date: text("date").notNull(),
    height: real("height"), // cm
    weight: real("weight"), // kg
    age: real("age"),
    totalMass: real("total_mass"), // kg
    fatMass: real("fat_mass"), // g
    leanMass: real("lean_mass"), // g
    boneMineralContent: real("bone_mineral_content"), // g
    bodyFatPct: real("body_fat_pct"),
    leanTissuePct: real("lean_tissue_pct"),
    bmi: real("bmi"),
    androidFatPct: real("android_fat_pct"),
    gynoidFatPct: real("gynoid_fat_pct"),
    agRatio: real("ag_ratio"),
    rmr: real("rmr"), // cal/day
    rsmi: real("rsmi"), // kg/m²
    bmdTotal: real("bmd_total"), // g/cm²
    tScore: real("t_score"),
    zScore: real("z_score"),
    bmdPercentile: integer("bmd_percentile"),
    sourceFile: text("source_file"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    dexaScanOrgIdx: index("dexa_scan_organization_id_idx").on(table.organizationId),
    dexaScanOrgIdUnique: uniqueIndex("dexa_scan_org_id_key").on(table.organizationId, table.id),
    dexaScanOrgDateIdx: index("dexa_scan_organization_id_date_idx").on(
      table.organizationId,
      table.date,
    ),
  }),
);

export const dexaRegional = pgTable(
  "dexa_regional",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    scanId: integer("scan_id")
      .notNull()
      .references(() => dexaScan.id),
    measurementType: text("measurement_type").notNull(), // "fat_pct", "bmd"
    region: text("region").notNull(), // "right_arm", "left_trunk", "head", etc.
    value: real("value").notNull(),
  },
  (table) => ({
    dexaRegionalOrgIdx: index("dexa_regional_organization_id_idx").on(table.organizationId),
    dexaRegionalOrgScanIdx: index("dexa_regional_organization_id_scan_id_idx").on(
      table.organizationId,
      table.scanId,
    ),
    dexaRegionalScanFk: foreignKey({
      columns: [table.organizationId, table.scanId],
      foreignColumns: [dexaScan.organizationId, dexaScan.id],
      name: "dexa_regional_org_scan_fk",
    }).onDelete("cascade"),
  }),
);

// ─── Manual Tracking ──────────────────────────────────────────

export const weightEvent = pgTable(
  "weight_event",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    measuredAt: text("measured_at").notNull(),
    date: text("date").notNull(),
    weightKg: real("weight_kg").notNull(),
    confidence: real("confidence"),
    metadataJson: jsonb("metadata_json"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    /** Set when the source reading was deleted or replaced (#44); kept for lineage. */
    supersededAt: text("superseded_at"),
  },
  (table) => ({
    weightEventOrgIdx: index("weight_event_organization_id_idx").on(table.organizationId),
    weightEventOrgIdUnique: uniqueIndex("weight_event_org_id_key").on(
      table.organizationId,
      table.id,
    ),
    weightEventUserDateIdx: index("weight_event_user_id_date_idx").on(table.userId, table.date),
    weightEventMeasuredAtIdx: index("weight_event_measured_at_idx").on(table.measuredAt),
    weightEventWeightPositiveCheck: check(
      "weight_event_weight_kg_positive_check",
      sql`${table.weightKg} > 0`,
    ),
    weightEventConfidenceRangeCheck: check(
      "weight_event_confidence_range_check",
      sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`,
    ),
    weightEventMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "weight_event_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

export const dailyWeight = pgTable(
  "daily_weight",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    weightKg: real("weight_kg").notNull(),
    source: text("source").notNull(),
    resolvedFromEventId: integer("resolved_from_event_id").references(() => weightEvent.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    dailyWeightOrgUserDateUnique: uniqueIndex("daily_weight_org_user_date_key").on(
      table.organizationId,
      table.userId,
      table.date,
    ),
    dailyWeightOrgIdx: index("daily_weight_organization_id_idx").on(table.organizationId),
    dailyWeightOrgDateIdx: index("daily_weight_organization_id_date_idx").on(
      table.organizationId,
      desc(table.date),
      desc(table.id),
    ),
    dailyWeightOrgUserDateIdx: index("daily_weight_organization_id_user_id_date_idx").on(
      table.organizationId,
      table.userId,
      desc(table.date),
      desc(table.id),
    ),
    dailyWeightResolvedFromEventIdx: index("daily_weight_resolved_from_event_id_idx").on(
      table.resolvedFromEventId,
    ),
    dailyWeightResolvedFromEventFk: foreignKey({
      columns: [table.organizationId, table.resolvedFromEventId],
      foreignColumns: [weightEvent.organizationId, weightEvent.id],
      name: "daily_weight_org_resolved_from_event_fk",
    }).onDelete("restrict"),
    dailyWeightMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "daily_weight_org_user_member_fk",
    }).onDelete("restrict"),
    dailyWeightWeightPositiveCheck: check(
      "daily_weight_weight_kg_positive_check",
      sql`${table.weightKg} > 0`,
    ),
  }),
);

export const dailyWeightOverride = pgTable(
  "daily_weight_override",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    weightKg: real("weight_kg").notNull(),
    reason: text("reason"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    revokedAt: text("revoked_at"),
  },
  (table) => ({
    dailyWeightOverrideOrgIdx: index("daily_weight_override_organization_id_idx").on(
      table.organizationId,
    ),
    dailyWeightOverrideOrgUserDateIdx: index("daily_weight_override_org_user_date_idx").on(
      table.organizationId,
      table.userId,
      table.date,
    ),
    dailyWeightOverrideCreatedByUserIdx: index("daily_weight_override_created_by_user_id_idx").on(
      table.createdByUserId,
    ),
    dailyWeightOverrideOrgUserDateActiveUnique: uniqueIndex(
      "daily_weight_override_org_user_date_active_key",
    )
      .on(table.organizationId, table.userId, table.date)
      .where(sql`${table.revokedAt} is null`),
    dailyWeightOverrideWeightPositiveCheck: check(
      "daily_weight_override_weight_kg_positive_check",
      sql`${table.weightKg} > 0`,
    ),
    dailyWeightOverrideMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "daily_weight_override_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

export const bodyCompEvent = pgTable(
  "body_comp_event",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    measuredAt: text("measured_at").notNull(),
    date: text("date").notNull(),
    confidence: real("confidence"),
    weightKg: real("weight_kg"),
    bodyFatPct: real("body_fat_pct"),
    fatMassKg: real("fat_mass_kg"),
    leanMassKg: real("lean_mass_kg"),
    boneMassKg: real("bone_mass_kg"),
    metadataJson: jsonb("metadata_json"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    bodyCompEventOrgIdx: index("body_comp_event_organization_id_idx").on(table.organizationId),
    bodyCompEventOrgDateIdx: index("body_comp_event_organization_id_date_idx").on(
      table.organizationId,
      desc(table.date),
      desc(table.measuredAt),
      desc(table.id),
    ),
    bodyCompEventOrgUserDateIdx: index("body_comp_event_organization_id_user_id_date_idx").on(
      table.organizationId,
      table.userId,
      desc(table.date),
      desc(table.measuredAt),
      desc(table.id),
    ),
    bodyCompEventUserDateIdx: index("body_comp_event_user_id_date_idx").on(
      table.userId,
      desc(table.date),
      desc(table.measuredAt),
      desc(table.id),
    ),
    bodyCompEventMeasuredAtIdx: index("body_comp_event_measured_at_idx").on(
      desc(table.measuredAt),
      desc(table.id),
    ),
    bodyCompEventBodyFatPctCheck: check(
      "body_comp_event_body_fat_pct_range_check",
      sql`${table.bodyFatPct} is null or (${table.bodyFatPct} >= 0 and ${table.bodyFatPct} <= 100)`,
    ),
    bodyCompEventWeightPositiveCheck: check(
      "body_comp_event_weight_kg_positive_check",
      sql`${table.weightKg} is null or ${table.weightKg} > 0`,
    ),
    bodyCompEventFatMassPositiveCheck: check(
      "body_comp_event_fat_mass_kg_positive_check",
      sql`${table.fatMassKg} is null or ${table.fatMassKg} > 0`,
    ),
    bodyCompEventLeanMassPositiveCheck: check(
      "body_comp_event_lean_mass_kg_positive_check",
      sql`${table.leanMassKg} is null or ${table.leanMassKg} > 0`,
    ),
    bodyCompEventBoneMassPositiveCheck: check(
      "body_comp_event_bone_mass_kg_positive_check",
      sql`${table.boneMassKg} is null or ${table.boneMassKg} > 0`,
    ),
    bodyCompEventConfidenceRangeCheck: check(
      "body_comp_event_confidence_range_check",
      sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`,
    ),
    bodyCompEventMetricPresenceCheck: check(
      "body_comp_event_metric_presence_check",
      sql`${table.weightKg} is not null or ${table.bodyFatPct} is not null or ${table.fatMassKg} is not null or ${table.leanMassKg} is not null or ${table.boneMassKg} is not null`,
    ),
    bodyCompEventMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "body_comp_event_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

export const weightCheckin = pgTable(
  "weight_checkin",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    date: text("date").notNull(),
    weightKg: real("weight_kg").notNull(),
    bodyFatPct: real("body_fat_pct"),
    notes: text("notes"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    weightCheckinOrgIdx: index("weight_checkin_organization_id_idx").on(table.organizationId),
    weightCheckinOrgDateIdx: index("weight_checkin_organization_id_date_idx").on(
      table.organizationId,
      table.date,
    ),
  }),
);
