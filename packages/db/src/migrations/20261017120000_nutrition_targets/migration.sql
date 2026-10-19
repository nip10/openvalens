-- Issue #80 — user-owned nutrition targets, safety policy nutrition-safety/v1
-- and hide-numbers mode.
--
-- 1. `nutrition_goal` gains where a target came from (`entered` by the member
--    or accepted from a #76 `proposal`) and the local dates it applies
--    between. Existing rows default to `entered` with no dates (they apply
--    from creation until archived), which is what they were.
-- 2. `nutrition_energy_proposal.kind` may now be `deficit` or `gain`; those
--    are only ever planned through the nutrition safety policy.
-- 3. `nutrition_target_settings`: one row per (workspace, member) with
--    hide-numbers mode, suggestion direction (maintain by default), the active
--    opt-in for the protein reference, a self-declared height and the member's
--    self-declared yes/no answers. A missing row means the defaults.
--
-- Generated with drizzle-kit and reduced to this change's statements.
-- Additive: new nullable/defaulted columns, a widened check and a new table;
-- no data movement.

ALTER TABLE "nutrition_goal" ADD COLUMN "source" text DEFAULT 'entered' NOT NULL;
--> statement-breakpoint
ALTER TABLE "nutrition_goal" ADD COLUMN "effective_from" text;
--> statement-breakpoint
ALTER TABLE "nutrition_goal" ADD COLUMN "effective_to" text;
--> statement-breakpoint
ALTER TABLE "nutrition_goal" ADD CONSTRAINT "nutrition_goal_source_check" CHECK ("source" in ('entered', 'proposal'));
--> statement-breakpoint
ALTER TABLE "nutrition_goal" ADD CONSTRAINT "nutrition_goal_effective_check" CHECK (("effective_from" is null or "effective_from" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
        and ("effective_to" is null or "effective_to" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
        and ("effective_from" is null or "effective_to" is null or "effective_from" <= "effective_to"));
--> statement-breakpoint
ALTER TABLE "nutrition_energy_proposal" DROP CONSTRAINT "nutrition_energy_proposal_kind_check";
--> statement-breakpoint
ALTER TABLE "nutrition_energy_proposal" ADD CONSTRAINT "nutrition_energy_proposal_kind_check" CHECK ("kind" in ('maintenance', 'deficit', 'gain'));
--> statement-breakpoint
CREATE TABLE "nutrition_target_settings" (
	"organization_id" text,
	"user_id" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"hide_numbers" boolean DEFAULT false NOT NULL,
	"energy_direction" text DEFAULT 'maintain' NOT NULL,
	"active_protein" boolean DEFAULT false NOT NULL,
	"height_cm" real,
	"declarations" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_target_settings_pkey" PRIMARY KEY("organization_id","user_id"),
	CONSTRAINT "nutrition_target_settings_revision_check" CHECK ("revision" >= 0),
	CONSTRAINT "nutrition_target_settings_direction_check" CHECK ("energy_direction" in ('maintain', 'lose', 'gain')),
	CONSTRAINT "nutrition_target_settings_height_check" CHECK ("height_cm" is null or ("height_cm" >= 100 and "height_cm" <= 250)),
	CONSTRAINT "nutrition_target_settings_declarations_check" CHECK ("declarations" <@ array['pregnant_or_breastfeeding', 'eating_disorder', 'glucose_lowering_medication', 'chronic_kidney_disease', 'cancer_treatment', 'bariatric_surgery', 'refeeding_syndrome', 'glp1_medication']::text[])
);
--> statement-breakpoint
CREATE INDEX "nutrition_target_settings_user_id_idx" ON "nutrition_target_settings" ("user_id");
--> statement-breakpoint
ALTER TABLE "nutrition_target_settings" ADD CONSTRAINT "nutrition_target_settings_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "nutrition_target_settings" ADD CONSTRAINT "nutrition_target_settings_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "nutrition_target_settings" ADD CONSTRAINT "nutrition_target_settings_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE RESTRICT;
