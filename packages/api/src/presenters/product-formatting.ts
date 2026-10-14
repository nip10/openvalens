/**
 * Product display formatting shared by web and mobile: locale-aware number,
 * date and time helpers plus the canonical metric↔imperial conversion used at
 * the presentation edge. Pure TypeScript, no imports — safe for the app
 * bundle.
 *
 * Canonical data stays metric (kg, metres) and canonical wire timestamps stay
 * ISO. Nothing here mutates a stored value; conversion happens only for
 * display. Locale affects formatting only — never timezone, translation, or
 * the technical day keys used elsewhere (for example timeline grouping).
 */

/** Display units accepted by the product settings contract. */
export type ProductUnits = "metric" | "imperial";
/** Locales the product supports. */
export type ProductLocale = "en-US" | "en-GB" | "en-CA";

/**
 * Structural shape of the client-safe product display settings. Kept local so
 * presenters stay dependency-free; assignable from the shared contract type
 * (`{ units, locale }`). An optional `timeZone` may be supplied by callers that
 * already know the display timezone; it is never derived from the locale.
 */
export type ProductDisplaySettings = {
  units: ProductUnits;
  locale: ProductLocale;
  timeZone?: string;
};

/** Exact kilogram→pound factor (1 lb = 0.45359237 kg). */
export const KG_TO_LB = 2.2046226218487757;
/** Exact metres per international mile. */
export const METERS_PER_MILE = 1609.344;

export function kgToLb(kg: number): number {
  return kg * KG_TO_LB;
}

export function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}

/** Locale-aware number formatting. Grouping/fraction options are explicit. */
export function formatProductNumber(
  value: number,
  locale: ProductLocale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/**
 * Locale-aware calendar date. Defaults to the product's short month/day/year
 * copy. `timeZone` is only applied when explicitly provided, so existing
 * device-local behavior is preserved.
 */
export function formatProductDate(
  date: Date,
  locale: ProductLocale,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" },
  timeZone?: string,
): string {
  return new Intl.DateTimeFormat(locale, timeZone ? { ...options, timeZone } : options).format(
    date,
  );
}

/**
 * Locale-aware 24-hour clock time. `timeZone` is only applied when explicitly
 * provided, so existing device-local behavior is preserved.
 */
export function formatProductTime(
  date: Date,
  locale: ProductLocale,
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  timeZone?: string,
): string {
  return new Intl.DateTimeFormat(locale, timeZone ? { ...options, timeZone } : options).format(
    date,
  );
}
