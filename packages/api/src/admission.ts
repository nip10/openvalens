import { isAdmissionError, type AdmissionService } from "@openvalens/auth/admission";
import { z } from "zod";

import type { Context } from "./context";
import { o } from "./index";
import { raiseApiError } from "./errors";

/**
 * Admission HTTP boundary (Issue #63).
 *
 * The admission core is pure; this module owns every transport concern:
 * same-origin enforcement on mutations, fixed-key rate limiting, generic error
 * mapping and value-free input validation. Nothing here reads the environment,
 * the email provider or the database directly.
 */

/** Fixed, endpoint-scoped rate-limit keys — never attacker-supplied ids/IPs. */
export const ADMISSION_RATE_LIMIT_KEYS = {
  begin: "admission:begin",
  complete: "admission:complete",
  issue: "admission:issue",
  revoke: "admission:revoke",
} as const;

export type AdmissionRateLimitKey =
  (typeof ADMISSION_RATE_LIMIT_KEYS)[keyof typeof ADMISSION_RATE_LIMIT_KEYS];

/**
 * Rejects a mutation unless the request `Origin` header exactly equals the
 * server-configured, normalized web origin. Runs before input validation and
 * before the service is touched. A missing/foreign origin is a generic
 * `403 PERMISSION_DENIED`; a missing configured origin or service is a generic
 * `INTERNAL` (fail closed, never a fake allow).
 */
export function requireAdmissionOrigin(context: Context): void {
  const allowed = context.admissionOrigin;
  if (!allowed) {
    throw raiseApiError("INTERNAL", "Something went wrong.");
  }

  const origin = context.honoContext.req.raw.headers.get("origin");
  if (origin !== allowed) {
    throw raiseApiError("PERMISSION_DENIED", "You do not have permission to perform this action.");
  }
}

/** Resolves the server-injected admission service or fails closed. */
export function requireAdmissionService(context: Context): AdmissionService {
  const service = context.admissionService;
  if (!service) {
    throw raiseApiError("INTERNAL", "Something went wrong.");
  }
  return service;
}

/** Applies the process-local limiter for a fixed endpoint key. */
export function checkAdmissionRateLimit(context: Context, key: AdmissionRateLimitKey): void {
  const limiter = context.admissionRateLimiter;
  if (!limiter) {
    throw raiseApiError("INTERNAL", "Something went wrong.");
  }

  if (!limiter.check(key).allowed) {
    throw raiseApiError("RATE_LIMITED", "Too many attempts; try again later.");
  }
}

/**
 * Maps an admission-core failure to a stable, value-free envelope. Anything
 * that is not an `AdmissionError` becomes a generic `INTERNAL`.
 */
export function mapAdmissionError(error: unknown): never {
  if (isAdmissionError(error)) {
    switch (error.code) {
      case "DENIED":
        throw raiseApiError(
          "PERMISSION_DENIED",
          "You do not have permission to perform this action.",
        );
      case "RATE_LIMITED":
        throw raiseApiError("RATE_LIMITED", "Too many attempts; try again later.");
      case "EMAIL_UNAVAILABLE":
        throw raiseApiError(
          "EMAIL_UNAVAILABLE",
          "Email delivery is not configured on this server.",
        );
      case "DELIVERY_FAILED":
      case "INTERNAL":
        throw raiseApiError("INTERNAL", "Something went wrong.");
    }
  }

  throw raiseApiError("INTERNAL", "Something went wrong.");
}

/**
 * Value-free input validation for secret-bearing admission inputs.
 *
 * Unlike the shared `validateInput`, this never attaches a Zod `flatten()`
 * payload (which can echo submitted values). A failure is a bare generic
 * `INVALID_INPUT`.
 */
export function safeAdmissionInput<T extends z.ZodType>(schema: T) {
  return o.middleware(async ({ next }, input) => {
    parseAdmissionInput(schema, input);
    return next({});
  });
}

/**
 * Validates `input` against `schema` and returns the parsed value, raising a
 * bare `INVALID_INPUT` (no Zod `flatten`, no echoed values) on failure.
 */
export function parseAdmissionInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw raiseApiError("INVALID_INPUT", "Invalid input");
  }
  return parsed.data as z.infer<T>;
}

const setupKind = z.enum(["setup", "invitation"]);

export const admissionBeginInput = z.object({
  kind: setupKind,
  credential: z.string().min(1).max(512),
  email: z.string().min(1).max(320),
});

export const admissionCompleteInput = z.object({
  enrollmentId: z.string().min(1).max(200),
  credential: z.string().min(1).max(512),
  verificationCode: z.string().min(1).max(512),
});

export const admissionIssueInput = z.object({
  email: z.string().min(1).max(320),
});

export const admissionRevokeInput = z.object({
  invitationId: z.string().min(1).max(200),
});
