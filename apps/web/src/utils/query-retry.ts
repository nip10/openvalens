/**
 * TanStack Query retry policy (#134).
 *
 * A 4xx is a request the server has already judged wrong — invalid input,
 * missing session, forbidden — and repeating it only replays the same answer.
 * Those fail on the first attempt; network failures and 5xx keep the default
 * bounded budget. 408 and 429 are transient by definition and stay retryable.
 */
export const MAX_QUERY_RETRIES = 3;

const TRANSIENT_CLIENT_STATUSES = new Set([408, 429]);

function errorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  const { status } = error;
  return typeof status === "number" ? status : null;
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  const status = errorStatus(error);
  if (status !== null && status >= 400 && status < 500) {
    return TRANSIENT_CLIENT_STATUSES.has(status);
  }
  return true;
}
