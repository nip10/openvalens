/**
 * Shipped UI languages (#67). Adding a language means adding its code here,
 * to `lingui.config.ts` and to `review-state.json`, then a release: catalogs
 * compile at build time.
 */
export const LOCALES = ["en", "pt-PT"] as const;
export type Locale = (typeof LOCALES)[number];
export const SOURCE_LOCALE: Locale = "en";

/** Each language named in itself, so a member can always find their own. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = Object.freeze({
  en: "English",
  "pt-PT": "Português (Portugal)",
});

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks a shipped locale from preferences in order (a saved choice, then the
 * device or browser languages). Any Portuguese variant maps to pt-PT, the only
 * Portuguese shipped; pt-BR is community scope. Anything else is English.
 */
export function resolveLocale(preferences: readonly (string | null | undefined)[]): Locale {
  for (const preference of preferences) {
    if (!preference) continue;
    if (isLocale(preference)) return preference;
    const language = preference.toLowerCase().split(/[-_]/)[0];
    if (language === "en") return "en";
    if (language === "pt") return "pt-PT";
  }
  return SOURCE_LOCALE;
}
