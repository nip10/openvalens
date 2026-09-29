import { describe, expect, test } from "bun:test";

import {
  CORRELATION_ID_HEADER,
  normalizeCorrelationHeader,
  REQUEST_ID_HEADER,
  resolveCorrelationId,
  sanitizeCorrelationId,
} from "./correlation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("sanitizeCorrelationId", () => {
  test("preserves allowed characters and collapses invalid runs to '-'", () => {
    expect(sanitizeCorrelationId("corr id!!123")).toBe("corr-id-123");
    expect(sanitizeCorrelationId("aZ0._:-")).toBe("aZ0._:-");
  });

  test("truncates values longer than 64 characters", () => {
    const long = "a".repeat(100);
    const sanitized = sanitizeCorrelationId(long);
    expect(sanitized).toHaveLength(64);
    expect(sanitized).toBe("a".repeat(64));
  });

  test("falls back to a UUID when the sanitized value is empty", () => {
    expect(sanitizeCorrelationId("   ")).toMatch(UUID_PATTERN);
  });
});

describe("normalizeCorrelationHeader", () => {
  test("prefers x-correlation-id over x-request-id", () => {
    const result = normalizeCorrelationHeader(
      headers({
        [CORRELATION_ID_HEADER]: "corr-abc",
        [REQUEST_ID_HEADER]: "req-xyz",
      }),
    );
    expect(result).toBe("corr-abc");
  });

  test("falls back to x-request-id", () => {
    const result = normalizeCorrelationHeader(headers({ [REQUEST_ID_HEADER]: "req-xyz" }));
    expect(result).toBe("req-xyz");
  });

  test("sanitizes the resolved header value", () => {
    const result = normalizeCorrelationHeader(headers({ [CORRELATION_ID_HEADER]: "corr id!!123" }));
    expect(result).toBe("corr-id-123");
  });

  test("generates a UUID when no header is present", () => {
    expect(normalizeCorrelationHeader(headers({}))).toMatch(UUID_PATTERN);
  });

  test("generates a UUID when the correlation header is empty", () => {
    expect(normalizeCorrelationHeader(headers({ [CORRELATION_ID_HEADER]: "" }))).toMatch(
      UUID_PATTERN,
    );
  });
});

describe("resolveCorrelationId", () => {
  test("is an alias for normalizeCorrelationHeader", () => {
    expect(resolveCorrelationId(headers({ [CORRELATION_ID_HEADER]: "corr-1" }))).toBe("corr-1");
  });
});
