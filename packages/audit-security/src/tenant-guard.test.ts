import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/server";

import {
  assertTenantBoundary,
  TENANT_VIOLATION_CODE,
  TENANT_VIOLATION_STATUS,
  TenantViolationError,
} from "./tenant-guard";

describe("assertTenantBoundary", () => {
  test("does not throw when the organizations match", () => {
    expect(() => assertTenantBoundary("org-1", "org-1")).not.toThrow();
  });

  test("throws TenantViolationError when the organizations differ", () => {
    let caught: unknown;
    try {
      assertTenantBoundary("org-1", "org-2");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TenantViolationError);
    const violation = caught as TenantViolationError;
    expect(violation.code).toBe(TENANT_VIOLATION_CODE);
    expect(violation.status).toBe(403);
    expect(violation.actorOrganizationId).toBe("org-1");
    expect(violation.resourceOrganizationId).toBe("org-2");
  });

  test("throws when the actor has no organization", () => {
    expect(() => assertTenantBoundary(null, "org-1")).toThrow(TenantViolationError);
  });
});

describe("TenantViolationError.toApiError", () => {
  test("produces an ORPCError with the TENANT_VIOLATION envelope", () => {
    const error = new TenantViolationError("org-1", "org-2").toApiError();

    expect(error).toBeInstanceOf(ORPCError);
    expect(error.code).toBe(TENANT_VIOLATION_CODE);
    expect(error.status).toBe(TENANT_VIOLATION_STATUS);
    expect(error.data).toEqual({
      actorOrganizationId: "org-1",
      resourceOrganizationId: "org-2",
    });
  });
});
