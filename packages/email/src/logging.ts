import { createStructuredLogger, type StructuredLogger } from "@openhealth/observability";

const RECIPIENT_MASK = "***";

/**
 * Masks an email address so a recipient can be correlated in logs without the
 * raw address ever being emitted (PHI-safe posture from Issue #9).
 *
 * `patient@example.com` → `p***@example.com`.
 */
export function maskEmailRecipient(email: string): string {
  const value = email.trim();
  const atIndex = value.indexOf("@");

  if (atIndex <= 0 || atIndex === value.length - 1) {
    return RECIPIENT_MASK;
  }

  const localPart = value.slice(0, atIndex);
  const domain = value.slice(atIndex + 1);

  return `${localPart.slice(0, 1)}${RECIPIENT_MASK}@${domain}`;
}

/**
 * Creates a structured logger tagged with `component: "email"` and, when
 * provided, the request `correlationId`.
 *
 * Callers must only pass PHI-safe metadata: the masked recipient, the subject,
 * template name, provider id and typed error codes. Never the raw recipient,
 * the token, or the HTML/text body (the logger additionally drops the blocked
 * fields from Issue #9).
 */
export function createEmailLogger(correlationId?: string): StructuredLogger {
  const context: Record<string, unknown> = { component: "email" };

  if (correlationId) {
    context.correlationId = correlationId;
  }

  return createStructuredLogger({ level: "info", context });
}
