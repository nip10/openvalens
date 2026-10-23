-- Issue #67: Portugal (pt-PT) date and number formatting for the installation default.
ALTER TABLE "product_settings" DROP CONSTRAINT "product_settings_locale_check";
--> statement-breakpoint
ALTER TABLE "product_settings" ADD CONSTRAINT "product_settings_locale_check" CHECK ("locale" in ('en-US', 'en-GB', 'en-CA', 'pt-PT'));
