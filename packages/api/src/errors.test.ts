import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/server";

import { codeToStatus, raiseApiError, type ORPCErrorCode, type ORPCErrorStatus } from "./errors";

describe("codeToStatus", () => {
  test("maps every stable code to its HTTP status", () => {
    const expected: Record<ORPCErrorCode, ORPCErrorStatus> = {
      UNAUTHENTICATED: 401,
      NO_MEMBERSHIP: 403,
      PERMISSION_DENIED: 403,
      AI_DISABLED: 403,
      TENANT_VIOLATION: 403,
      INVALID_INPUT: 400,
      INTERNAL: 500,
      RATE_LIMITED: 429,
      NOT_FOUND: 404,
    };

    for (const code of Object.keys(expected) as ORPCErrorCode[]) {
      expect(codeToStatus(code)).toBe(expected[code]);
    }
  });
});

describe("raiseApiError", () => {
  test("constructs an ORPCError with the stable envelope shape", () => {
    const error = raiseApiError("INVALID_INPUT", "Invalid input", {
      fields: { message: ["Required"] },
    });

    expect(error).toBeInstanceOf(ORPCError);
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.status).toBe(400);
    expect(error.message).toBe("Invalid input");
    expect(error.data).toEqual({ fields: { message: ["Required"] } });
  });

  test("allows omitting the data payload", () => {
    const error = raiseApiError("NOT_FOUND", "Resource not found.");

    expect(error.code).toBe("NOT_FOUND");
    expect(error.status).toBe(404);
    expect(error.data).toBeUndefined();
  });
});
