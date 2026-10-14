/**
 * TanStack Query retry policy shared by web and mobile (Issue #134). No
 * imports: safe for the app bundle.
 *
 * A 4xx means the request itself is wrong (invalid input, unauthenticated,
 * forbidden, not found, rate limited). Retrying it only repeats the failure,
 * so it fails immediately. Network failures and 5xx keep the TanStack
 * default of three retries.
 */
export const MAX_QUERY_RETRIES = 3;

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const { status } = error as { status: unknown };
  return typeof status === "number" ? status : null;
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status = errorStatus(error);
  if (status !== null && status >= 400 && status < 500) return false;
  return failureCount < MAX_QUERY_RETRIES;
}
