-- Issue #74 — additive nutrition core schema.
--
-- Creates five new, empty, organization-scoped tables (custom foods, immutable
-- food snapshots, local-day meals, meal entries and optional goals). Additive
-- only: no existing table, column, constraint or row is altered or removed, so
-- no preflight, quarantine or NOT VALID phase is needed. Body weights stay in
-- `daily_weight`; public food catalogs (#72) are not tenant records and are
-- not created here.

CREATE TABLE "nutrition_food" (
	"id" serial PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"barcode" text,
	"nutrient_basis_amount" real NOT NULL,
	"nutrient_basis_unit" text NOT NULL,
	"serving_size_amount" real,
	"serving_size_unit" text,
	"serving_label" text,
	"energy_kcal" real,
	"energy_kj" real,
	"protein_g" real,
	"carbohydrate_g" real,
	"fat_g" real,
	"saturated_fat_g" real,
	"fiber_g" real,
	"total_sugars_g" real,
	"added_sugars_g" real,
	"free_sugars_g" real,
	"sodium_mg" real,
	"salt_g" real,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_food_nutrient_basis_amount_check" CHECK ("nutrient_basis_amount" > 0),
	CONSTRAINT "nutrition_food_nutrient_basis_unit_check" CHECK ("nutrient_basis_unit" in ('g', 'ml', 'serving')),
	CONSTRAINT "nutrition_food_serving_size_check" CHECK (("serving_size_amount" is null and "serving_size_unit" is null) or ("serving_size_amount" > 0 and "serving_size_unit" in ('g', 'ml'))),
	CONSTRAINT "nutrition_food_name_check" CHECK (length("name") > 0),
	CONSTRAINT "nutrition_food_barcode_check" CHECK ("barcode" is null or "barcode" ~ '^[0-9]{8,14}$'),
	CONSTRAINT "nutrition_food_revision_check" CHECK ("revision" >= 1),
	CONSTRAINT "nutrition_food_nutrients_non_negative_check" CHECK (("energy_kcal" is null or "energy_kcal" >= 0) and ("energy_kj" is null or "energy_kj" >= 0) and ("protein_g" is null or "protein_g" >= 0) and ("carbohydrate_g" is null or "carbohydrate_g" >= 0) and ("fat_g" is null or "fat_g" >= 0) and ("saturated_fat_g" is null or "saturated_fat_g" >= 0) and ("fiber_g" is null or "fiber_g" >= 0) and ("total_sugars_g" is null or "total_sugars_g" >= 0) and ("added_sugars_g" is null or "added_sugars_g" >= 0) and ("free_sugars_g" is null or "free_sugars_g" >= 0) and ("sodium_mg" is null or "sodium_mg" >= 0) and ("salt_g" is null or "salt_g" >= 0))
);
--> statement-breakpoint
CREATE TABLE "nutrition_food_snapshot" (
	"id" serial PRIMARY KEY,
	"organization_id" text NOT NULL,
	"source" text NOT NULL,
	"source_food_id" text,
	"source_version" text,
	"custom_food_id" integer,
	"attribution" text,
	"name" text NOT NULL,
	"brand" text,
	"barcode" text,
	"nutrient_basis_amount" real NOT NULL,
	"nutrient_basis_unit" text NOT NULL,
	"serving_size_amount" real,
	"serving_size_unit" text,
	"serving_label" text,
	"energy_kcal" real,
	"energy_kj" real,
	"protein_g" real,
	"carbohydrate_g" real,
	"fat_g" real,
	"saturated_fat_g" real,
	"fiber_g" real,
	"total_sugars_g" real,
	"added_sugars_g" real,
	"free_sugars_g" real,
	"sodium_mg" real,
	"salt_g" real,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_food_snapshot_nutrient_basis_amount_check" CHECK ("nutrient_basis_amount" > 0),
	CONSTRAINT "nutrition_food_snapshot_nutrient_basis_unit_check" CHECK ("nutrient_basis_unit" in ('g', 'ml', 'serving')),
	CONSTRAINT "nutrition_food_snapshot_serving_size_check" CHECK (("serving_size_amount" is null and "serving_size_unit" is null) or ("serving_size_amount" > 0 and "serving_size_unit" in ('g', 'ml'))),
	CONSTRAINT "nutrition_food_snapshot_source_check" CHECK (("source" = 'custom' and "custom_food_id" is not null and "source_food_id" is not null and "source_version" is not null)
        or ("source" in ('fdc', 'off') and "custom_food_id" is null and "source_food_id" is not null)
        or ("source" = 'manual' and "custom_food_id" is null and "source_food_id" is null)),
	CONSTRAINT "nutrition_food_snapshot_name_check" CHECK (length("name") > 0),
	CONSTRAINT "nutrition_food_snapshot_nutrients_non_negative_check" CHECK (("energy_kcal" is null or "energy_kcal" >= 0) and ("energy_kj" is null or "energy_kj" >= 0) and ("protein_g" is null or "protein_g" >= 0) and ("carbohydrate_g" is null or "carbohydrate_g" >= 0) and ("fat_g" is null or "fat_g" >= 0) and ("saturated_fat_g" is null or "saturated_fat_g" >= 0) and ("fiber_g" is null or "fiber_g" >= 0) and ("total_sugars_g" is null or "total_sugars_g" >= 0) and ("added_sugars_g" is null or "added_sugars_g" >= 0) and ("free_sugars_g" is null or "free_sugars_g" >= 0) and ("sodium_mg" is null or "sodium_mg" >= 0) and ("salt_g" is null or "salt_g" >= 0))
);
--> statement-breakpoint
CREATE TABLE "nutrition_goal" (
	"id" serial PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"nutrient" text NOT NULL,
	"min_amount" real,
	"max_amount" real,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_goal_nutrient_check" CHECK ("nutrient" in ('energy_kcal', 'energy_kj', 'protein_g', 'carbohydrate_g', 'fat_g', 'saturated_fat_g', 'fiber_g', 'total_sugars_g', 'added_sugars_g', 'free_sugars_g', 'sodium_mg', 'salt_g')),
	CONSTRAINT "nutrition_goal_range_check" CHECK (("min_amount" is not null or "max_amount" is not null)
        and ("min_amount" is null or "min_amount" >= 0)
        and ("max_amount" is null or "max_amount" >= 0)
        and ("min_amount" is null or "max_amount" is null or "min_amount" <= "max_amount"))
);
--> statement-breakpoint
CREATE TABLE "nutrition_meal" (
	"id" serial PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"local_date" text NOT NULL,
	"time_zone" text NOT NULL,
	"slot" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_meal_local_date_check" CHECK ("local_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "nutrition_meal_time_zone_check" CHECK (length("time_zone") > 0),
	CONSTRAINT "nutrition_meal_slot_check" CHECK ("slot" in ('breakfast', 'lunch', 'dinner', 'snack', 'other'))
);
--> statement-breakpoint
CREATE TABLE "nutrition_meal_entry" (
	"id" serial PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"meal_id" integer NOT NULL,
	"snapshot_id" integer NOT NULL,
	"amount" real NOT NULL,
	"unit" text NOT NULL,
	"nutrient_factor" double precision NOT NULL,
	"method" text NOT NULL,
	"consumed_at" timestamp with time zone,
	"client_mutation_id" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_meal_entry_amount_check" CHECK ("amount" > 0),
	CONSTRAINT "nutrition_meal_entry_unit_check" CHECK ("unit" in ('g', 'ml', 'serving')),
	CONSTRAINT "nutrition_meal_entry_nutrient_factor_check" CHECK ("nutrient_factor" >= 0),
	CONSTRAINT "nutrition_meal_entry_method_check" CHECK ("method" in ('manual', 'search', 'barcode', 'quick_add', 'copied')),
	CONSTRAINT "nutrition_meal_entry_client_mutation_id_check" CHECK ("client_mutation_id" is null or length("client_mutation_id") between 1 and 128)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_food_org_id_key" ON "nutrition_food" ("organization_id","id");
--> statement-breakpoint
CREATE INDEX "nutrition_food_organization_id_user_id_idx" ON "nutrition_food" ("organization_id","user_id");
--> statement-breakpoint
CREATE INDEX "nutrition_food_organization_id_barcode_idx" ON "nutrition_food" ("organization_id","barcode") WHERE "barcode" is not null;
--> statement-breakpoint
CREATE INDEX "nutrition_food_user_id_idx" ON "nutrition_food" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_food_snapshot_org_id_key" ON "nutrition_food_snapshot" ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_food_snapshot_org_content_hash_key" ON "nutrition_food_snapshot" ("organization_id","content_hash");
--> statement-breakpoint
CREATE INDEX "nutrition_food_snapshot_org_source_idx" ON "nutrition_food_snapshot" ("organization_id","source","source_food_id");
--> statement-breakpoint
CREATE INDEX "nutrition_food_snapshot_org_custom_food_idx" ON "nutrition_food_snapshot" ("organization_id","custom_food_id") WHERE "custom_food_id" is not null;
--> statement-breakpoint
CREATE INDEX "nutrition_goal_organization_id_user_id_idx" ON "nutrition_goal" ("organization_id","user_id");
--> statement-breakpoint
CREATE INDEX "nutrition_goal_user_id_idx" ON "nutrition_goal" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_goal_org_user_nutrient_active_key" ON "nutrition_goal" ("organization_id","user_id","nutrient") WHERE "archived_at" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_meal_org_id_key" ON "nutrition_meal" ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_meal_org_user_id_key" ON "nutrition_meal" ("organization_id","user_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_meal_org_user_date_slot_key" ON "nutrition_meal" ("organization_id","user_id","local_date","slot");
--> statement-breakpoint
CREATE INDEX "nutrition_meal_user_id_idx" ON "nutrition_meal" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_meal_entry_org_id_key" ON "nutrition_meal_entry" ("organization_id","id");
--> statement-breakpoint
CREATE INDEX "nutrition_meal_entry_organization_id_meal_id_idx" ON "nutrition_meal_entry" ("organization_id","meal_id");
--> statement-breakpoint
CREATE INDEX "nutrition_meal_entry_organization_id_snapshot_id_idx" ON "nutrition_meal_entry" ("organization_id","snapshot_id");
--> statement-breakpoint
CREATE INDEX "nutrition_meal_entry_user_id_idx" ON "nutrition_meal_entry" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_meal_entry_org_user_client_mutation_key" ON "nutrition_meal_entry" ("organization_id","user_id","client_mutation_id") WHERE "client_mutation_id" is not null;
--> statement-breakpoint
ALTER TABLE "nutrition_food" ADD CONSTRAINT "nutrition_food_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "nutrition_food" ADD CONSTRAINT "nutrition_food_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "nutrition_food" ADD CONSTRAINT "nutrition_food_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "nutrition_food_snapshot" ADD CONSTRAINT "nutrition_food_snapshot_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "nutrition_food_snapshot" ADD CONSTRAINT "nutrition_food_snapshot_org_custom_food_fk" FOREIGN KEY ("organization_id","custom_food_id") REFERENCES "nutrition_food"("organization_id","id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "nutrition_goal" ADD CONSTRAINT "nutrition_goal_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "nutrition_goal" ADD CONSTRAINT "nutrition_goal_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "nutrition_goal" ADD CONSTRAINT "nutrition_goal_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "nutrition_meal" ADD CONSTRAINT "nutrition_meal_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "nutrition_meal" ADD CONSTRAINT "nutrition_meal_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "nutrition_meal" ADD CONSTRAINT "nutrition_meal_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "nutrition_meal_entry" ADD CONSTRAINT "nutrition_meal_entry_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "nutrition_meal_entry" ADD CONSTRAINT "nutrition_meal_entry_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "nutrition_meal_entry" ADD CONSTRAINT "nutrition_meal_entry_org_user_meal_fk" FOREIGN KEY ("organization_id","user_id","meal_id") REFERENCES "nutrition_meal"("organization_id","user_id","id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "nutrition_meal_entry" ADD CONSTRAINT "nutrition_meal_entry_org_snapshot_fk" FOREIGN KEY ("organization_id","snapshot_id") REFERENCES "nutrition_food_snapshot"("organization_id","id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "nutrition_meal_entry" ADD CONSTRAINT "nutrition_meal_entry_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE RESTRICT;
--> statement-breakpoint
-- Historical meal snapshots are insert-only: later food or catalog edits must
-- create a new snapshot, never rewrite the nutrients an entry was logged with.
-- DELETE stays possible so account erasure (#89) can remove the subject's rows.
CREATE FUNCTION "nutrition_food_snapshot_reject_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'nutrition_food_snapshot rows are immutable'
		USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "nutrition_food_snapshot_immutable"
BEFORE UPDATE ON "nutrition_food_snapshot"
FOR EACH ROW EXECUTE FUNCTION "nutrition_food_snapshot_reject_update"();
