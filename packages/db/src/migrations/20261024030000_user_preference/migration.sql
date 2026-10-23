-- Issue #231: the member's interface language, for server-sent email and push.
CREATE TABLE "user_preference" (
	"user_id" text PRIMARY KEY NOT NULL,
	"locale" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preference_locale_check" CHECK ("locale" in ('en', 'pt-PT'))
);
--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
