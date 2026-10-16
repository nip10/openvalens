/**
 * Push transport contract (Issue #92).
 *
 * One small interface for the `push` integration family. The only adapter is
 * the Expo push service (`providers/expo.ts`, plain `fetch`, no SDK), which
 * forwards to APNs and FCM. OpenValens never talks to APNs/FCM directly.
 *
 * A push message is deliberately minimal: a title, a body and an in-app path.
 * Callers build the text from fixed, value-free copy (see the insight
 * presenter); this package never sees a health value and never logs a token
 * or message text.
 */

export type PushMessage = {
  /** Expo push tokens of one person's registered phones. */
  to: readonly string[];
  title: string;
  body: string;
  /** In-app path opened when the notification is tapped, e.g. `/`. */
  path: string;
};

/** Per-token outcome. `unregistered` means the phone uninstalled or revoked push. */
export type PushTicket =
  | { token: string; status: "ok" }
  | { token: string; status: "unregistered" }
  | { token: string; status: "error"; errorName: string | null };

export interface PushProvider {
  readonly id: "expo";
  send(message: PushMessage): Promise<PushTicket[]>;
}

/**
 * Delivery failure category, mirroring the email family:
 * `network`, `timeout`, `rate_limited`, `provider_unavailable` (retryable) and
 * `auth`, `rejected`, `unknown` (not retryable).
 */
export type PushDeliveryErrorCategory =
  | "network"
  | "timeout"
  | "rate_limited"
  | "provider_unavailable"
  | "auth"
  | "rejected"
  | "unknown";

function categorize(status: number, name: string | null): PushDeliveryErrorCategory {
  if (status === 0) return name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  if (status === 401 || status === 403) return "auth";
  if (status >= 400) return "rejected";
  return "unknown";
}

const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Keeps only identifier-shaped provider error names (`DeviceNotRegistered`). */
export function sanitizePushErrorName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return SAFE_NAME.test(trimmed) ? trimmed : null;
}

/** A whole-request failure (no per-token tickets). Messages carry no payload. */
export class PushDeliveryError extends Error {
  readonly code = "PUSH_DELIVERY";
  readonly status: number;
  readonly category: PushDeliveryErrorCategory;
  readonly retryable: boolean;
  readonly providerError: string | null;

  constructor(status: number, providerError?: string | null) {
    const safe = sanitizePushErrorName(providerError);
    super(`Push provider error (status ${status}${safe ? `, error ${safe}` : ""})`);
    this.name = "PushDeliveryError";
    this.status = status;
    this.providerError = safe;
    this.category = categorize(status, safe);
    this.retryable = ["network", "timeout", "rate_limited", "provider_unavailable"].includes(
      this.category,
    );
  }
}

export type PushDeliveryErrorSummary = {
  errorCode: "PUSH_DELIVERY" | "PUSH_UNKNOWN";
  errorCategory: PushDeliveryErrorCategory;
  retryable: boolean;
  status?: number;
  providerError?: string;
};

/** Value-free summary of any thrown send failure, safe for a structured log. */
export function describePushDeliveryError(error: unknown): PushDeliveryErrorSummary {
  if (error instanceof PushDeliveryError) {
    return {
      errorCode: error.code,
      errorCategory: error.category,
      retryable: error.retryable,
      status: error.status,
      ...(error.providerError ? { providerError: error.providerError } : {}),
    };
  }
  return { errorCode: "PUSH_UNKNOWN", errorCategory: "unknown", retryable: false };
}
