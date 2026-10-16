-- Issue #81 — private custom food management.
--
-- Adds an optional client mutation id to `nutrition_food` so a retried or
-- offline-replayed "save food" returns the food it already created instead of
-- adding a duplicate. Existing rows keep `null`. Additive only: no rows are
-- rewritten or removed.

ALTER TABLE "nutrition_food" ADD COLUMN "client_mutation_id" text;--> statement-breakpoint
ALTER TABLE "nutrition_food" ADD CONSTRAINT "nutrition_food_client_mutation_id_check" CHECK ("client_mutation_id" is null or length("client_mutation_id") between 1 and 128);--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_food_org_user_client_mutation_key" ON "nutrition_food" ("organization_id","user_id","client_mutation_id") WHERE "client_mutation_id" is not null;
