import "@/testing/varlock-test-setup";

import { describe, expect, test } from "bun:test";

import { isProductSettingsConflictError } from "./product-settings";
import { productSettingsQueryKey } from "./product-settings-keys";

describe("product-settings query keys", () => {
  test("key is scoped to the signed-in user id", () => {
    expect(productSettingsQueryKey("user-a")).toEqual(["product-settings", "user-a"]);
    expect(productSettingsQueryKey("user-b")).toEqual(["product-settings", "user-b"]);
    expect(productSettingsQueryKey("user-a")).not.toEqual(productSettingsQueryKey("user-b"));
  });
});

describe("isProductSettingsConflictError", () => {
  test("returns true for typed CONFLICT errors", () => {
    expect(isProductSettingsConflictError({ code: "CONFLICT" })).toBe(true);
  });

  test("returns false for other errors", () => {
    expect(isProductSettingsConflictError({ code: "PERMISSION_DENIED" })).toBe(false);
    expect(isProductSettingsConflictError(new Error("network"))).toBe(false);
    expect(isProductSettingsConflictError(null)).toBe(false);
  });
});
