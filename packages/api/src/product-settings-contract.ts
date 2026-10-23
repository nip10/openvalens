import { z } from "zod";

/**
 * Issue #58 — client-safe product display-settings contract.
 *
 * This module is deliberately free of any `@openvalens/db` or
 * `@openvalens/auth` import so the web/native bundles can consume the types and
 * the Zod schema without pulling server-only dependencies. It defines only the
 * two user-facing display preferences (units and locale) and the optimistic
 * revision used by the admin mutation; it never models environment inventory,
 * credentials or any other server configuration.
 */

/** Display unit system. Health storage stays canonical (kg / meters). */
export const PRODUCT_UNITS = ["metric", "imperial"] as const;
export type ProductUnits = (typeof PRODUCT_UNITS)[number];

/** Presentation locale. Controls formatting, not timezone or translation. */
export const PRODUCT_LOCALES = ["en-US", "en-GB", "en-CA", "pt-PT"] as const;
export type ProductLocale = (typeof PRODUCT_LOCALES)[number];

/** The effective product display settings (public fields only). */
export type ProductDisplaySettings = {
  units: ProductUnits;
  locale: ProductLocale;
};

/** Installation defaults. Frozen so callers cannot mutate the shared value. */
export const DEFAULT_PRODUCT_DISPLAY_SETTINGS: ProductDisplaySettings = Object.freeze({
  units: "metric",
  locale: "en-US",
});

export const productUnitsSchema = z.enum(PRODUCT_UNITS);
export const productLocaleSchema = z.enum(PRODUCT_LOCALES);

/**
 * Strict admin mutation input.
 *
 * `strictObject` rejects unknown keys (including `__proto__`-style and any
 * secret/credential field a caller might try to smuggle through). `z.int()`
 * only accepts safe integers, so a float, `NaN`, `Infinity` or an out-of-range
 * revision is rejected; `nonnegative()` additionally rejects negatives. All
 * three fields are required.
 */
export const productSettingsUpdateInput = z.strictObject({
  units: productUnitsSchema,
  locale: productLocaleSchema,
  expectedRevision: z.int().nonnegative(),
});

export type ProductSettingsUpdateInput = z.infer<typeof productSettingsUpdateInput>;

/**
 * The effective snapshot returned by both the read and the update procedure.
 * `canEdit` is resolved fresh from the database on every request and is never
 * cached.
 */
export const productSettingsSnapshotSchema = z.strictObject({
  units: productUnitsSchema,
  locale: productLocaleSchema,
  revision: z.int().nonnegative(),
  canEdit: z.boolean(),
});

export type ProductSettingsSnapshot = z.infer<typeof productSettingsSnapshotSchema>;
