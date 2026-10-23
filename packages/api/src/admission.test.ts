import { describe, expect, test } from "bun:test";
import { AdmissionError } from "@openvalens/auth/admission";
import { ORPCError } from "@orpc/server";

import {
  ADMISSION_RATE_LIMIT_KEYS,
  admissionBeginInput,
  checkAdmissionRateLimit,
  mapAdmissionError,
  parseAdmissionInput,
  requireAdmissionOrigin,
} from "./admission";
import type { Context } from "./context";

function context(overrides: {
  admissionOrigin?: string;
  origin?: string;
  limiter?: { check: (key: string) => { allowed: boolean } };
}): Context {
  const headers = new Headers();
  if (overrides.origin !== undefined) headers.set("origin", overrides.origin);
  return {
    admissionOrigin: overrides.admissionOrigin,
    admissionRateLimiter: overrides.limiter,
    honoContext: { req: { raw: { headers } } },
  } as unknown as Context;
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ORPCError) return error.code;
    throw error;
  }
  throw new Error("expected a throw");
}

describe("requireAdmissionOrigin", () => {
  test("fails closed with INTERNAL when no origin is configured", () => {
    expect(codeOf(() => requireAdmissionOrigin(context({})))).toBe("INTERNAL");
  });

  test("rejects a missing or foreign origin with PERMISSION_DENIED", () => {
    expect(
      codeOf(() => requireAdmissionOrigin(context({ admissionOrigin: "https://app.test" }))),
    ).toBe("PERMISSION_DENIED");
    expect(
      codeOf(() =>
        requireAdmissionOrigin(
          context({ admissionOrigin: "https://app.test", origin: "https://evil.test" }),
        ),
      ),
    ).toBe("PERMISSION_DENIED");
  });

  test("allows an exact origin match", () => {
    expect(() =>
      requireAdmissionOrigin(
        context({ admissionOrigin: "https://app.test", origin: "https://app.test" }),
      ),
    ).not.toThrow();
  });
});

describe("checkAdmissionRateLimit", () => {
  test("fails closed when the limiter is absent", () => {
    expect(
      codeOf(() => checkAdmissionRateLimit(context({}), ADMISSION_RATE_LIMIT_KEYS.begin)),
    ).toBe("INTERNAL");
  });

  test("maps a denied decision to RATE_LIMITED and allows otherwise", () => {
    const seen: string[] = [];
    const limiter = {
      check: (key: string) => {
        seen.push(key);
        return { allowed: false };
      },
    };
    expect(
      codeOf(() => checkAdmissionRateLimit(context({ limiter }), ADMISSION_RATE_LIMIT_KEYS.issue)),
    ).toBe("RATE_LIMITED");
    expect(seen).toEqual(["admission:issue"]);

    expect(() =>
      checkAdmissionRateLimit(
        context({ limiter: { check: () => ({ allowed: true }) } }),
        "admission:begin",
      ),
    ).not.toThrow();
  });
});

describe("mapAdmissionError", () => {
  test("maps each admission code to a stable, value-free envelope", () => {
    expect(codeOf(() => mapAdmissionError(new AdmissionError("DENIED")))).toBe("PERMISSION_DENIED");
    expect(codeOf(() => mapAdmissionError(new AdmissionError("RATE_LIMITED")))).toBe(
      "RATE_LIMITED",
    );
    expect(codeOf(() => mapAdmissionError(new AdmissionError("DELIVERY_FAILED")))).toBe("INTERNAL");
    expect(codeOf(() => mapAdmissionError(new AdmissionError("EMAIL_UNAVAILABLE")))).toBe(
      "EMAIL_UNAVAILABLE",
    );
    expect(codeOf(() => mapAdmissionError(new AdmissionError("INTERNAL")))).toBe("INTERNAL");
    expect(codeOf(() => mapAdmissionError(new Error("raw db dsn secret")))).toBe("INTERNAL");
  });
});

describe("parseAdmissionInput", () => {
  test("returns parsed values for valid input", () => {
    expect(
      parseAdmissionInput(admissionBeginInput, {
        kind: "setup",
        credential: "abc",
        email: "user@example.com",
      }),
    ).toEqual({ kind: "setup", credential: "abc", email: "user@example.com" });
  });

  test("keeps a shipped locale and ignores anything else (#231)", () => {
    const base = { kind: "setup" as const, credential: "abc", email: "user@example.com" };
    expect(parseAdmissionInput(admissionBeginInput, { ...base, locale: "pt-PT" })).toEqual({
      ...base,
      locale: "pt-PT" as const,
    });
    for (const locale of ["fr", "pt-BR", "", 5, null, "x".repeat(5000)]) {
      const parsed = parseAdmissionInput(admissionBeginInput, { ...base, locale });
      expect(parsed.locale).toBeUndefined();
      expect(parsed.email).toBe("user@example.com");
    }
  });

  test("raises a bare INVALID_INPUT with no echoed values", () => {
    try {
      parseAdmissionInput(admissionBeginInput, {
        kind: "bogus",
        credential: "leaky-secret",
        email: "x",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ORPCError);
      const orpc = error as ORPCError<string, unknown>;
      expect(orpc.code).toBe("INVALID_INPUT");
      expect(JSON.stringify(orpc.data ?? {})).not.toContain("leaky-secret");
      return;
    }
    throw new Error("expected a throw");
  });
});
