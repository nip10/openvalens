/**
 * Check whether a configuration-query failure is an authz/authn rejection.
 * The server is expected to send oRPC error codes/statuses; we treat
 * permission-denied and unauthenticated responses as denials rather than
 * generic retryable errors.
 */
export function isConfigPermissionDenied(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const code = (error as { code?: unknown }).code;
  if (
    code === "PERMISSION_DENIED" ||
    code === "UNAUTHENTICATED" ||
    code === "FORBIDDEN" ||
    code === "UNAUTHORIZED"
  ) {
    return true;
  }

  const status = (error as { status?: unknown }).status;
  if (status === 401 || status === 403) return true;

  return false;
}
