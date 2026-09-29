import {
  EmailPermanentError,
  EmailTransientError,
  sendEmail as defaultSendEmail,
  type SendEmailFn,
} from "@openhealth/email";
import { createStructuredLogger } from "@openhealth/observability";

import { buildMagicLinkSuccessLogMetadata } from "./auth-logging";
import { renderMagicLinkEmail } from "./email/templates/magic-link";

const DEFAULT_EXPIRES_IN_SECONDS = 600;
const CORRELATION_ID_MAX_LENGTH = 64;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const TOKEN_FINGERPRINT_LENGTH = 16;

export type MagicLinkPayload = {
  url: string;
  email: string;
  token: string;
  correlationId?: unknown;
  requestId?: unknown;
};

export type MagicLinkLogger = {
  info(event: string, metadata?: Record<string, unknown>): void;
  error(event: string, metadata?: Record<string, unknown>): void;
};

export type SendAuthMagicLinkOptions = {
  expiresInSeconds?: number;
  logger?: MagicLinkLogger;
  /** Injectable for tests; defaults to the `@openhealth/email` sender. */
  sendEmail?: SendEmailFn;
};

function generateCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Sanitizes a correlation id to `[A-Za-z0-9._:-]`, at most 64 characters,
 * mirroring the structured logger from Issue #9.
 */
export function normalizeCorrelationId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > CORRELATION_ID_MAX_LENGTH) {
    return null;
  }

  if (!CORRELATION_ID_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

/**
 * Resolves `x-correlation-id` → `x-request-id` → generated UUID. The header
 * values are extracted by the caller and passed in as `correlationId` /
 * `requestId`.
 */
export function resolveMagicLinkCorrelationId(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return generateCorrelationId();
  }

  const input = payload as Record<string, unknown>;
  const normalized =
    normalizeCorrelationId(input.correlationId) ?? normalizeCorrelationId(input.requestId);

  return normalized ?? generateCorrelationId();
}

async function fingerprintToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );

  return hex.slice(0, TOKEN_FINGERPRINT_LENGTH);
}

function parseLinkLocation(url: string): { host: string; path: string } | null {
  try {
    const parsed = new URL(url);
    return { host: parsed.host, path: parsed.pathname };
  } catch {
    return null;
  }
}

function errorCodeFor(error: unknown): string {
  if (error instanceof EmailTransientError) {
    return "EMAIL_TRANSIENT";
  }

  if (error instanceof EmailPermanentError) {
    return "EMAIL_PERMANENT";
  }

  return "EMAIL_UNKNOWN";
}

/**
 * Magic-link sender (Issue #15).
 *
 * Renders the magic-link email and hands it to the `@openhealth/email`
 * transport (Resend, or dry-run when unconfigured), while emitting a PHI-safe
 * structured log line. The raw token and the full URL (whose query string
 * carries the token) are never logged — only the link host/path, a sha256
 * fingerprint of the token, the recipient (masked), the correlation id and the
 * expiry.
 *
 * A permanent provider failure is swallowed (magic-link is a best-effort
 * signal; the user can retry) while a transient failure is re-thrown so the
 * caller can surface/retry it.
 */
export async function sendAuthMagicLink(
  payload: MagicLinkPayload,
  options: SendAuthMagicLinkOptions = {},
): Promise<void> {
  const correlationId = resolveMagicLinkCorrelationId(payload);
  const expiresInSeconds = options.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS;
  const logger = options.logger ?? createStructuredLogger({ level: "info" });
  const emailSender = options.sendEmail ?? defaultSendEmail;

  const rendered = renderMagicLinkEmail({
    url: payload.url,
    correlationId,
    expiresInMinutes: Math.round(expiresInSeconds / 60),
  });

  const tokenFingerprint = await fingerprintToken(payload.token);
  const location = parseLinkLocation(payload.url);
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

  const { event, ...metadata } = buildMagicLinkSuccessLogMetadata({
    email: payload.email,
    correlationId,
    linkHost: location?.host,
    linkPath: location?.path,
    tokenFingerprint,
    expiresInSeconds,
    expiresAt,
  });

  try {
    await emailSender(
      {
        to: payload.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        templateName: "magic-link",
        tags: ["magic-link"],
      },
      { correlationId },
    );
  } catch (error) {
    // Issue #9 — PHI-safe: only the typed code is logged, never the message.
    logger.error("auth.magic-link.send.failed", {
      ...metadata,
      code: errorCodeFor(error),
    });

    if (error instanceof EmailPermanentError) {
      return;
    }

    throw error;
  }

  // Issue #9 — PHI-safe structured log. The logger drops BLOCKED_FIELDS
  // recursively, so the raw token/URL never reach the log even if a caller
  // slips them into the metadata.
  logger.info(event, {
    ...metadata,
    subject: rendered.subject,
    sender: "resend",
  });
}
