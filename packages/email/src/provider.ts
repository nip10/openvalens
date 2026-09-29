/**
 * Resend email provider (Issue #15).
 *
 * Talks to the Resend HTTP API with plain `fetch` — no SDK dependency. Errors
 * are mapped to typed exceptions so callers can decide whether a retry makes
 * sense. Exception messages intentionally contain only the HTTP status and the
 * Resend error *name*: never the API key, the recipient, or the message body.
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

/** Retryable provider failure (network failure or a 5xx response). */
export class EmailTransientError extends Error {
  readonly code = "EMAIL_TRANSIENT";
  readonly status: number;
  readonly providerError: string | null;

  constructor(status: number, providerError?: string | null) {
    super(
      `Resend provider transient error (status ${status}${
        providerError ? `, error ${providerError}` : ""
      })`,
    );
    this.name = "EmailTransientError";
    this.status = status;
    this.providerError = providerError ?? null;
  }
}

/** Non-retryable provider failure (a 4xx response). */
export class EmailPermanentError extends Error {
  readonly code = "EMAIL_PERMANENT";
  readonly status: number;
  readonly providerError: string | null;

  constructor(status: number, providerError?: string | null) {
    super(
      `Resend provider permanent error (status ${status}${
        providerError ? `, error ${providerError}` : ""
      })`,
    );
    this.name = "EmailPermanentError";
    this.status = status;
    this.providerError = providerError ?? null;
  }
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Reads only the Resend error `name` from the response body. The body's
 * `message` field is never surfaced because it may echo request content.
 */
async function readProviderErrorName(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { name?: unknown };
    return typeof body.name === "string" && body.name.trim().length > 0 ? body.name.trim() : null;
  } catch {
    return null;
  }
}

export class ResendProvider implements EmailProvider {
  readonly #apiKey: string;

  constructor(apiKey: string) {
    this.#apiKey = apiKey;
  }

  async send(input: ResendSendInput): Promise<ResendSendResult> {
    let response: Response;

    try {
      response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
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
      // Network-level failure — safe to retry. Only the error *name* is kept.
      const name = error instanceof Error ? error.name : "network_error";
      throw new EmailTransientError(0, name);
    }

    if (!response.ok) {
      const providerError = await readProviderErrorName(response);

      if (response.status >= 500) {
        throw new EmailTransientError(response.status, providerError);
      }

      throw new EmailPermanentError(response.status, providerError);
    }

    const body = (await response.json().catch(() => ({}))) as { id?: unknown };
    const id = typeof body.id === "string" && body.id.length > 0 ? body.id : "unknown";

    return { id };
  }
}
