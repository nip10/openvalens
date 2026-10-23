import { describe, expect, test } from "bun:test";

import { classifyAdmissionError, isAdmissionPermissionDenied } from "./admission-error";

describe("classifyAdmissionError", () => {
  test("maps finite oRPC codes to local codes", () => {
    expect(classifyAdmissionError({ code: "RATE_LIMITED" })).toBe("rate_limited");
    expect(classifyAdmissionError({ code: "EMAIL_UNAVAILABLE", status: 503 })).toBe(
      "email_unavailable",
    );
    expect(classifyAdmissionError({ code: "INVALID_INPUT" })).toBe("invalid_input");
    expect(classifyAdmissionError({ code: "UNAUTHENTICATED" })).toBe("session_mismatch");
    expect(classifyAdmissionError({ code: "UNAUTHORIZED" })).toBe("session_mismatch");
    expect(classifyAdmissionError({ code: "PERMISSION_DENIED" })).toBe("denied");
    expect(classifyAdmissionError({ code: "FORBIDDEN" })).toBe("denied");
    expect(classifyAdmissionError({ code: "INTERNAL" })).toBe("unknown");
  });

  test("maps HTTP statuses when code is missing", () => {
    expect(classifyAdmissionError({ status: 429 })).toBe("rate_limited");
    expect(classifyAdmissionError({ status: 400 })).toBe("invalid_input");
    expect(classifyAdmissionError({ status: 401 })).toBe("session_mismatch");
    expect(classifyAdmissionError({ status: 403 })).toBe("denied");
  });

  test("maps missing status to network", () => {
    expect(classifyAdmissionError({})).toBe("network");
    expect(classifyAdmissionError(null)).toBe("unknown");
  });

  test("never echoes raw server values", () => {
    const error = { code: "PERMISSION_DENIED", message: "secret bearer xyz" };
    const code = classifyAdmissionError(error);
    expect(code).toBe("denied");
  });
});

describe("isAdmissionPermissionDenied", () => {
  test("returns true for denied and session mismatch codes", () => {
    expect(isAdmissionPermissionDenied({ code: "PERMISSION_DENIED" })).toBe(true);
    expect(isAdmissionPermissionDenied({ code: "UNAUTHENTICATED" })).toBe(true);
    expect(isAdmissionPermissionDenied({ code: "RATE_LIMITED" })).toBe(false);
  });
});
