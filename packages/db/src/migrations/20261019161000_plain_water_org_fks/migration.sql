-- Reconcile the original plain-water DDL with schema.orgId(): each table has
-- an organization FK with CASCADE, in addition to the member-integrity FK.
ALTER TABLE "plain_water_entry"
  ADD CONSTRAINT "plain_water_entry_organization_id_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "plain_water_preference"
  ADD CONSTRAINT "plain_water_preference_organization_id_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "plain_water_mutation"
  ADD CONSTRAINT "plain_water_mutation_organization_id_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
