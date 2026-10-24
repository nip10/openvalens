-- AI coach chats are private to the member who wrote them, even in a shared
-- workspace. Existing rows predate per-member attribution; they are assigned to
-- the workspace owner (else its earliest member). Rows in a workspace with no
-- members at all were unreadable already and are removed.
ALTER TABLE "chat_message" ADD COLUMN "user_id" text;
--> statement-breakpoint
UPDATE "chat_message" AS cm SET "user_id" = (
	SELECT m."user_id" FROM "member" AS m
	WHERE m."organization_id" = cm."organization_id"
	ORDER BY (m."role" = 'owner') DESC, m."created_at", m."id"
	LIMIT 1
);
--> statement-breakpoint
DELETE FROM "chat_message" WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "chat_message" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "chat_message_organization_id_user_id_conversation_id_idx" ON "chat_message" USING btree ("organization_id","user_id","conversation_id");
