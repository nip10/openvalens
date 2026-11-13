-- Issue #446: the in-app "What's new" card. Whether the member wants it (on by
-- default) and the last release version whose card they dismissed. Additive;
-- existing rows keep their language and get the defaults.
ALTER TABLE "user_preference" ADD COLUMN IF NOT EXISTS "whats_new_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN IF NOT EXISTS "whats_new_dismissed_version" text;
