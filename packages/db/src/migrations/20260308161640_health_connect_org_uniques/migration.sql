DROP INDEX "health_connect_record_type_external_id_key";
--> statement-breakpoint
DROP INDEX "health_connect_record_type_hash_key";
--> statement-breakpoint
CREATE UNIQUE INDEX "health_connect_record_organization_id_type_external_id_key"
ON "health_connect_record" USING btree ("organization_id", "record_type", "external_record_id")
WHERE "health_connect_record"."external_record_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "health_connect_record_organization_id_type_hash_key"
ON "health_connect_record" USING btree ("organization_id", "record_type", "hash");
