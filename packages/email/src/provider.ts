/**
 * Resend email provider (Issue #15).
 *
 * Resend is the only email transport (Issue #61): there is no alternate
 * provider path. Talks to the Resend HTTP API with plain `fetch` — no SDK
 * dependency. Errors are mapped to typed, categorized exceptions so callers can
 * decide whether a retry makes sense. Exception messages intentionally contain
 * only the HTTP status and the sanitized Resend error *name*: never the API
 * key, the recipient, or the message body.
 */

export type ResendTag = { name: string; value: string };

export type ResendSendInput = {
  from: string;
  to: string | string[];
  replyTo?: string;
  bcc?: string | string[];
  subject: string;
  html: string;
  text: string;
  tags?: ResendTag[];
};

export type ResendSendResult = { id: string };

export interface EmailProvider {
  send(input: ResendSendInput): Promise<ResendSendResult>;
}

/**
 * Delivery failure category (Issue #61). Every provider failure maps to exactly
 * one category so operators can tell a bad key from a provider outage from the
 * structured log alone, without the error message:
 *
 * - `network` — the request never got a response (DNS, TLS, connection reset).
 * - `timeout` — no response within the provider request timeout.
 * - `rate_limited` — HTTP 429 (per-second rate or quota exceeded).
 * - `provider_unavailable` — HTTP 5xx from the provider.
 * - `auth` — HTTP 401/403: missing/invalid API key or an unverified sender.
 * - `rejected` — any other 4xx: the provider refused this message as built.
 * - `unknown` — not a typed provider failure.
 *
 * Only `network`, `timeout`, `rate_limited` and `provider_unavailable` are
 * retryable; they surface as {@link EmailTransientError}.
 */
export type EmailDeliveryErrorCategory =
  | "network"
  | "timeout"
  | "rate_limited"
  | "provider_unavailable"
  | "auth"
  | "rejected"
  | "unknown";

/** Status `0` means no HTTP response was received. */
function categorizeStatus(
  status: number,
  providerError: string | null,
): EmailDeliveryErrorCategory {
  if (status === 0) {
    return providerError === "TimeoutError" || providerError === "AbortError"
      ? "timeout"
      : "network";
  }

  if (status === 429) {
    return "rate_limited";
  }

  if (status >= 500) {
    return "provider_unavailable";
  }

  if (status === 401 || status === 403) {
    return "auth";
  }

  if (status >= 400) {
    return "rejected";
  }

  return "unknown";
}

/** Only identifier-shaped provider error names survive; anything else is dropped. */
const SAFE_PROVIDER_ERROR_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * Reduces a provider-supplied error name to a log-safe identifier, or `null`.
 * Resend error names are snake_case identifiers (`validation_error`); anything
 * that is not identifier-shaped (free text, an echoed address) is discarded.
 */
export function sanitizeProviderErrorName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return SAFE_PROVIDER_ERROR_PATTERN.test(trimmed) ? trimmed : null;
}

/** Retryable provider failure (network failure, timeout, 429 or a 5xx response). */
export class EmailTransientError extends Error {
  readonly code = "EMAIL_TRANSIENT";
  readonly retryable = true;
  readonly status: number;
  readonly providerError: string | null;
  readonly category: EmailDeliveryErrorCategory;

  constructor(status: number, providerError?: string | null) {
    const safeProviderError = sanitizeProviderErrorName(providerError);
    super(
      `Resend provider transient error (status ${status}${
        safeProviderError ? `, error ${safeProviderError}` : ""
      })`,
    );
    this.name = "EmailTransientError";
    this.status = status;
    this.providerError = safeProviderError;
    this.category = categorizeStatus(status, safeProviderError);
  }
}

/** Non-retryable provider failure (a 4xx response other than 429). */
export class EmailPermanentError extends Error {
  readonly code = "EMAIL_PERMANENT";
  readonly retryable = false;
  readonly status: number;
  readonly providerError: string | null;
  readonly category: EmailDeliveryErrorCategory;

  constructor(status: number, providerError?: string | null) {
    const safeProviderError = sanitizeProviderErrorName(providerError);
    super(
      `Resend provider permanent error (status ${status}${
        safeProviderError ? `, error ${safeProviderError}` : ""
      })`,
    );
    this.name = "EmailPermanentError";
    this.status = status;
    this.providerError = safeProviderError;
    this.category = categorizeStatus(status, safeProviderError);
  }
}

/**
 * Value-free description of an email delivery failure, safe to spread into a
 * structured log line: typed code, category, retryability, HTTP status and the
 * sanitized provider error name. Never the message, recipient, body or key.
 */
export type EmailDeliveryErrorSummary = {
  errorCode: "EMAIL_TRANSIENT" | "EMAIL_PERMANENT" | "EMAIL_UNKNOWN";
  errorCategory: EmailDeliveryErrorCategory;
  retryable: boolean;
  status?: number;
  providerError?: string;
};

/** Summarizes any thrown value from a send into an {@link EmailDeliveryErrorSummary}. */
export function describeEmailDeliveryError(error: unknown): EmailDeliveryErrorSummary {
  if (error instanceof EmailTransientError || error instanceof EmailPermanentError) {
    return {
      errorCode: error.code,
      errorCategory: error.category,
      retryable: error.retryable,
      status: error.status,
      ...(error.providerError ? { providerError: error.providerError } : {}),
    };
  }

  return { errorCode: "EMAIL_UNKNOWN", errorCategory: "unknown", retryable: false };
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Reads only the Resend error `name` from the response body. The body's
 * `message` field is never surfaced because it may echo request content.
 */
async function readProviderErrorName(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { name?: unknown };
    return sanitizeProviderErrorName(body.name);
  } catch {
    return null;
  }
}

/** Upper bound on one Resend request; a hung connection becomes a `timeout`. */
export const DEFAULT_RESEND_TIMEOUT_MS = 10_000;

export type ResendProviderOptions = {
  /** Request timeout in milliseconds. Defaults to {@link DEFAULT_RESEND_TIMEOUT_MS}. */
  timeoutMs?: number;
};

export class ResendProvider implements EmailProvider {
  readonly #apiKey: string;
  readonly #timeoutMs: number;

  constructor(apiKey: string, options: ResendProviderOptions = {}) {
    this.#apiKey = apiKey;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_RESEND_TIMEOUT_MS;
  }

  async send(input: ResendSendInput): Promise<ResendSendResult> {
    let response: Response;

    try {
      response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        signal: AbortSignal.timeout(this.#timeoutMs),
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: input.from,
          to: input.to,
          subject: input.subject,
          html: input.html,
          text: input.text,
          ...(input.replyTo ? { reply_to: input.replyTo } : {}),
          ...(input.bcc ? { bcc: input.bcc } : {}),
          ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
        }),
      });
    } catch (error) {
      // Network-level failure or timeout — safe to retry. Only the error *name*
      // is kept (`TimeoutError` categorizes as `timeout`, anything else as
      // `network`).
      const name = error instanceof Error ? error.name : "network_error";
      throw new EmailTransientError(0, name);
    }

    if (!response.ok) {
      const providerError = await readProviderErrorName(response);

      if (response.status >= 500 || response.status === 429) {
        throw new EmailTransientError(response.status, providerError);
      }

      throw new EmailPermanentError(response.status, providerError);
    }

    const body = (await response.json().catch(() => ({}))) as { id?: unknown };
    const id = typeof body.id === "string" && body.id.length > 0 ? body.id : "unknown";

    return { id };
  }
}
