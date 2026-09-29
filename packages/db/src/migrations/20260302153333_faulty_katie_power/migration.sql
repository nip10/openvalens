CREATE TABLE "access_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_user_id" text,
	"event_type" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_request" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"requester_user_id" text NOT NULL,
	"target_domain" text NOT NULL,
	"requested_actions" jsonb NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" text NOT NULL,
	"resolved_at" text,
	"resolved_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "access_request_decision" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"decision" text NOT NULL,
	"by_user_id" text,
	"note" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_notification" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"payload_json" jsonb,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"read_at" text
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inviter_id" text
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_role" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"role" text NOT NULL,
	"permission" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_organization_id" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "access_audit_log" ADD CONSTRAINT "access_audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_audit_log" ADD CONSTRAINT "access_audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_request" ADD CONSTRAINT "access_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_request" ADD CONSTRAINT "access_request_requester_user_id_user_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_request" ADD CONSTRAINT "access_request_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_request_decision" ADD CONSTRAINT "access_request_decision_request_id_access_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."access_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_request_decision" ADD CONSTRAINT "access_request_decision_by_user_id_user_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_notification" ADD CONSTRAINT "admin_notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_role" ADD CONSTRAINT "organization_role_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_audit_log_organization_id_idx" ON "access_audit_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "access_audit_log_actor_user_id_idx" ON "access_audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "access_audit_log_event_type_idx" ON "access_audit_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "access_audit_log_created_at_idx" ON "access_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "access_audit_log_organization_id_created_at_idx" ON "access_audit_log" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "access_request_organization_id_idx" ON "access_request" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "access_request_requester_user_id_idx" ON "access_request" USING btree ("requester_user_id");--> statement-breakpoint
CREATE INDEX "access_request_status_idx" ON "access_request" USING btree ("status");--> statement-breakpoint
CREATE INDEX "access_request_created_at_idx" ON "access_request" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "access_request_resolved_by_user_id_idx" ON "access_request" USING btree ("resolved_by_user_id");--> statement-breakpoint
CREATE INDEX "access_request_requester_user_id_created_at_idx" ON "access_request" USING btree ("requester_user_id","created_at");--> statement-breakpoint
CREATE INDEX "access_request_organization_id_status_idx" ON "access_request" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "access_request_decision_request_id_idx" ON "access_request_decision" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "access_request_decision_by_user_id_idx" ON "access_request_decision" USING btree ("by_user_id");--> statement-breakpoint
CREATE INDEX "access_request_decision_created_at_idx" ON "access_request_decision" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_notification_organization_id_idx" ON "admin_notification" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "admin_notification_type_idx" ON "admin_notification" USING btree ("type");--> statement-breakpoint
CREATE INDEX "admin_notification_is_read_idx" ON "admin_notification" USING btree ("is_read");--> statement-breakpoint
CREATE INDEX "admin_notification_created_at_idx" ON "admin_notification" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_notification_organization_id_is_read_idx" ON "admin_notification" USING btree ("organization_id","is_read");--> statement-breakpoint
CREATE INDEX "admin_notification_organization_id_is_read_created_at_idx" ON "admin_notification" USING btree ("organization_id","is_read","created_at");--> statement-breakpoint
CREATE INDEX "invitation_organization_id_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "invitation_status_idx" ON "invitation" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invitation_expires_at_idx" ON "invitation" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "invitation_inviter_id_idx" ON "invitation" USING btree ("inviter_id");--> statement-breakpoint
CREATE INDEX "member_organization_id_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_user_id_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_organization_id_user_id_key" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_key" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "organization_role_organization_id_idx" ON "organization_role" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_role_organization_id_role_key" ON "organization_role" USING btree ("organization_id","role");--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_impersonated_by_user_id_fk" FOREIGN KEY ("impersonated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;