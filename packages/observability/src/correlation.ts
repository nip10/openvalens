/**
 * Correlation-id helpers (Issue #9).
 *
 * Resolves `x-correlation-id` → `x-request-id` → generated UUID, sanitizing
 * inbound values to `[a-zA-Z0-9._:-]` and at most 64 characters so untrusted
 * header content can never smuggle control characters or oversized payloads
 * into a log line.
 */

export const CORRELATION_ID_HEADER = "x-correlation-id";
export const REQUEST_ID_HEADER = "x-request-id";

const MAX_CORRELATION_ID_LENGTH = 64;
const INVALID_CORRELATION_CHARS = /[^a-zA-Z0-9._:-]+/g;

/**
 * Sanitizes an inbound correlation id.
 *
 * Invalid characters are collapsed to `-`, runs of `-` are collapsed, and the
 * result is truncated to 64 characters. When the sanitized value is empty a
 * UUID is generated instead.
 */
export function sanitizeCorrelationId(value: string): string {
  const trimmed = value.trim();
  const sanitized = trimmed.replace(INVALID_CORRELATION_CHARS, "-").replace(/-+/g, "-");
  return sanitized.slice(0, MAX_CORRELATION_ID_LENGTH) || crypto.randomUUID();
}

/**
 * Reads `x-correlation-id` → `x-request-id`, sanitizes it, and falls back to a
 * generated UUID when neither header is present.
 */
export function normalizeCorrelationHeader(headers: Headers): string {
  const preferred = headers.get(CORRELATION_ID_HEADER) ?? headers.get(REQUEST_ID_HEADER);
  return preferred ? sanitizeCorrelationId(preferred) : crypto.randomUUID();
}

/** Alias for {@link normalizeCorrelationHeader}. */
export function resolveCorrelationId(headers: Headers): string {
  return normalizeCorrelationHeader(headers);
}
