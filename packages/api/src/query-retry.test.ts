import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/client";

import { MAX_QUERY_RETRIES, shouldRetryQuery } from "./query-retry";

describe("shouldRetryQuery", () => {
  test("never retries a client error", () => {
    for (const status of [400, 401, 403, 404, 409, 429]) {
      expect(shouldRetryQuery(0, new ORPCError("X", { status }))).toBe(false);
    }
  });

  test("retries server and network failures a bounded number of times", () => {
    for (const error of [new ORPCError("INTERNAL", { status: 500 }), new TypeError("fetch")]) {
      expect(shouldRetryQuery(0, error)).toBe(true);
      expect(shouldRetryQuery(MAX_QUERY_RETRIES - 1, error)).toBe(true);
      expect(shouldRetryQuery(MAX_QUERY_RETRIES, error)).toBe(false);
    }
  });
});
