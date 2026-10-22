-- Issue #82: recipe import from a URL is opt-in and can be turned off again.
-- Imports produce client-side drafts only, so turning it off leaves nothing behind.
ALTER TABLE "nutrition_target_settings" ADD COLUMN "recipe_import_enabled" boolean DEFAULT false NOT NULL;
