import { describe, expect, test } from "bun:test";

import { isConfigPermissionDenied } from "./admin-settings-error";

describe("isConfigPermissionDenied", () => {
  test("returns true for PERMISSION_DENIED code", () => {
    expect(isConfigPermissionDenied({ code: "PERMISSION_DENIED" })).toBe(true);
  });

  test("returns true for UNAUTHENTICATED code", () => {
    expect(isConfigPermissionDenied({ code: "UNAUTHENTICATED" })).toBe(true);
  });

  test("returns true for FORBIDDEN code", () => {
    expect(isConfigPermissionDenied({ code: "FORBIDDEN" })).toBe(true);
  });

  test("returns true for UNAUTHORIZED code", () => {
    expect(isConfigPermissionDenied({ code: "UNAUTHORIZED" })).toBe(true);
  });

  test("returns true for 401 status", () => {
    expect(isConfigPermissionDenied({ status: 401 })).toBe(true);
  });

  test("returns true for 403 status", () => {
    expect(isConfigPermissionDenied({ status: 403 })).toBe(true);
  });

  test("returns false for other errors", () => {
    expect(isConfigPermissionDenied({ code: "INTERNAL_SERVER_ERROR" })).toBe(false);
    expect(isConfigPermissionDenied({ status: 500 })).toBe(false);
    expect(isConfigPermissionDenied("network error")).toBe(false);
    expect(isConfigPermissionDenied(null)).toBe(false);
    expect(isConfigPermissionDenied(undefined)).toBe(false);
  });
});
