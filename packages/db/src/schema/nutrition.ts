import { sql, type SQL } from "drizzle-orm";
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { member, orgId, user } from "./auth";

// ─── Nutrition core (Issue #74) ───────────────────────────────
//
// Additive v1 core for the nutrition diary: private custom foods, immutable
// food/nutrient snapshots, local-day meals and their entries, and optional
// user-owned goals. Every table is organization-scoped; user-owned rows also
// carry a composite (organization_id, user_id) member FK like `daily_weight`.
//
// Public food catalogs (FDC, Open Food Facts; #72) are NOT tenant records and
// are not stored here. A diary entry references a catalog food only through a
// source-qualified identity (`source` + `source_food_id` + `source_version`)
// copied into its snapshot, so catalog refreshes can never rewrite history.
//
// Nutrient columns are nullable on purpose: `null` means "not provided by the
// source", which is different from a recorded zero. Salt is not sodium, and
// total sugars are not added or free sugars; no column is derived from another.

/**
 * Core nutrient columns shared by custom foods and snapshots. Values are per
 * `nutrient_basis_amount` of `nutrient_basis_unit`. Units are in the names.
 */
const nutrientColumns = () => ({
  energyKcal: real("energy_kcal"),
  energyKj: real("energy_kj"),
  proteinG: real("protein_g"),
  carbohydrateG: real("carbohydrate_g"),
  fatG: real("fat_g"),
  saturatedFatG: real("saturated_fat_g"),
  fiberG: real("fiber_g"),
  totalSugarsG: real("total_sugars_g"),
  addedSugarsG: real("added_sugars_g"),
  freeSugarsG: real("free_sugars_g"),
  sodiumMg: real("sodium_mg"),
  saltG: real("salt_g"),
});

type NutrientColumnKey = keyof ReturnType<typeof nutrientColumns>;
const NUTRIENT_COLUMN_KEYS = Object.keys(nutrientColumns()) as NutrientColumnKey[];

/** Every nutrient value is either absent (null) or a non-negative number. */
const nutrientsNonNegative = (table: Record<NutrientColumnKey, AnyPgColumn>): SQL =>
  sql.join(
    NUTRIENT_COLUMN_KEYS.map((key) => sql`(${table[key]} is null or ${table[key]} >= 0)`),
    sql` and `,
  );

/** Columns describing the nutrient basis and an optional household serving. */
const basisColumns = () => ({
  nutrientBasisAmount: real("nutrient_basis_amount").notNull(),
  /** `g` / `ml` (e.g. per 100 g) or `serving` (label values per serving). */
  nutrientBasisUnit: text("nutrient_basis_unit").$type<"g" | "ml" | "serving">().notNull(),
  servingSizeAmount: real("serving_size_amount"),
  /** Mass or volume of one serving; never inferred across g/ml. */
  servingSizeUnit: text("serving_size_unit").$type<"g" | "ml">(),
  servingLabel: text("serving_label"),
});

type BasisColumns = { [K in keyof ReturnType<typeof basisColumns>]: AnyPgColumn };

const basisChecks = (name: string, table: BasisColumns) => ({
  basisAmount: check(`${name}_nutrient_basis_amount_check`, sql`${table.nutrientBasisAmount} > 0`),
  basisUnit: check(
    `${name}_nutrient_basis_unit_check`,
    sql`${table.nutrientBasisUnit} in ('g', 'ml', 'serving')`,
  ),
  serving: check(
    `${name}_serving_size_check`,
    sql`(${table.servingSizeAmount} is null and ${table.servingSizeUnit} is null) or (${table.servingSizeAmount} > 0 and ${table.servingSizeUnit} in ('g', 'ml'))`,
  ),
});

/**
 * Private custom foods. Visible only inside their organization; `user_id` is
 * the member who created it. Edits bump `revision` and never touch snapshots
 * already taken. Archive instead of delete once a food has been logged.
 */
export const nutritionFood = pgTable(
  "nutrition_food",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    brand: text("brand"),
    /** Normalized digits-only GTIN/EAN/UPC, when the user recorded one. */
    barcode: text("barcode"),
    ...basisColumns(),
    ...nutrientColumns(),
    revision: integer("revision").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    nutritionFoodOrgIdUnique: uniqueIndex("nutrition_food_org_id_key").on(
      table.organizationId,
      table.id,
    ),
    nutritionFoodOrgUserIdx: index("nutrition_food_organization_id_user_id_idx").on(
      table.organizationId,
      table.userId,
    ),
    nutritionFoodOrgBarcodeIdx: index("nutrition_food_organization_id_barcode_idx")
      .on(table.organizationId, table.barcode)
      .where(sql`${table.barcode} is not null`),
    nutritionFoodUserIdx: index("nutrition_food_user_id_idx").on(table.userId),
    ...basisChecks("nutrition_food", table),
    nutritionFoodNameCheck: check("nutrition_food_name_check", sql`length(${table.name}) > 0`),
    nutritionFoodBarcodeCheck: check(
      "nutrition_food_barcode_check",
      sql`${table.barcode} is null or ${table.barcode} ~ '^[0-9]{8,14}$'`,
    ),
    nutritionFoodRevisionCheck: check("nutrition_food_revision_check", sql`${table.revision} >= 1`),
    nutritionFoodNutrientsCheck: check(
      "nutrition_food_nutrients_non_negative_check",
      nutrientsNonNegative(table),
    ),
    nutritionFoodMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "nutrition_food_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

/**
 * Immutable copy of a food's identity and nutrients at logging time. Rows are
 * insert-only (a trigger in the migration rejects UPDATE); identical content
 * in one organization is stored once via `content_hash`.
 *
 * Source identity: `custom` rows point at `nutrition_food` and record its
 * revision as `source_version`; `fdc` / `off` rows carry the catalog's stable
 * id and dataset version; `manual` rows are one-off quick-add values.
 */
export const nutritionFoodSnapshot = pgTable(
  "nutrition_food_snapshot",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    source: text("source").$type<"custom" | "fdc" | "off" | "manual">().notNull(),
    sourceFoodId: text("source_food_id"),
    sourceVersion: text("source_version"),
    customFoodId: integer("custom_food_id"),
    attribution: text("attribution"),
    name: text("name").notNull(),
    brand: text("brand"),
    barcode: text("barcode"),
    ...basisColumns(),
    ...nutrientColumns(),
    /** SHA-256 of the canonical snapshot content; see `@openvalens/nutrition`. */
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    nutritionFoodSnapshotOrgIdUnique: uniqueIndex("nutrition_food_snapshot_org_id_key").on(
      table.organizationId,
      table.id,
    ),
    nutritionFoodSnapshotOrgHashUnique: uniqueIndex(
      "nutrition_food_snapshot_org_content_hash_key",
    ).on(table.organizationId, table.contentHash),
    nutritionFoodSnapshotOrgSourceIdx: index("nutrition_food_snapshot_org_source_idx").on(
      table.organizationId,
      table.source,
      table.sourceFoodId,
    ),
    nutritionFoodSnapshotOrgCustomFoodIdx: index("nutrition_food_snapshot_org_custom_food_idx")
      .on(table.organizationId, table.customFoodId)
      .where(sql`${table.customFoodId} is not null`),
    ...basisChecks("nutrition_food_snapshot", table),
    nutritionFoodSnapshotSourceCheck: check(
      "nutrition_food_snapshot_source_check",
      sql`(${table.source} = 'custom' and ${table.customFoodId} is not null and ${table.sourceFoodId} is not null and ${table.sourceVersion} is not null)
        or (${table.source} in ('fdc', 'off') and ${table.customFoodId} is null and ${table.sourceFoodId} is not null)
        or (${table.source} = 'manual' and ${table.customFoodId} is null and ${table.sourceFoodId} is null)`,
    ),
    nutritionFoodSnapshotNameCheck: check(
      "nutrition_food_snapshot_name_check",
      sql`length(${table.name}) > 0`,
    ),
    nutritionFoodSnapshotNutrientsCheck: check(
      "nutrition_food_snapshot_nutrients_non_negative_check",
      nutrientsNonNegative(table),
    ),
    nutritionFoodSnapshotCustomFoodFk: foreignKey({
      columns: [table.organizationId, table.customFoodId],
      foreignColumns: [nutritionFood.organizationId, nutritionFood.id],
      name: "nutrition_food_snapshot_org_custom_food_fk",
    }).onDelete("restrict"),
  }),
);

/**
 * One meal slot on one local calendar day for one member. `local_date` is the
 * member's own day (YYYY-MM-DD) in `time_zone` (IANA) at logging time; it is
 * never recomputed from UTC later.
 */
export const nutritionMeal = pgTable(
  "nutrition_meal",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    localDate: text("local_date").notNull(),
    timeZone: text("time_zone").notNull(),
    slot: text("slot").$type<"breakfast" | "lunch" | "dinner" | "snack" | "other">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    nutritionMealOrgIdUnique: uniqueIndex("nutrition_meal_org_id_key").on(
      table.organizationId,
      table.id,
    ),
    nutritionMealOrgUserIdUnique: uniqueIndex("nutrition_meal_org_user_id_key").on(
      table.organizationId,
      table.userId,
      table.id,
    ),
    nutritionMealOrgUserDateSlotUnique: uniqueIndex("nutrition_meal_org_user_date_slot_key").on(
      table.organizationId,
      table.userId,
      table.localDate,
      table.slot,
    ),
    nutritionMealUserIdx: index("nutrition_meal_user_id_idx").on(table.userId),
    nutritionMealLocalDateCheck: check(
      "nutrition_meal_local_date_check",
      sql`${table.localDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
    ),
    nutritionMealTimeZoneCheck: check(
      "nutrition_meal_time_zone_check",
      sql`length(${table.timeZone}) > 0`,
    ),
    nutritionMealSlotCheck: check(
      "nutrition_meal_slot_check",
      sql`${table.slot} in ('breakfast', 'lunch', 'dinner', 'snack', 'other')`,
    ),
    nutritionMealMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "nutrition_meal_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

/**
 * A logged amount of one snapshot inside a meal. `nutrient_factor` converts
 * the snapshot's per-basis values to this entry (`value * factor`) and is
 * recomputed whenever amount/unit change. `client_mutation_id` makes offline
 * replays idempotent. `deleted_at` is a soft delete so undo keeps history.
 */
export const nutritionMealEntry = pgTable(
  "nutrition_meal_entry",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mealId: integer("meal_id").notNull(),
    snapshotId: integer("snapshot_id").notNull(),
    amount: real("amount").notNull(),
    unit: text("unit").$type<"g" | "ml" | "serving">().notNull(),
    nutrientFactor: doublePrecision("nutrient_factor").notNull(),
    method: text("method")
      .$type<"manual" | "search" | "barcode" | "quick_add" | "copied">()
      .notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    clientMutationId: text("client_mutation_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    nutritionMealEntryOrgIdUnique: uniqueIndex("nutrition_meal_entry_org_id_key").on(
      table.organizationId,
      table.id,
    ),
    nutritionMealEntryOrgMealIdx: index("nutrition_meal_entry_organization_id_meal_id_idx").on(
      table.organizationId,
      table.mealId,
    ),
    nutritionMealEntryOrgSnapshotIdx: index(
      "nutrition_meal_entry_organization_id_snapshot_id_idx",
    ).on(table.organizationId, table.snapshotId),
    nutritionMealEntryUserIdx: index("nutrition_meal_entry_user_id_idx").on(table.userId),
    nutritionMealEntryClientMutationUnique: uniqueIndex(
      "nutrition_meal_entry_org_user_client_mutation_key",
    )
      .on(table.organizationId, table.userId, table.clientMutationId)
      .where(sql`${table.clientMutationId} is not null`),
    nutritionMealEntryAmountCheck: check(
      "nutrition_meal_entry_amount_check",
      sql`${table.amount} > 0`,
    ),
    nutritionMealEntryUnitCheck: check(
      "nutrition_meal_entry_unit_check",
      sql`${table.unit} in ('g', 'ml', 'serving')`,
    ),
    nutritionMealEntryFactorCheck: check(
      "nutrition_meal_entry_nutrient_factor_check",
      sql`${table.nutrientFactor} >= 0`,
    ),
    nutritionMealEntryMethodCheck: check(
      "nutrition_meal_entry_method_check",
      sql`${table.method} in ('manual', 'search', 'barcode', 'quick_add', 'copied')`,
    ),
    nutritionMealEntryClientMutationCheck: check(
      "nutrition_meal_entry_client_mutation_id_check",
      sql`${table.clientMutationId} is null or length(${table.clientMutationId}) between 1 and 128`,
    ),
    nutritionMealEntryMealFk: foreignKey({
      columns: [table.organizationId, table.userId, table.mealId],
      foreignColumns: [nutritionMeal.organizationId, nutritionMeal.userId, nutritionMeal.id],
      name: "nutrition_meal_entry_org_user_meal_fk",
    }).onDelete("restrict"),
    nutritionMealEntrySnapshotFk: foreignKey({
      columns: [table.organizationId, table.snapshotId],
      foreignColumns: [nutritionFoodSnapshot.organizationId, nutritionFoodSnapshot.id],
      name: "nutrition_meal_entry_org_snapshot_fk",
    }).onDelete("restrict"),
    nutritionMealEntryMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "nutrition_meal_entry_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

/**
 * Optional, user-owned nutrient goals. Nothing requires a goal; at most one
 * active (unarchived) goal per nutrient per member. Units follow the nutrient
 * key (e.g. `protein_g` is grams per local day).
 */
export const nutritionGoal = pgTable(
  "nutrition_goal",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    nutrient: text("nutrient").notNull(),
    minAmount: real("min_amount"),
    maxAmount: real("max_amount"),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    nutritionGoalOrgUserIdx: index("nutrition_goal_organization_id_user_id_idx").on(
      table.organizationId,
      table.userId,
    ),
    nutritionGoalUserIdx: index("nutrition_goal_user_id_idx").on(table.userId),
    nutritionGoalActiveUnique: uniqueIndex("nutrition_goal_org_user_nutrient_active_key")
      .on(table.organizationId, table.userId, table.nutrient)
      .where(sql`${table.archivedAt} is null`),
    nutritionGoalNutrientCheck: check(
      "nutrition_goal_nutrient_check",
      sql`${table.nutrient} in ('energy_kcal', 'energy_kj', 'protein_g', 'carbohydrate_g', 'fat_g', 'saturated_fat_g', 'fiber_g', 'total_sugars_g', 'added_sugars_g', 'free_sugars_g', 'sodium_mg', 'salt_g')`,
    ),
    nutritionGoalRangeCheck: check(
      "nutrition_goal_range_check",
      sql`(${table.minAmount} is not null or ${table.maxAmount} is not null)
        and (${table.minAmount} is null or ${table.minAmount} >= 0)
        and (${table.maxAmount} is null or ${table.maxAmount} >= 0)
        and (${table.minAmount} is null or ${table.maxAmount} is null or ${table.minAmount} <= ${table.maxAmount})`,
    ),
    nutritionGoalMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "nutrition_goal_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);
