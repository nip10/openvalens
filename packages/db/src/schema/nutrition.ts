import { sql, type SQL } from "drizzle-orm";
import {
  check,
  doublePrecision,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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
export const nutrientColumns = () => ({
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

export type NutrientColumnKey = keyof ReturnType<typeof nutrientColumns>;

/**
 * Optional micronutrient columns (Issue #78), per the same basis as the core
 * nutrients. `null` means the source did not report the nutrient. They feed
 * only the opt-in micronutrient summary, never the core diary totals.
 */
export const micronutrientColumns = () => ({
  calciumMg: real("calcium_mg"),
  ironMg: real("iron_mg"),
  magnesiumMg: real("magnesium_mg"),
  potassiumMg: real("potassium_mg"),
  zincMg: real("zinc_mg"),
  vitaminCMg: real("vitamin_c_mg"),
  vitaminDUg: real("vitamin_d_ug"),
  vitaminB12Ug: real("vitamin_b12_ug"),
});

export type MicronutrientColumnKey = keyof ReturnType<typeof micronutrientColumns>;
const MICRONUTRIENT_COLUMN_KEYS = Object.keys(micronutrientColumns()) as MicronutrientColumnKey[];

/** Every micronutrient value is either absent (null) or a non-negative number. */
export const micronutrientsNonNegative = (
  table: Record<MicronutrientColumnKey, AnyPgColumn>,
): SQL =>
  sql.join(
    MICRONUTRIENT_COLUMN_KEYS.map((key) => sql`(${table[key]} is null or ${table[key]} >= 0)`),
    sql` and `,
  );
const NUTRIENT_COLUMN_KEYS = Object.keys(nutrientColumns()) as NutrientColumnKey[];

/** Every nutrient value is either absent (null) or a non-negative number. */
export const nutrientsNonNegative = (table: Record<NutrientColumnKey, AnyPgColumn>): SQL =>
  sql.join(
    NUTRIENT_COLUMN_KEYS.map((key) => sql`(${table[key]} is null or ${table[key]} >= 0)`),
    sql` and `,
  );

/** Columns describing the nutrient basis and an optional household serving. */
export const basisColumns = () => ({
  nutrientBasisAmount: real("nutrient_basis_amount").notNull(),
  /** `g` / `ml` (e.g. per 100 g) or `serving` (label values per serving). */
  nutrientBasisUnit: text("nutrient_basis_unit").$type<"g" | "ml" | "serving">().notNull(),
  servingSizeAmount: real("serving_size_amount"),
  /** Mass or volume of one serving; never inferred across g/ml. */
  servingSizeUnit: text("serving_size_unit").$type<"g" | "ml">(),
  servingLabel: text("serving_label"),
});

export type BasisColumns = { [K in keyof ReturnType<typeof basisColumns>]: AnyPgColumn };

export const basisChecks = (name: string, table: BasisColumns) => ({
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
    ...micronutrientColumns(),
    revision: integer("revision").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    /**
     * Client-generated id of the create request (Issue #81), so a retried or
     * replayed "save food" returns the food it already created.
     */
    clientMutationId: text("client_mutation_id"),
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
    nutritionFoodClientMutationUnique: uniqueIndex("nutrition_food_org_user_client_mutation_key")
      .on(table.organizationId, table.userId, table.clientMutationId)
      .where(sql`${table.clientMutationId} is not null`),
    nutritionFoodClientMutationCheck: check(
      "nutrition_food_client_mutation_id_check",
      sql`${table.clientMutationId} is null or length(${table.clientMutationId}) between 1 and 128`,
    ),
    nutritionFoodNutrientsCheck: check(
      "nutrition_food_nutrients_non_negative_check",
      nutrientsNonNegative(table),
    ),
    nutritionFoodMicronutrientsCheck: check(
      "nutrition_food_micronutrients_non_negative_check",
      micronutrientsNonNegative(table),
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
    ...micronutrientColumns(),
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
    nutritionFoodSnapshotMicronutrientsCheck: check(
      "nutrition_food_snapshot_micronutrients_non_negative_check",
      micronutrientsNonNegative(table),
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
    timeZone: text("time_zone"),
    nutrientFactor: doublePrecision("nutrient_factor").notNull(),
    method: text("method")
      .$type<"manual" | "search" | "barcode" | "quick_add" | "copied">()
      .notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    clientMutationId: text("client_mutation_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    /**
     * Bumped on every edit, delete and restore (Issue #77). Offline clients
     * send the revision they last saw so a stale change becomes a conflict
     * the member resolves, never a silent overwrite.
     */
    revision: integer("revision").notNull().default(1),
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
    nutritionMealEntryRevisionCheck: check(
      "nutrition_meal_entry_revision_check",
      sql`${table.revision} >= 1`,
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
    /** #80: `entered` by the member, or accepted from a `proposal` (#76). Never set by the system alone. */
    source: text("source").$type<"entered" | "proposal">().notNull().default("entered"),
    /** #80: member's local date (YYYY-MM-DD) the target applies from; `null` on rows from before #80. */
    effectiveFrom: text("effective_from"),
    /** #80: local date the target stopped applying (exclusive), stamped when replaced or cleared. */
    effectiveTo: text("effective_to"),
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
    nutritionGoalSourceCheck: check(
      "nutrition_goal_source_check",
      sql`${table.source} in ('entered', 'proposal')`,
    ),
    nutritionGoalEffectiveCheck: check(
      "nutrition_goal_effective_check",
      sql`(${table.effectiveFrom} is null or ${table.effectiveFrom} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
        and (${table.effectiveTo} is null or ${table.effectiveTo} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
        and (${table.effectiveFrom} is null or ${table.effectiveTo} is null or ${table.effectiveFrom} <= ${table.effectiveTo})`,
    ),
    nutritionGoalMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "nutrition_goal_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

// ─── Meal diary (Issue #77) ───────────────────────────────────
//
// Additive diary state on top of the #74 core: an explicit "day complete"
// marker, favourite foods and a ledger that makes offline edit/delete/restore
// replays idempotent. An absent day row means "not marked": it is never read
// as zero intake.

/**
 * A member's explicit marker for one local day. `completed_at` set means the
 * member marked the day complete; `null` means they cleared the marker. No
 * row and a cleared row both mean "not marked".
 */
export const nutritionDiaryDay = pgTable(
  "nutrition_diary_day",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    localDate: text("local_date").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    nutritionDiaryDayOrgUserDateUnique: uniqueIndex("nutrition_diary_day_org_user_date_key").on(
      table.organizationId,
      table.userId,
      table.localDate,
    ),
    nutritionDiaryDayUserIdx: index("nutrition_diary_day_user_id_idx").on(table.userId),
    nutritionDiaryDayLocalDateCheck: check(
      "nutrition_diary_day_local_date_check",
      sql`${table.localDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
    ),
    nutritionDiaryDayMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "nutrition_diary_day_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

/** A member's favourite foods, pinned to the snapshot they chose. */
export const nutritionFavoriteFood = pgTable(
  "nutrition_favorite_food",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    snapshotId: integer("snapshot_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    nutritionFavoriteFoodOrgUserSnapshotUnique: uniqueIndex(
      "nutrition_favorite_food_org_user_snapshot_key",
    ).on(table.organizationId, table.userId, table.snapshotId),
    nutritionFavoriteFoodOrgSnapshotIdx: index("nutrition_favorite_food_org_snapshot_idx").on(
      table.organizationId,
      table.snapshotId,
    ),
    nutritionFavoriteFoodUserIdx: index("nutrition_favorite_food_user_id_idx").on(table.userId),
    nutritionFavoriteFoodSnapshotFk: foreignKey({
      columns: [table.organizationId, table.snapshotId],
      foreignColumns: [nutritionFoodSnapshot.organizationId, nutritionFoodSnapshot.id],
      name: "nutrition_favorite_food_org_snapshot_fk",
    }).onDelete("restrict"),
    nutritionFavoriteFoodMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "nutrition_favorite_food_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

/**
 * Applied edit/delete/restore mutations, keyed by the client's mutation id.
 * A replayed id returns the entry's current state instead of applying the
 * change twice or reporting a conflict against the client's own write.
 * (Logged entries carry their id on `nutrition_meal_entry` itself.)
 */
export const nutritionDiaryMutation = pgTable(
  "nutrition_diary_mutation",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientMutationId: text("client_mutation_id").notNull(),
    kind: text("kind").$type<"update" | "delete" | "restore">().notNull(),
    entryId: integer("entry_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    nutritionDiaryMutationClientUnique: uniqueIndex(
      "nutrition_diary_mutation_org_user_client_mutation_key",
    ).on(table.organizationId, table.userId, table.clientMutationId),
    nutritionDiaryMutationOrgEntryIdx: index("nutrition_diary_mutation_org_entry_idx").on(
      table.organizationId,
      table.entryId,
    ),
    nutritionDiaryMutationUserIdx: index("nutrition_diary_mutation_user_id_idx").on(table.userId),
    nutritionDiaryMutationKindCheck: check(
      "nutrition_diary_mutation_kind_check",
      sql`${table.kind} in ('update', 'delete', 'restore')`,
    ),
    nutritionDiaryMutationClientMutationCheck: check(
      "nutrition_diary_mutation_client_mutation_id_check",
      sql`length(${table.clientMutationId}) between 1 and 128`,
    ),
    nutritionDiaryMutationEntryFk: foreignKey({
      columns: [table.organizationId, table.entryId],
      foreignColumns: [nutritionMealEntry.organizationId, nutritionMealEntry.id],
      name: "nutrition_diary_mutation_org_entry_fk",
    }).onDelete("restrict"),
    nutritionDiaryMutationMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "nutrition_diary_mutation_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

export const nutritionTemplate = pgTable(
  "nutrition_template",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"meal" | "recipe">().notNull(),
    currentRevision: integer("current_revision").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdUnique: uniqueIndex("nutrition_template_org_id_key").on(table.organizationId, table.id),
    ownerFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "nutrition_template_org_user_member_fk",
    }).onDelete("restrict"),
    ownerIdx: index("nutrition_template_org_user_idx").on(table.organizationId, table.userId),
    kindCheck: check("nutrition_template_kind_check", sql`${table.kind} in ('meal', 'recipe')`),
    revisionCheck: check("nutrition_template_revision_check", sql`${table.currentRevision} > 0`),
  }),
);

export const nutritionTemplateRevision = pgTable(
  "nutrition_template_revision",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    templateId: integer("template_id").notNull(),
    revision: integer("revision").notNull(),
    kind: text("kind").$type<"meal" | "recipe">().notNull(),
    name: text("name").notNull(),
    yieldServings: real("yield_servings"),
    ingredients: jsonb("ingredients")
      .$type<{ snapshotId: number; amount: number; unit: "g" | "ml" | "serving" }[]>()
      .notNull(),
    clientMutationId: text("client_mutation_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    revisionUnique: uniqueIndex("nutrition_template_revision_key").on(
      table.organizationId,
      table.templateId,
      table.revision,
    ),
    mutationUnique: uniqueIndex("nutrition_template_revision_mutation_key").on(
      table.organizationId,
      table.userId,
      table.clientMutationId,
    ),
    ownerFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "nutrition_template_revision_org_user_member_fk",
    }).onDelete("restrict"),
    templateFk: foreignKey({
      columns: [table.organizationId, table.templateId],
      foreignColumns: [nutritionTemplate.organizationId, nutritionTemplate.id],
      name: "nutrition_template_revision_template_fk",
    }).onDelete("restrict"),
    revisionCheck: check("nutrition_template_revision_positive_check", sql`${table.revision} > 0`),
  }),
);

export const nutritionDiaryBatch = pgTable(
  "nutrition_diary_batch",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientMutationId: text("client_mutation_id").notNull(),
    operation: text("operation").notNull(),
    fingerprint: text("fingerprint").notNull(),
    entryIds: jsonb("entry_ids").$type<number[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    mutationUnique: uniqueIndex("nutrition_diary_batch_mutation_key").on(
      table.organizationId,
      table.userId,
      table.clientMutationId,
    ),
    ownerFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "nutrition_diary_batch_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

// ─── Energy estimate proposals (Issue #76) ────────────────────
//
// The experimental energy estimate itself is never stored: it is recomputed
// from daily totals (#79) and the weight trend (#87) on every read. Only a
// suggested change to the member's energy target is kept, so it can be shown,
// accepted or dismissed. A proposal never changes a goal by itself: only an
// explicit accept writes `nutrition_goal`, and records which goal it wrote.

export const ENERGY_PROPOSAL_STATUSES = ["pending", "accepted", "dismissed", "superseded"] as const;
export type EnergyProposalStatus = (typeof ENERGY_PROPOSAL_STATUSES)[number];

/** A suggested energy target the member can accept or dismiss. */
export const nutritionEnergyProposal = pgTable(
  "nutrition_energy_proposal",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** `maintenance`; `deficit` / `gain` only through the #80 safety policy (`nutrition-safety/v1`). */
    kind: text("kind").$type<"maintenance" | "deficit" | "gain">().notNull(),
    status: text("status").$type<EnergyProposalStatus>().notNull().default("pending"),
    /** The estimate the proposal came from (kcal/day, logging units). */
    estimateKcal: integer("estimate_kcal").notNull(),
    /** The suggested energy target (kcal/day). */
    targetKcal: integer("target_kcal").notNull(),
    /** The member's active energy target when proposed; `null` when none was set. */
    currentTargetKcal: integer("current_target_kcal"),
    /** True when the weekly step limit moved the target less than the estimate. */
    stepLimited: boolean("step_limited").notNull().default(false),
    methodVersion: integer("method_version").notNull(),
    policyVersion: text("policy_version").notNull(),
    windowFrom: text("window_from").notNull(),
    windowTo: text("window_to").notNull(),
    /** The full transparent estimate (inputs, window, method, uncertainty) at proposal time. */
    estimate: jsonb("estimate").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    /** The goal an accept wrote. */
    acceptedGoalId: integer("accepted_goal_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    nutritionEnergyProposalPendingUnique: uniqueIndex(
      "nutrition_energy_proposal_org_user_pending_key",
    )
      .on(table.organizationId, table.userId)
      .where(sql`${table.status} = 'pending'`),
    nutritionEnergyProposalOrgUserCreatedIdx: index(
      "nutrition_energy_proposal_org_user_created_idx",
    ).on(table.organizationId, table.userId, table.createdAt),
    nutritionEnergyProposalUserIdx: index("nutrition_energy_proposal_user_id_idx").on(table.userId),
    nutritionEnergyProposalKindCheck: check(
      "nutrition_energy_proposal_kind_check",
      sql`${table.kind} in ('maintenance', 'deficit', 'gain')`,
    ),
    nutritionEnergyProposalStatusCheck: check(
      "nutrition_energy_proposal_status_check",
      sql`${table.status} in ('pending', 'accepted', 'dismissed', 'superseded')`,
    ),
    nutritionEnergyProposalKcalCheck: check(
      "nutrition_energy_proposal_kcal_check",
      sql`${table.estimateKcal} > 0 and ${table.targetKcal} > 0
        and (${table.currentTargetKcal} is null or ${table.currentTargetKcal} >= 0)`,
    ),
    nutritionEnergyProposalWindowCheck: check(
      "nutrition_energy_proposal_window_check",
      sql`${table.windowFrom} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and ${table.windowTo} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and ${table.windowFrom} <= ${table.windowTo}`,
    ),
    nutritionEnergyProposalDecisionCheck: check(
      "nutrition_energy_proposal_decision_check",
      sql`(${table.status} = 'pending') = (${table.decidedAt} is null)`,
    ),
    nutritionEnergyProposalAcceptedGoalFk: foreignKey({
      columns: [table.acceptedGoalId],
      foreignColumns: [nutritionGoal.id],
      name: "nutrition_energy_proposal_accepted_goal_fk",
    }).onDelete("set null"),
    nutritionEnergyProposalMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "nutrition_energy_proposal_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

// ─── Coach nutrition context consent (Issue #86) ──────────────
//
// Per-member, explicit and revocable consent to include a sanitized nutrition
// summary in the AI Coach conversation (on top of the org + per-user AI
// consent from #13/#123). It is deliberately separate from the
// administrator-configured provider credentials (#57/#59) and records the
// disclosure version the member agreed to, so a new version fails closed until
// the member re-consents. `include_numbers` is the member's own choice to
// share numeric averages; when false only coverage/completeness is shared.
// One row per (organization, member); revoking sets `granted = false`.

export const nutritionCoachConsent = pgTable(
  "nutrition_coach_consent",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    granted: boolean("granted").notNull().default(false),
    /** Whether numeric averages may be shared (hide-numbers when false). */
    includeNumbers: boolean("include_numbers").notNull().default(false),
    grantedAt: timestamp("granted_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    consentVersion: text("consent_version").notNull().default("v1"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    nutritionCoachConsentOrgUserUnique: uniqueIndex("nutrition_coach_consent_org_user_key").on(
      table.organizationId,
      table.userId,
    ),
    nutritionCoachConsentUserIdx: index("nutrition_coach_consent_user_id_idx").on(table.userId),
    nutritionCoachConsentRevokedCheck: check(
      "nutrition_coach_consent_revoked_after_granted_check",
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.grantedAt}`,
    ),
    nutritionCoachConsentMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "nutrition_coach_consent_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

// ─── Nutrition target settings (Issue #80) ────────────────────
//
// One row per (workspace, member): hide-numbers mode, the direction energy
// suggestions may take (maintain by default), the active opt-in for the
// protein reference, a self-declared height for the BMI gate, and the
// member's self-declared yes/no answers that switch off reductions. Nothing
// here is inferred. A missing row means the defaults: numbers shown,
// maintain, no opt-in, no height, nothing declared.

export const NUTRITION_DECLARATION_KEYS = [
  "pregnant_or_breastfeeding",
  "eating_disorder",
  "glucose_lowering_medication",
  "chronic_kidney_disease",
  "cancer_treatment",
  "bariatric_surgery",
  "refeeding_syndrome",
  "glp1_medication",
] as const;

export const nutritionTargetSettings = pgTable(
  "nutrition_target_settings",
  {
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Optimistic-concurrency counter; increases on every change. */
    revision: integer("revision").notNull().default(0),
    hideNumbers: boolean("hide_numbers").notNull().default(false),
    energyDirection: text("energy_direction")
      .$type<"maintain" | "lose" | "gain">()
      .notNull()
      .default("maintain"),
    activeProtein: boolean("active_protein").notNull().default(false),
    /** Opt-in to the logging streak (Issue #90); hidden regardless under the #80 safeguards. */
    streaksEnabled: boolean("streaks_enabled").notNull().default(false),
    /** Opt-in to importing recipe drafts from a URL (Issue #82). */
    recipeImportEnabled: boolean("recipe_import_enabled").notNull().default(false),
    /** Opt-in to food drafts from a spoken description (Issue #73). */
    voiceDraftsEnabled: boolean("voice_drafts_enabled").notNull().default(false),
    /** Opt-in to food drafts from a meal photo (Issue #71). */
    photoDraftsEnabled: boolean("photo_drafts_enabled").notNull().default(false),
    /** Opt-in to the micronutrient summary (Issue #78). */
    micronutrientsEnabled: boolean("micronutrients_enabled").notNull().default(false),
    /** Accepted reference source (`efsa` | `nasem`); never set without the member choosing it. */
    micronutrientReferenceSource: text("micronutrient_reference_source"),
    /** Accepted population group id within that source. */
    micronutrientPopulation: text("micronutrient_population"),
    /** Self-declared height (cm), used only for the BMI gate and resting estimate. */
    heightCm: real("height_cm"),
    /** Self-declared yes answers (see NUTRITION_DECLARATION_KEYS). */
    declarations: text("declarations")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    nutritionTargetSettingsPk: primaryKey({
      name: "nutrition_target_settings_pkey",
      columns: [table.organizationId, table.userId],
    }),
    nutritionTargetSettingsUserIdx: index("nutrition_target_settings_user_id_idx").on(table.userId),
    nutritionTargetSettingsRevisionCheck: check(
      "nutrition_target_settings_revision_check",
      sql`${table.revision} >= 0`,
    ),
    nutritionTargetSettingsDirectionCheck: check(
      "nutrition_target_settings_direction_check",
      sql`${table.energyDirection} in ('maintain', 'lose', 'gain')`,
    ),
    nutritionTargetSettingsHeightCheck: check(
      "nutrition_target_settings_height_check",
      sql`${table.heightCm} is null or (${table.heightCm} >= 100 and ${table.heightCm} <= 250)`,
    ),
    nutritionTargetSettingsDeclarationsCheck: check(
      "nutrition_target_settings_declarations_check",
      sql`${table.declarations} <@ array['pregnant_or_breastfeeding', 'eating_disorder', 'glucose_lowering_medication', 'chronic_kidney_disease', 'cancer_treatment', 'bariatric_surgery', 'refeeding_syndrome', 'glp1_medication']::text[]`,
    ),
    nutritionTargetSettingsMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "nutrition_target_settings_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

// ─── Plain-water diary (Issue #83) ──────────────────────────────
// Water is intentionally separate from food/beverage nutrients: this is a
// personal log of plain water only, not a measure of total dietary water.
export const plainWaterEntry = pgTable(
  "plain_water_entry",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    quantityMl: real("quantity_ml").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" }).notNull(),
    timeZone: text("time_zone").notNull(),
    clientMutationId: text("client_mutation_id").notNull(),
    revision: integer("revision").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    waterEntryOrgIdUnique: uniqueIndex("plain_water_entry_org_id_key").on(
      table.organizationId,
      table.id,
    ),
    waterEntryMutationUnique: uniqueIndex("plain_water_entry_org_user_mutation_key").on(
      table.organizationId,
      table.userId,
      table.clientMutationId,
    ),
    waterEntryDayIdx: index("plain_water_entry_org_user_observed_idx").on(
      table.organizationId,
      table.userId,
      table.observedAt,
    ),
    waterEntryQuantityCheck: check(
      "plain_water_entry_quantity_check",
      sql`${table.quantityMl} > 0 and ${table.quantityMl} < 'Infinity'::float8`,
    ),
    waterEntryMutationCheck: check(
      "plain_water_entry_mutation_check",
      sql`length(${table.clientMutationId}) between 1 and 64`,
    ),
    waterEntryRevisionCheck: check("plain_water_entry_revision_check", sql`${table.revision} >= 1`),
    waterEntryMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "plain_water_entry_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

export const plainWaterPreference = pgTable(
  "plain_water_preference",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    personalGoalMl: real("personal_goal_ml"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    waterPreferenceOwnerUnique: uniqueIndex("plain_water_preference_org_user_key").on(
      table.organizationId,
      table.userId,
    ),
    waterPreferenceGoalCheck: check(
      "plain_water_preference_goal_check",
      sql`${table.personalGoalMl} is null or (${table.personalGoalMl} > 0 and ${table.personalGoalMl} < 'Infinity'::float8)`,
    ),
    waterPreferenceMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "plain_water_preference_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

/** Immutable idempotency receipt for a member's plain-water queued mutation. */
export const plainWaterMutation = pgTable(
  "plain_water_mutation",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientMutationId: text("client_mutation_id").notNull(),
    kind: text("kind").$type<"add" | "edit" | "delete">().notNull(),
    fingerprint: text("fingerprint").notNull(),
    entryId: integer("entry_id").notNull(),
    outcome: jsonb("outcome").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    waterMutationKey: uniqueIndex("plain_water_mutation_org_user_client_key").on(
      table.organizationId,
      table.userId,
      table.clientMutationId,
    ),
    waterMutationEntryIdx: index("plain_water_mutation_org_entry_idx").on(
      table.organizationId,
      table.entryId,
    ),
    waterMutationKindCheck: check(
      "plain_water_mutation_kind_check",
      sql`${table.kind} in ('add', 'edit', 'delete')`,
    ),
    waterMutationFingerprintCheck: check(
      "plain_water_mutation_fingerprint_check",
      sql`length(${table.fingerprint}) = 64`,
    ),
    waterMutationClientIdCheck: check(
      "plain_water_mutation_client_id_check",
      sql`length(${table.clientMutationId}) between 1 and 64`,
    ),
    waterMutationEntryFk: foreignKey({
      columns: [table.organizationId, table.entryId],
      foreignColumns: [plainWaterEntry.organizationId, plainWaterEntry.id],
      name: "plain_water_mutation_org_entry_fk",
    }).onDelete("restrict"),
    waterMutationMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "plain_water_mutation_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);
