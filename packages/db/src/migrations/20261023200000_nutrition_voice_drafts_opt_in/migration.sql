-- Issue #73: food drafts from a spoken description are opt-in and can be turned
-- off again. Drafts are never stored, so turning it off leaves nothing behind.
ALTER TABLE "nutrition_target_settings" ADD COLUMN "voice_drafts_enabled" boolean DEFAULT false NOT NULL;
