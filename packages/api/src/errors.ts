import { ORPCError } from "@orpc/server";

/**
 * Stable machine-readable error codes for the oRPC surface.
 *
 * Mirrors `anchovy/apps/web/src/lib/api/errors.ts` — the codes are part of the
 * client contract (web + mobile) and must not be renamed without a coordinated
 * client release.
 */
export type ORPCErrorCode =
  | "UNAUTHENTICATED"
  | "NO_MEMBERSHIP"
  | "PERMISSION_DENIED"
  | "AI_DISABLED"
  | "TENANT_VIOLATION"
  | "INVALID_INPUT"
  | "INTERNAL"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "REAUTH_REQUIRED"
  | "CONFLICT"
  /** An optional upstream data source (e.g. live food lookup) timed out or is rate-limited. Retryable. */
  | "SOURCE_UNAVAILABLE"
  /** The server cannot send email (no Resend key, or dry run), so emailed-code flows can't start. */
  | "EMAIL_UNAVAILABLE";

/** HTTP statuses reachable through the error envelope. */
export type ORPCErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

const CODE_TO_STATUS: Record<ORPCErrorCode, ORPCErrorStatus> = {
  UNAUTHENTICATED: 401,
  NO_MEMBERSHIP: 403,
  PERMISSION_DENIED: 403,
  AI_DISABLED: 403,
  TENANT_VIOLATION: 403,
  INVALID_INPUT: 400,
  INTERNAL: 500,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  REAUTH_REQUIRED: 403,
  CONFLICT: 409,
  SOURCE_UNAVAILABLE: 503,
  EMAIL_UNAVAILABLE: 503,
};

/**
 * Maps a stable envelope code to its HTTP status. Mirrors the anchovy
 * `apiError(status, ...)` call sites.
 */
export function codeToStatus(code: ORPCErrorCode): ORPCErrorStatus {
  return CODE_TO_STATUS[code];
}

/**
 * Constructs an `ORPCError` carrying the `{ code, message, data }` envelope.
 *
 * Use this instead of `new ORPCError(...)` so every procedure error keeps the
 * same shape and status mapping across web + mobile clients.
 */
export function raiseApiError(
  code: ORPCErrorCode,
  message: string,
  data?: unknown,
): ORPCError<ORPCErrorCode, unknown> {
  return new ORPCError(code, {
    status: codeToStatus(code),
    message,
    data,
  });
}
