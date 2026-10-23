import { describe, expect, test } from "bun:test";

import {
  DEFAULT_PRODUCT_DISPLAY_SETTINGS,
  PRODUCT_LOCALES,
  PRODUCT_UNITS,
  productSettingsSnapshotSchema,
  productSettingsUpdateInput,
} from "./product-settings-contract";

/**
 * Issue #58 — client-safe contract unit suite. Pure Zod, no database/auth.
 */

describe("product-settings contract", () => {
  test("defaults are metric/en-US and frozen", () => {
    expect(DEFAULT_PRODUCT_DISPLAY_SETTINGS).toEqual({ units: "metric", locale: "en-US" });
    expect(Object.isFrozen(DEFAULT_PRODUCT_DISPLAY_SETTINGS)).toBe(true);
    expect(PRODUCT_UNITS).toEqual(["metric", "imperial"]);
    expect(PRODUCT_LOCALES).toEqual(["en-US", "en-GB", "en-CA", "pt-PT"]);
  });

  test("accepts a fully specified valid mutation", () => {
    const parsed = productSettingsUpdateInput.parse({
      units: "imperial",
      locale: "en-CA",
      expectedRevision: 3,
    });
    expect(parsed).toEqual({ units: "imperial", locale: "en-CA", expectedRevision: 3 });
  });

  test("accepts revision 0 (the initial revision)", () => {
    expect(
      productSettingsUpdateInput.safeParse({
        units: "metric",
        locale: "en-US",
        expectedRevision: 0,
      }).success,
    ).toBe(true);
  });

  test("rejects an unsupported units or locale value", () => {
    expect(
      productSettingsUpdateInput.safeParse({
        units: "us",
        locale: "en-US",
        expectedRevision: 0,
      }).success,
    ).toBe(false);
    expect(
      productSettingsUpdateInput.safeParse({
        units: "metric",
        locale: "fr-FR",
        expectedRevision: 0,
      }).success,
    ).toBe(false);
  });

  test("rejects a negative, float, NaN or unsafe revision", () => {
    for (const expectedRevision of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expect(
        productSettingsUpdateInput.safeParse({ units: "metric", locale: "en-US", expectedRevision })
          .success,
      ).toBe(false);
    }
  });

  test("requires all three fields", () => {
    expect(productSettingsUpdateInput.safeParse({ units: "metric", locale: "en-US" }).success).toBe(
      false,
    );
    expect(
      productSettingsUpdateInput.safeParse({ units: "metric", expectedRevision: 0 }).success,
    ).toBe(false);
  });

  test("rejects unknown keys, prototype keys and secret fields", () => {
    const base = { units: "metric", locale: "en-US", expectedRevision: 0 };
    expect(productSettingsUpdateInput.safeParse({ ...base, extra: true }).success).toBe(false);
    expect(
      productSettingsUpdateInput.safeParse(
        JSON.parse(
          '{"units":"metric","locale":"en-US","expectedRevision":0,"__proto__":{"polluted":true}}',
        ),
      ).success,
    ).toBe(false);
    expect(
      productSettingsUpdateInput.safeParse({ ...base, ANTHROPIC_API_KEY: "sk-secret" }).success,
    ).toBe(false);
    expect(productSettingsUpdateInput.safeParse({ ...base, reason: "why" }).success).toBe(false);
  });

  test("snapshot schema rejects unknown keys and requires canEdit", () => {
    expect(
      productSettingsSnapshotSchema.safeParse({
        units: "metric",
        locale: "en-US",
        revision: 0,
        canEdit: false,
      }).success,
    ).toBe(true);
    expect(
      productSettingsSnapshotSchema.safeParse({
        units: "metric",
        locale: "en-US",
        revision: 0,
      }).success,
    ).toBe(false);
    expect(
      productSettingsSnapshotSchema.safeParse({
        units: "metric",
        locale: "en-US",
        revision: 0,
        canEdit: false,
        extra: "leak",
      }).success,
    ).toBe(false);
  });
});
