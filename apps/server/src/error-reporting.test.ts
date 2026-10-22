import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/server";

import { initErrorReporting, isReportable, reportError } from "./error-reporting";

describe("server error reporting", () => {
  test("stays off without a DSN and reporting is then a no-op", () => {
    expect(initErrorReporting(null)).toBe(false);
    expect(() => reportError(new Error("boom"))).not.toThrow();
  });

  test("reports unexpected failures only, never client errors", () => {
    expect(isReportable(new Error("boom"))).toBe(true);
    expect(isReportable(new ORPCError("INTERNAL_SERVER_ERROR"))).toBe(true);
    expect(isReportable(new ORPCError("BAD_REQUEST"))).toBe(false);
    expect(isReportable(new ORPCError("UNAUTHORIZED"))).toBe(false);
    expect(isReportable(new ORPCError("NOT_FOUND"))).toBe(false);
  });
});
