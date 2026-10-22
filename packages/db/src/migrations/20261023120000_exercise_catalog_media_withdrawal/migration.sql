ALTER TABLE "exercise_media" ADD COLUMN "publication_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "exercise_media" ADD COLUMN "publication_revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "exercise_media" ADD CONSTRAINT "exercise_media_publication_revision_check" CHECK ("exercise_media"."publication_revision" >= 0);
