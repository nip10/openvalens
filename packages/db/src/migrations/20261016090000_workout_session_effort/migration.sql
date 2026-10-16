-- Issue #99 — activity load: WHO active minutes and session effort.
--
-- Adds the self-reported session intensity (`light` / `moderate` / `vigorous`,
-- talk test), the session effort rating (0–10, CR-10 session-RPE) and when that
-- rating was last recorded to `workout`. The rating can be given on save or
-- added later the same day. Null means "not recorded": active minutes and
-- effort points report such sessions as missing, never as zero.
-- Generated with drizzle-kit and reduced to this change's statements. Additive
-- only: nullable columns, no data movement; existing rows satisfy both checks.

ALTER TABLE "workout" ADD COLUMN "intensity" text;--> statement-breakpoint
ALTER TABLE "workout" ADD COLUMN "effort_rating" integer;--> statement-breakpoint
ALTER TABLE "workout" ADD COLUMN "effort_rated_at" text;--> statement-breakpoint
CREATE INDEX "workout_organization_id_date_idx" ON "workout" ("organization_id","date");--> statement-breakpoint
ALTER TABLE "workout" ADD CONSTRAINT "workout_intensity_check" CHECK ("intensity" is null or "intensity" in ('light', 'moderate', 'vigorous'));--> statement-breakpoint
ALTER TABLE "workout" ADD CONSTRAINT "workout_effort_rating_check" CHECK ("effort_rating" is null or ("effort_rating" >= 0 and "effort_rating" <= 10));
