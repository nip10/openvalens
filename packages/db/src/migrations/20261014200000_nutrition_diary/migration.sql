-- Issue #77 — additive meal diary state.
--
-- Adds an entry `revision` (so a stale offline edit becomes an explicit
-- conflict instead of a silent overwrite) and three new, empty,
-- organization-scoped tables: the explicit "day complete" marker, favourite
-- foods and the idempotency ledger for offline edit/delete/restore replays.
-- Additive only: the new column has a constant default (existing entries start
-- at revision 1), and no existing row, constraint or index is altered or
-- removed, so no preflight, quarantine or NOT VALID phase is needed.

ALTER TABLE "nutrition_meal_entry" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "nutrition_meal_entry" ADD CONSTRAINT "nutrition_meal_entry_revision_check" CHECK ("revision" >= 1);
--> statement-breakpoint
CREATE TABLE "nutrition_diary_day" (
	"id" serial PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"local_date" text NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_diary_day_local_date_check" CHECK ("local_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "nutrition_favorite_food" (
	"id" serial PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"snapshot_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nutrition_diary_mutation" (
	"id" serial PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"client_mutation_id" text NOT NULL,
	"kind" text NOT NULL,
	"entry_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_diary_mutation_kind_check" CHECK ("kind" in ('update', 'delete', 'restore')),
	CONSTRAINT "nutrition_diary_mutation_client_mutation_id_check" CHECK (length("client_mutation_id") between 1 and 128)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_diary_day_org_user_date_key" ON "nutrition_diary_day" ("organization_id","user_id","local_date");
--> statement-breakpoint
CREATE INDEX "nutrition_diary_day_user_id_idx" ON "nutrition_diary_day" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_diary_mutation_org_user_client_mutation_key" ON "nutrition_diary_mutation" ("organization_id","user_id","client_mutation_id");
--> statement-breakpoint
CREATE INDEX "nutrition_diary_mutation_org_entry_idx" ON "nutrition_diary_mutation" ("organization_id","entry_id");
--> statement-breakpoint
CREATE INDEX "nutrition_diary_mutation_user_id_idx" ON "nutrition_diary_mutation" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_favorite_food_org_user_snapshot_key" ON "nutrition_favorite_food" ("organization_id","user_id","snapshot_id");
--> statement-breakpoint
CREATE INDEX "nutrition_favorite_food_org_snapshot_idx" ON "nutrition_favorite_food" ("organization_id","snapshot_id");
--> statement-breakpoint
CREATE INDEX "nutrition_favorite_food_user_id_idx" ON "nutrition_favorite_food" ("user_id");
--> statement-breakpoint
ALTER TABLE "nutrition_diary_day" ADD CONSTRAINT "nutrition_diary_day_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "nutrition_diary_day" ADD CONSTRAINT "nutrition_diary_day_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "nutrition_diary_day" ADD CONSTRAINT "nutrition_diary_day_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "nutrition_diary_mutation" ADD CONSTRAINT "nutrition_diary_mutation_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "nutrition_diary_mutation" ADD CONSTRAINT "nutrition_diary_mutation_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "nutrition_diary_mutation" ADD CONSTRAINT "nutrition_diary_mutation_org_entry_fk" FOREIGN KEY ("organization_id","entry_id") REFERENCES "nutrition_meal_entry"("organization_id","id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "nutrition_diary_mutation" ADD CONSTRAINT "nutrition_diary_mutation_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "nutrition_favorite_food" ADD CONSTRAINT "nutrition_favorite_food_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "nutrition_favorite_food" ADD CONSTRAINT "nutrition_favorite_food_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "nutrition_favorite_food" ADD CONSTRAINT "nutrition_favorite_food_org_snapshot_fk" FOREIGN KEY ("organization_id","snapshot_id") REFERENCES "nutrition_food_snapshot"("organization_id","id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "nutrition_favorite_food" ADD CONSTRAINT "nutrition_favorite_food_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE RESTRICT;
