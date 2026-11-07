/**
 * The macro preset and protein-per-kg choices a member can store (#390
 * follow-up), so the weekly check-in can propose P/C/F with energy. Pure and
 * client-safe; the split itself lives in `@openvalens/api/presenters/macro-presets`.
 */
export const MACRO_PRESET_KEYS = ["balanced", "lower_carb", "lower_fat"] as const;
export type MacroPresetKey = (typeof MACRO_PRESET_KEYS)[number];

/** Every g/kg value the preset card can offer; the member's protein reference narrows it. */
export const PROTEIN_G_PER_KG_CHOICES = [0.8, 1, 1.2, 1.4, 1.6] as const;
export type ProteinGPerKg = (typeof PROTEIN_G_PER_KG_CHOICES)[number];
