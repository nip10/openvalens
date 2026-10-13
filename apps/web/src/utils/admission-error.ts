/**
 * Stable admission error classification (Issue #63).
 *
 * The server only emits a small set of oRPC codes. We map them to finite,
 * value-free local codes so UI copy stays controlled and never echoes the
 * submitted email, bearer or proof.
 */
export type AdmissionErrorCode =
  | "unavailable"
  | "closed"
  | "expired"
  | "denied"
  | "rate_limited"
  | "delivery_failed"
  | "invalid_input"
  | "session_mismatch"
  | "network"
  | "unknown";

export function classifyAdmissionError(error: unknown): AdmissionErrorCode {
  if (error === null || error === undefined) return "unknown";

  const code =
    typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  const status =
    typeof error === "object" && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;

  if (code === "RATE_LIMITED" || status === 429) return "rate_limited";
  if (code === "INVALID_INPUT" || status === 400) return "invalid_input";
  if (code === "UNAUTHENTICATED" || code === "UNAUTHORIZED" || status === 401)
    return "session_mismatch";
  if (code === "PERMISSION_DENIED" || code === "FORBIDDEN" || status === 403) return "denied";
  if (code === "INTERNAL" || status === 500) return "unknown";

  if (status === 0 || status === null || status === undefined) {
    // A fetch failure or abort with no HTTP status maps to network.
    return "network";
  }

  return "unknown";
}

export function isAdmissionPermissionDenied(error: unknown): boolean {
  const code = classifyAdmissionError(error);
  return code === "denied" || code === "session_mismatch";
}
