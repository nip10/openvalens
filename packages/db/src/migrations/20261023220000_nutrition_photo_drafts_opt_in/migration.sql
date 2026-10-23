-- Issue #71: food drafts from a meal photo are opt-in and can be turned off
-- again. Photos and drafts are never stored, so turning it off leaves nothing behind.
ALTER TABLE "nutrition_target_settings" ADD COLUMN "photo_drafts_enabled" boolean DEFAULT false NOT NULL;
