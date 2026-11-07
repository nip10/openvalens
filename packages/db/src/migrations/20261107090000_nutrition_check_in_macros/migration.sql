-- #390 follow-up — the weekly check-in proposes P/C/F with energy from the member's stored preset.
ALTER TABLE "nutrition_target_settings" ADD COLUMN "macro_preset" text;--> statement-breakpoint
ALTER TABLE "nutrition_target_settings" ADD COLUMN "protein_g_per_kg" real;--> statement-breakpoint
ALTER TABLE "nutrition_target_settings" ADD CONSTRAINT "nutrition_target_settings_macro_preset_check" CHECK ("nutrition_target_settings"."macro_preset" is null or "nutrition_target_settings"."macro_preset" in ('balanced', 'lower_carb', 'lower_fat'));--> statement-breakpoint
ALTER TABLE "nutrition_target_settings" ADD CONSTRAINT "nutrition_target_settings_protein_g_per_kg_check" CHECK ("nutrition_target_settings"."protein_g_per_kg" is null or "nutrition_target_settings"."protein_g_per_kg" in (0.8, 1, 1.2, 1.4, 1.6));
