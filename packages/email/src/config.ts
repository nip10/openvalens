/**
 * Email configuration (Issue #15).
 *
 * The server owns the environment (`apps/server/.env.schema`); this package is
 * deliberately pure — {@link parseEmailConfig} takes the raw env object and
 * returns the validated shape. Callers bind the resulting config explicitly via
 * `createEmailService`; the package never reads the ambient environment itself.
 *
 * Validation never includes secret values in the thrown error; only the failing
 * variable names and the reason.
 */

import type { IntegrationStatus } from "@openvalens/config/integrations";

export type EmailConfig = {
  RESEND_API_KEY: string | null;
  EMAIL_FROM: string;
  EMAIL_REPLY_TO: string;
  EMAIL_AUDIT_BCC: string | null;
  EMAIL_DRY_RUN: boolean;
};

/** Raw env input accepted by {@link parseEmailConfig}. */
export type EmailEnv = Record<string, string | boolean | undefined>;

/**
 * Structured configuration error. The structured logger serializes `Error`
 * instances to `{ name, code? }`, so the message is never emitted.
 */
export class EmailConfigError extends Error {
  readonly code = "EMAIL_CONFIG_INVALID";
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`EMAIL_CONFIG_INVALID: ${issues.join("; ")}`);
    this.name = "EmailConfigError";
    this.issues = issues;
  }
}

const SIMPLE_EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const SENDER_WITH_DISPLAY_NAME_PATTERN = /^(.+?)\s*<([^<>]+)>$/;

function isValidEmailAddress(value: string): boolean {
  if (!SIMPLE_EMAIL_PATTERN.test(value)) {
    return false;
  }

  const [localPart, domain] = value.split("@");
  if (!localPart || !domain) {
    return false;
  }

  if (localPart.includes("..") || domain.includes("..")) {
    return false;
  }

  if (localPart.startsWith(".") || localPart.endsWith(".")) {
    return false;
  }

  if (domain.startsWith(".") || domain.endsWith(".")) {
    return false;
  }

  const labels = domain.split(".");
  if (labels.length < 2) {
    return false;
  }

  for (const label of labels) {
    if (!label || label.startsWith("-") || label.endsWith("-")) {
      return false;
    }
  }

  return true;
}

function isValidSender(value: string): boolean {
  if (isValidEmailAddress(value)) {
    return true;
  }

  const match = value.match(SENDER_WITH_DISPLAY_NAME_PATTERN);
  if (!match) {
    return false;
  }

  const displayName = match[1]?.trim();
  const email = match[2]?.trim();

  return Boolean(displayName) && Boolean(email) && isValidEmailAddress(email ?? "");
}

/** Extracts the bare address from `"Display Name <user@example.com>"` or a plain address. */
export function extractEmailAddress(value: string): string {
  const match = value.match(SENDER_WITH_DISPLAY_NAME_PATTERN);
  return (match?.[2] ?? value).trim();
}

/** Extracts the display name from `"Display Name <user@example.com>"`, or `null`. */
export function extractDisplayName(value: string): string | null {
  const match = value.match(SENDER_WITH_DISPLAY_NAME_PATTERN);
  const name = match?.[1]?.trim();
  return name && name.length > 0 ? name : null;
}

function readString(env: EmailEnv, name: string): string | null {
  const value = env[name];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(env: EmailEnv, name: string, fallback: boolean): boolean {
  const value = env[name];

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized.length === 0) {
    return fallback;
  }

  if (normalized === "true" || normalized === "1") {
    return true;
  }

  if (normalized === "false" || normalized === "0") {
    return false;
  }

  throw new EmailConfigError([`${name} must be a boolean string`]);
}

/**
 * Validates raw env into {@link EmailConfig}.
 *
 * - `EMAIL_FROM` is required and must be a plain address or `Name <address>`.
 * - `EMAIL_REPLY_TO` / `EMAIL_AUDIT_BCC` are optional but must be valid
 *   addresses when present.
 * - When `RESEND_API_KEY` is missing, `EMAIL_DRY_RUN` is forced to `true`.
 *
 * @throws {EmailConfigError} with code `EMAIL_CONFIG_INVALID`.
 */
export function parseEmailConfig(env: EmailEnv): EmailConfig {
  const issues: string[] = [];

  const rawFrom = readString(env, "EMAIL_FROM");
  if (!rawFrom) {
    issues.push("EMAIL_FROM is required");
  } else if (!isValidSender(rawFrom)) {
    issues.push("EMAIL_FROM must be a valid email address");
  }

  const rawReplyTo = readString(env, "EMAIL_REPLY_TO");
  if (rawReplyTo && !isValidEmailAddress(rawReplyTo)) {
    issues.push("EMAIL_REPLY_TO must be a valid email address");
  }

  const rawAuditBcc = readString(env, "EMAIL_AUDIT_BCC");
  if (rawAuditBcc && !isValidEmailAddress(rawAuditBcc)) {
    issues.push("EMAIL_AUDIT_BCC must be a valid email address");
  }

  const apiKey = readString(env, "RESEND_API_KEY");

  if (issues.length > 0) {
    throw new EmailConfigError(issues);
  }

  const from = rawFrom ?? "";
  const requestedDryRun = readBoolean(env, "EMAIL_DRY_RUN", true);

  return {
    RESEND_API_KEY: apiKey,
    EMAIL_FROM: from,
    EMAIL_REPLY_TO: rawReplyTo ?? extractEmailAddress(from),
    EMAIL_AUDIT_BCC: rawAuditBcc,
    // A missing key can never reach the provider, so dry-run is mandatory.
    EMAIL_DRY_RUN: apiKey === null ? true : requestedDryRun,
  };
}

/**
 * Issue #57 — value-free readiness status of the email family.
 *
 * Resend is the only transport (Issue #61), so the provider is always
 * `"resend"`. Email never reports `off`: with no key (the default) every send
 * is a logged dry run, which is the safe default that needs no vendor account.
 * `configured` means a key is present *and* `EMAIL_DRY_RUN` is off — the only
 * case in which mail actually leaves the server.
 */
export function describeEmailIntegration(config: EmailConfig): IntegrationStatus<"resend"> {
  return {
    provider: "resend",
    state: config.RESEND_API_KEY !== null && !config.EMAIL_DRY_RUN ? "configured" : "dry-run",
  };
}
