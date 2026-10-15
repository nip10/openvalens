-- Issue #98 — optional adult wellness onboarding and profile foundations.
--
-- `wellness_profile` is one user-owned row (keyed by `user_id`, never by
-- organization) holding optional, self-reported answers. Each answer is a
-- `<field>_state` + value pair so unknown (null), declined, not applicable and
-- recorded stay distinct; check constraints forbid any other combination.
-- `wellness_profile_consent` is the append-only, versioned per-purpose consent
-- history (`age_band`, `sex`) and holds no profile values.
-- Generated with drizzle-kit and reduced to this change's statements. Additive
-- only: new tables, no data movement.

CREATE TABLE "wellness_profile" (
	"user_id" text PRIMARY KEY,
	"revision" integer DEFAULT 0 NOT NULL,
	"setup_status" text,
	"eligibility_state" text,
	"eligibility" text,
	"focus_state" text,
	"focus_areas" text[],
	"input_method_state" text,
	"input_method" text,
	"region_state" text,
	"region" text,
	"birth_year_state" text,
	"birth_year" integer,
	"sex_state" text,
	"sex" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wellness_profile_revision_check" CHECK ("revision" >= 0),
	CONSTRAINT "wellness_profile_setup_status_check" CHECK ("setup_status" is null or "setup_status" in ('in_progress', 'skipped', 'completed')),
	CONSTRAINT "wellness_profile_eligibility_check" CHECK (("eligibility_state" is null and "eligibility" is null)
        or ("eligibility_state" = 'declined' and "eligibility" is null)
        or ("eligibility_state" = 'recorded' and "eligibility" is not null and "eligibility" in ('adult', 'under_18'))),
	CONSTRAINT "wellness_profile_focus_check" CHECK (("focus_state" is null and "focus_areas" is null)
        or ("focus_state" = 'just_exploring' and "focus_areas" is null)
        or ("focus_state" = 'recorded' and "focus_areas" is not null and cardinality("focus_areas") between 1 and 5
          and "focus_areas" <@ array['sleep_recovery', 'activity_fitness', 'nutrition', 'body_goals', 'wellbeing']::text[])),
	CONSTRAINT "wellness_profile_input_method_check" CHECK (("input_method_state" is null and "input_method" is null)
        or ("input_method_state" = 'declined' and "input_method" is null)
        or ("input_method_state" = 'recorded' and "input_method" is not null and "input_method" in ('manual', 'device', 'both'))),
	CONSTRAINT "wellness_profile_region_check" CHECK (("region_state" is null and "region" is null)
        or ("region_state" = 'declined' and "region" is null)
        or ("region_state" = 'recorded' and "region" is not null and "region" in ('us', 'uk', 'pt'))),
	CONSTRAINT "wellness_profile_birth_year_check" CHECK (("birth_year_state" is null and "birth_year" is null)
        or ("birth_year_state" = 'declined' and "birth_year" is null)
        or ("birth_year_state" = 'recorded' and "birth_year" is not null and "birth_year" between 1900 and 2100)),
	CONSTRAINT "wellness_profile_sex_check" CHECK (("sex_state" is null and "sex" is null)
        or ("sex_state" in ('declined', 'not_applicable') and "sex" is null)
        or ("sex_state" = 'recorded' and "sex" is not null and "sex" in ('female', 'male')))
);
--> statement-breakpoint
CREATE TABLE "wellness_profile_consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"version" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "wellness_profile_consent_purpose_check" CHECK ("purpose" in ('age_band', 'sex')),
	CONSTRAINT "wellness_profile_consent_withdrawn_after_granted_check" CHECK ("withdrawn_at" is null or "withdrawn_at" >= "granted_at")
);
--> statement-breakpoint
CREATE INDEX "wellness_profile_consent_user_id_idx" ON "wellness_profile_consent" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "wellness_profile_consent_active_key" ON "wellness_profile_consent" ("user_id","purpose") WHERE "withdrawn_at" is null;
--> statement-breakpoint
ALTER TABLE "wellness_profile" ADD CONSTRAINT "wellness_profile_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "wellness_profile_consent" ADD CONSTRAINT "wellness_profile_consent_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
