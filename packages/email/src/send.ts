import type { StructuredLogger } from "@openvalens/observability";

import { shouldAuditBcc } from "./audit-bcc";
import { EmailConfigError, extractDisplayName, type EmailConfig } from "./config";
import { createEmailLogger, maskEmailRecipient } from "./logging";
import {
  EmailPermanentError,
  EmailTransientError,
  ResendProvider,
  type EmailProvider,
  type ResendTag,
} from "./provider";

export type SendEmailInput = {
  to: string | string[];
  /** Defaults to `EMAIL_FROM` from config when omitted. */
  from?: string;
  replyTo?: string;
  bcc?: string | string[];
  subject: string;
  html: string;
  text: string;
  /** Template name used for logging + the audit-BCC allow-list. */
  templateName?: string;
  /** Resend tags; the first entry is used as the template name fallback. */
  tags?: string[];
};

export type SendEmailOptions = {
  correlationId?: string;
  dryRun?: boolean;
  /** Bound config from {@link createEmailService}; required by the unbound {@link sendEmail}. */
  config?: EmailConfig;
  /** Injectable for tests; defaults to {@link ResendProvider}. */
  provider?: EmailProvider;
  /** Injectable for tests; defaults to a `component: "email"` logger. */
  logger?: StructuredLogger;
};

export type SendEmailResult = { id: string; dryRun: boolean };

export type SendEmailFn = (
  input: SendEmailInput,
  options?: SendEmailOptions,
) => Promise<SendEmailResult>;

/**
 * A config-bound email sender plus its branding name. Created by
 * {@link createEmailService}; never exposes the raw config or API key.
 */
export type EmailService = {
  readonly sendEmail: SendEmailFn;
  readonly organizationName: string;
};

/**
 * Binds a validated {@link EmailConfig} to a {@link SendEmailFn}.
 *
 * The five config fields are copied into a frozen snapshot behind a closure, so
 * later mutation of the original object cannot change delivery. `defaults` are
 * merged first, then per-call options, then `config` (the snapshot unless the
 * call supplies its own). The returned object is frozen and exposes only
 * `sendEmail` and `organizationName`.
 */
export function createEmailService(
  config: EmailConfig,
  defaults: Omit<SendEmailOptions, "config"> = {},
): EmailService {
  const snapshot: EmailConfig = Object.freeze({
    RESEND_API_KEY: config.RESEND_API_KEY,
    EMAIL_FROM: config.EMAIL_FROM,
    EMAIL_REPLY_TO: config.EMAIL_REPLY_TO,
    EMAIL_AUDIT_BCC: config.EMAIL_AUDIT_BCC,
    EMAIL_DRY_RUN: config.EMAIL_DRY_RUN,
  });

  const boundSend: SendEmailFn = (input, options) =>
    sendEmail(input, {
      ...defaults,
      ...options,
      config: options?.config ?? snapshot,
    });

  return Object.freeze({
    sendEmail: boundSend,
    organizationName: extractDisplayName(snapshot.EMAIL_FROM) ?? "Health",
  });
}

function mergeBcc(
  base: string | string[] | undefined,
  extra: string | null,
): string | string[] | undefined {
  const values = new Set<string>();

  if (typeof base === "string") {
    values.add(base);
  } else if (Array.isArray(base)) {
    for (const value of base) {
      values.add(value);
    }
  }

  if (extra) {
    values.add(extra);
  }

  const list = [...values];

  if (list.length === 0) {
    return undefined;
  }

  return list.length === 1 ? list[0] : list;
}

/**
 * Sends a rendered email through Resend, or logs a dry-run event when no API
 * key is configured / `EMAIL_DRY_RUN` is on.
 *
 * The unbound export requires an explicit `options.config` — there is no
 * ambient fallback. Prefer {@link createEmailService}, which binds the config
 * once and preserves per-call overrides. A missing config fails with a
 * value-free {@link EmailConfigError} before any provider is constructed.
 *
 * All log lines are PHI-safe: masked recipients, subject, template name,
 * provider id and typed error codes only. The raw recipient, token and body are
 * never logged. Provider exceptions are re-thrown after logging so callers can
 * decide whether to retry.
 */
export async function sendEmail(
  input: SendEmailInput,
  options: SendEmailOptions & { config: EmailConfig },
): Promise<SendEmailResult> {
  const config = options?.config;

  if (!config) {
    // Value-free error: never echo the input, options, or a raw cause.
    throw new EmailConfigError(["email config is required"]);
  }

  const logger = options.logger ?? createEmailLogger(options.correlationId);
  const templateName = input.templateName ?? input.tags?.[0] ?? "unknown";
  const dryRun = options.dryRun ?? config.EMAIL_DRY_RUN;

  const recipients = Array.isArray(input.to) ? input.to : [input.to];
  const maskedRecipients = recipients.map(maskEmailRecipient);

  if (dryRun || !config.RESEND_API_KEY) {
    logger.info("email.send.dry-run", {
      correlationId: options.correlationId,
      templateName,
      recipients: maskedRecipients,
      subject: input.subject,
    });

    return { id: "dry-run", dryRun: true };
  }

  const auditBcc = shouldAuditBcc(templateName) ? config.EMAIL_AUDIT_BCC : null;
  const bcc = mergeBcc(input.bcc, auditBcc);
  const tags: ResendTag[] | undefined = input.tags?.map((value) => ({
    name: "tag",
    value,
  }));

  const provider = options.provider ?? new ResendProvider(config.RESEND_API_KEY);

  try {
    const { id } = await provider.send({
      from: input.from ?? config.EMAIL_FROM,
      to: input.to,
      replyTo: input.replyTo ?? config.EMAIL_REPLY_TO,
      bcc,
      subject: input.subject,
      html: input.html,
      text: input.text,
      tags,
    });

    logger.info("email.send.queued", {
      correlationId: options.correlationId,
      templateName,
      recipients: maskedRecipients,
      providerId: id,
    });

    return { id, dryRun: false };
  } catch (error) {
    const errorCode =
      error instanceof EmailTransientError
        ? error.code
        : error instanceof EmailPermanentError
          ? error.code
          : "EMAIL_UNKNOWN";

    logger.error("email.send.failed", {
      correlationId: options.correlationId,
      templateName,
      recipients: maskedRecipients,
      errorCode,
    });

    throw error;
  }
}
