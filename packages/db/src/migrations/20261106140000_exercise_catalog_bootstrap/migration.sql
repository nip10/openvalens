ALTER TABLE "exercise_media" ADD COLUMN "source" text DEFAULT 'wger' NOT NULL;
--> statement-breakpoint
ALTER TABLE "exercise_media" ADD CONSTRAINT "exercise_media_source_check" CHECK ("exercise_media"."source" in ('wger', 'workout-guide'));
--> statement-breakpoint
CREATE TABLE "exercise_catalog_bootstrap" (
	"id" integer PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"catalog_imported_at" timestamp with time zone,
	"media_published_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_catalog_bootstrap_singleton_check" CHECK ("exercise_catalog_bootstrap"."id" = 1 and "exercise_catalog_bootstrap"."mode" in ('upstream', 'sample') and "exercise_catalog_bootstrap"."attempts" >= 0)
);
