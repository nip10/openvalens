import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/client";

import { MAX_QUERY_RETRIES, shouldRetryQuery } from "./query-retry";

describe("shouldRetryQuery", () => {
  test("never retries a 4xx such as INVALID_INPUT", () => {
    const invalid = new ORPCError("INVALID_INPUT", { status: 400 });
    expect(shouldRetryQuery(0, invalid)).toBe(false);
    expect(shouldRetryQuery(0, new ORPCError("UNAUTHORIZED", { status: 401 }))).toBe(false);
    expect(shouldRetryQuery(0, new ORPCError("FORBIDDEN", { status: 403 }))).toBe(false);
  });

  test("retries transient 408/429 within the budget", () => {
    expect(shouldRetryQuery(0, new ORPCError("TIMEOUT", { status: 408 }))).toBe(true);
    expect(shouldRetryQuery(0, new ORPCError("TOO_MANY_REQUESTS", { status: 429 }))).toBe(true);
  });

  test("retries 5xx and network failures, but only a bounded number of times", () => {
    const server = new ORPCError("INTERNAL_SERVER_ERROR", { status: 500 });
    const network = new TypeError("Failed to fetch");
    for (const error of [server, network]) {
      expect(shouldRetryQuery(0, error)).toBe(true);
      expect(shouldRetryQuery(MAX_QUERY_RETRIES - 1, error)).toBe(true);
      expect(shouldRetryQuery(MAX_QUERY_RETRIES, error)).toBe(false);
    }
  });
});
