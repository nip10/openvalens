-- Issue #76 — experimental energy estimate: user-reviewed target proposals.
--
-- The estimate itself is recomputed on request from daily totals (#79) and the
-- weight trend (#87) and is never stored. `nutrition_energy_proposal` keeps a
-- suggested energy target with the transparent estimate it came from, so the
-- member can accept or dismiss it. At most one proposal per (workspace,
-- person) is pending. A proposal never changes a goal by itself: only an
-- explicit accept writes `nutrition_goal`, recorded in `accepted_goal_id`.
--
-- Generated with drizzle-kit and reduced to this change's statements. Additive
-- only: one new table, no data movement.

CREATE TABLE "nutrition_energy_proposal" (
	"id" serial PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"estimate_kcal" integer NOT NULL,
	"target_kcal" integer NOT NULL,
	"current_target_kcal" integer,
	"step_limited" boolean DEFAULT false NOT NULL,
	"method_version" integer NOT NULL,
	"policy_version" text NOT NULL,
	"window_from" text NOT NULL,
	"window_to" text NOT NULL,
	"estimate" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"accepted_goal_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_energy_proposal_kind_check" CHECK ("kind" in ('maintenance')),
	CONSTRAINT "nutrition_energy_proposal_status_check" CHECK ("status" in ('pending', 'accepted', 'dismissed', 'superseded')),
	CONSTRAINT "nutrition_energy_proposal_kcal_check" CHECK ("estimate_kcal" > 0 and "target_kcal" > 0
        and ("current_target_kcal" is null or "current_target_kcal" >= 0)),
	CONSTRAINT "nutrition_energy_proposal_window_check" CHECK ("window_from" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and "window_to" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and "window_from" <= "window_to"),
	CONSTRAINT "nutrition_energy_proposal_decision_check" CHECK (("status" = 'pending') = ("decided_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_energy_proposal_org_user_pending_key" ON "nutrition_energy_proposal" ("organization_id","user_id") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX "nutrition_energy_proposal_org_user_created_idx" ON "nutrition_energy_proposal" ("organization_id","user_id","created_at");
--> statement-breakpoint
CREATE INDEX "nutrition_energy_proposal_user_id_idx" ON "nutrition_energy_proposal" ("user_id");
--> statement-breakpoint
ALTER TABLE "nutrition_energy_proposal" ADD CONSTRAINT "nutrition_energy_proposal_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "nutrition_energy_proposal" ADD CONSTRAINT "nutrition_energy_proposal_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "nutrition_energy_proposal" ADD CONSTRAINT "nutrition_energy_proposal_accepted_goal_fk" FOREIGN KEY ("accepted_goal_id") REFERENCES "nutrition_goal"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "nutrition_energy_proposal" ADD CONSTRAINT "nutrition_energy_proposal_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE RESTRICT;
