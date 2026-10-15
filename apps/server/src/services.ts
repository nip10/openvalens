import { describeAiIntegration, InMemoryRateLimiter, parseAiConfig } from "@openvalens/ai";
import { createProductSettingsService } from "@openvalens/api/product-settings";
import { createAuth, setRegisteredAuth } from "@openvalens/auth";
import { createAdmissionService } from "@openvalens/auth/admission";
import { describeOidcIntegration, oidcSignInOption, parseOidcConfig } from "@openvalens/auth/oidc";
import { createDb } from "@openvalens/db";
import type { IntegrationStatuses } from "@openvalens/config/integrations";
import { createEmailService, describeEmailIntegration, parseEmailConfig } from "@openvalens/email";
import { createStructuredLogger } from "@openvalens/observability";
import {
  describeTelegramIntegration,
  parseTelegramConfig,
  TelegramClient,
} from "@openvalens/telegram";

import { ENV } from "./env.server";

export const db = createDb(ENV);

// Issue #58 — product display-settings service. Stateless and bound to the
// shared database: every call reads the current row, so no value is cached
// across requests. The API package never reads the environment or opens its own
// connection.
export const productSettingsService = createProductSettingsService({ db });

// Issue #58 — server-side email instantiation. The `@openvalens/email` package
// stays pure; the server binds the five validated email fields explicitly
// (never casting the whole `ENV`) and composes a frozen `EmailService` before
// `createAuth` so the auth callbacks receive an injected sender. The raw
// config/API key are never exposed on the service.
export const emailConfig = parseEmailConfig({
  RESEND_API_KEY: ENV.RESEND_API_KEY,
  EMAIL_FROM: ENV.EMAIL_FROM,
  EMAIL_REPLY_TO: ENV.EMAIL_REPLY_TO,
  EMAIL_AUDIT_BCC: ENV.EMAIL_AUDIT_BCC,
  EMAIL_DRY_RUN: ENV.EMAIL_DRY_RUN,
});

export const email = createEmailService(emailConfig);

// Legacy alias for the config-bound sender. Unused across the repo; retained
// for external compatibility. `EmailService.sendEmail` already preserves
// per-call overrides.
export const sendEmail = email.sendEmail;

// Issue #65 — one optional generic OIDC provider. Off unless every required
// key is set; an incomplete set logs the missing key *names* (never a value)
// and keeps sign-in magic-link only rather than failing the boot.
export const oidcConfig = parseOidcConfig({
  OIDC_PROVIDER_ID: ENV.OIDC_PROVIDER_ID,
  OIDC_CLIENT_ID: ENV.OIDC_CLIENT_ID,
  OIDC_CLIENT_SECRET: ENV.OIDC_CLIENT_SECRET,
  OIDC_DISCOVERY_URL: ENV.OIDC_DISCOVERY_URL,
  OIDC_DISPLAY_NAME: ENV.OIDC_DISPLAY_NAME,
});

if (oidcConfig.missingKeys.length > 0) {
  createStructuredLogger({ level: "info" }).warn("auth.oidc.config.incomplete", {
    missingKeys: [...oidcConfig.missingKeys],
  });
}

/** Public "Continue with <name>" option for the sign-in screens, or `null`. */
export const signInOptions = Object.freeze({ oidc: oidcSignInOption(oidcConfig) });

// Issue #58 — auth must be constructed only after the email service exists.
export const auth = createAuth(ENV, db, { email, oidc: oidcConfig.provider });

// Issue #14 — server-side Telegram instantiation. The `@openvalens/telegram`
// package stays pure; the server binds the validated `ENV` here. The client is
// `null` when no bot token is configured, which disables delivery.
export const telegramConfig = parseTelegramConfig(ENV);

export const telegramClient = telegramConfig.TELEGRAM_BOT_TOKEN
  ? new TelegramClient(telegramConfig.TELEGRAM_BOT_TOKEN, {
      apiBaseUrl: telegramConfig.TELEGRAM_API_BASE_URL,
    })
  : null;

/** Webhook secret expected in `X-Telegram-Bot-Api-Secret-Token`. */
export function telegramWebhookSecret(): string {
  return telegramConfig.TELEGRAM_WEBHOOK_SECRET;
}

// Issue #13 — server-side AI instantiation. The `@openvalens/ai` package stays
// pure; the server binds the validated `ENV` to it here. `AI_PROVIDER` selects
// Anthropic or an OpenAI-compatible endpoint (Issue #59); when AI is off,
// readiness reports `ai: off` and `ai.chat` fails closed instead of calling a
// provider.
export const aiConfig = parseAiConfig(ENV);

// Process-local sliding-window limiter keyed by `(userId, organizationId)`.
// TODO(#13-rate-limit): swap for Redis so limits are shared across replicas.
export const aiRateLimiter = new InMemoryRateLimiter({
  limitPerMinute: aiConfig.AI_RATE_LIMIT_PER_MINUTE,
});

/**
 * Integration family statuses (Issue #57).
 *
 * Every optional external service is an adapter in the package that owns its
 * domain, selected by env and bound here. Each family reports a value-free
 * `{ provider, state }` on the readiness probe. With no vendor credentials the
 * server boots with every family at its safe default: email `dry-run`, AI,
 * messaging and OIDC `off`. See `docs/integrations.md`.
 */
export const integrations = Object.freeze({
  email: describeEmailIntegration(emailConfig),
  ai: describeAiIntegration(aiConfig),
  messaging: describeTelegramIntegration(telegramConfig),
  oidc: describeOidcIntegration(oidcConfig),
}) satisfies IntegrationStatuses;

/**
 * Readiness capability flags (Issue #11).
 *
 * `mobilePairing` is always available in this platform layer; the integration
 * flags are derived from {@link integrations} and are `true` only when the
 * family is `configured`. `resend` (Issue #61) is therefore `true` only when
 * email is actually delivered: a key is configured *and* `EMAIL_DRY_RUN` is
 * off. A key alone with the default dry-run would otherwise advertise delivery
 * that never happens. `anthropic` is `true` only when Anthropic is the
 * configured AI provider; an OpenAI-compatible endpoint (Issue #59) shows up as
 * `integrations.ai.provider` instead.
 */
export const capabilities = {
  telegram: integrations.messaging.state === "configured",
  anthropic: integrations.ai.provider === "anthropic",
  resend: integrations.email.state === "configured",
  mobilePairing: true,
};

// Register the auth singleton so the guards in `@openvalens/auth/authz/*`
// can resolve the active Better Auth instance without it being threaded
// through every call site.
setRegisteredAuth(auth);

// ─── Admission (Issue #63) ──────────────────────────────────────
//
// The admission core is pure; the server injects the Resend-backed email
// delivery callbacks here. The verification code / invitation bearer appear in
// the message body only (never a URL, never logged), and the template names are
// deliberately outside the audit-BCC allow-list so credentials are never BCC'd.
// A dry-run send is treated as a generic delivery failure — never a claimed
// delivery.

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const admissionService = createAdmissionService({
  db,
  deliverVerification: async ({ email: recipient, verificationCode }) => {
    const result = await email.sendEmail({
      to: recipient,
      subject: "Verify your email for OpenValens",
      text: `Your verification code is ${verificationCode}. It expires in 10 minutes.`,
      html: `<p>Your verification code is <strong>${escapeHtml(verificationCode)}</strong>.</p><p>It expires in 10 minutes.</p>`,
      templateName: "admission-verification",
      tags: ["admission-verification"],
    });

    if (result.dryRun) {
      throw new Error("Admission verification email was not delivered.");
    }
  },
  deliverInvitation: async ({ email: recipient, invitationToken }) => {
    const result = await email.sendEmail({
      to: recipient,
      subject: "You\u2019re invited to OpenValens",
      text: `You have been invited to OpenValens. Your invitation token is ${invitationToken}.`,
      html: `<p>You have been invited to OpenValens.</p><p>Your invitation token is <strong>${escapeHtml(invitationToken)}</strong>.</p>`,
      templateName: "admission-invitation",
      tags: ["admission-invitation"],
    });

    if (result.dryRun) {
      throw new Error("Admission invitation email was not delivered.");
    }
  },
});

// Process-local admission limiter with fixed endpoint keys (see `@openvalens/api`).
export const admissionRateLimiter = new InMemoryRateLimiter({ limitPerMinute: 20 });
