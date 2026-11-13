import type { Database } from "@openvalens/db";
import { organization, user } from "@openvalens/db/schema/auth";
import type { EmailService } from "@openvalens/email";
import { renderAiAppConnectedEmail } from "@openvalens/email/templates/ai-app-connected";
import { renderAiAppKeyCreatedEmail } from "@openvalens/email/templates/ai-app-key-created";
import type { MessageLocales } from "@openvalens/i18n/server";
import type { AiAppKeyCreatedEvent, AiAppOAuthConnectedEvent } from "@openvalens/mcp";
import { eq } from "drizzle-orm";

/**
 * Issue #439 — the security email sent when a personal API key is created,
 * in the member's language. It names the key (and its `ov_xxxxxx` prefix),
 * the workspace and the expiry, never the key itself, and links to the
 * settings page where the member can revoke it. Revoking and expiry send
 * nothing.
 */

/** Web settings page listing connected AI apps and personal keys. */
export const AI_APPS_SETTINGS_PATH = "/settings/ai-apps";

function formatDate(locale: string, value: Date, withTime: boolean): string {
  const formatter = new Intl.DateTimeFormat(locale === "pt-PT" ? "pt-PT" : "en-GB", {
    dateStyle: "long",
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone: "UTC",
  });
  return `${formatter.format(value)}${withTime ? " UTC" : ""}`;
}

export function createAiAppKeyCreatedEmail(deps: {
  db: Database;
  email: Pick<EmailService, "sendEmail" | "organizationName">;
  locales: MessageLocales;
  /** Web app origin (`CORS_ORIGIN`). */
  webOrigin: string;
}): (event: AiAppKeyCreatedEvent) => Promise<void> {
  return async (event) => {
    const [account] = await deps.db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, event.userId))
      .limit(1);
    const [workspace] = await deps.db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, event.organizationId))
      .limit(1);
    if (!account?.email) return;
    const locale = await deps.locales.forUser(event.userId);
    const message = await renderAiAppKeyCreatedEmail(
      {
        keyName: event.label,
        keyPrefix: event.displayPrefix,
        workspaceName: workspace?.name ?? "OpenValens",
        createdAt: formatDate(locale, event.createdAt, true),
        expiresAt: event.expiresAt ? formatDate(locale, event.expiresAt, false) : null,
        manageUrl: `${new URL(deps.webOrigin).origin}${AI_APPS_SETTINGS_PATH}`,
      },
      { locale, organizationName: deps.email.organizationName },
    );
    await deps.email.sendEmail({
      to: account.email,
      subject: message.subject,
      html: message.html,
      text: message.text,
      templateName: "ai-app-key-created",
      tags: ["ai-app-key-created"],
    });
  };
}

/**
 * Issue #439 (M1b) — the security email sent when a member connects an AI app
 * with OAuth, in the member's language: the app's own (unverified) name and
 * client-id host, the workspace and the time, with a link to revoke it.
 */
export function createAiAppConnectedEmail(deps: {
  db: Database;
  email: Pick<EmailService, "sendEmail" | "organizationName">;
  locales: MessageLocales;
  /** Web app origin (`CORS_ORIGIN`). */
  webOrigin: string;
}): (event: AiAppOAuthConnectedEvent) => Promise<void> {
  return async (event) => {
    const [account] = await deps.db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, event.userId))
      .limit(1);
    const [workspace] = await deps.db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, event.organizationId))
      .limit(1);
    if (!account?.email) return;
    const locale = await deps.locales.forUser(event.userId);
    const message = await renderAiAppConnectedEmail(
      {
        appName: event.label,
        clientIdHost: event.clientIdHost,
        workspaceName: workspace?.name ?? "OpenValens",
        connectedAt: formatDate(locale, event.createdAt, true),
        manageUrl: `${new URL(deps.webOrigin).origin}${AI_APPS_SETTINGS_PATH}`,
      },
      { locale, organizationName: deps.email.organizationName },
    );
    await deps.email.sendEmail({
      to: account.email,
      subject: message.subject,
      html: message.html,
      text: message.text,
      templateName: "ai-app-connected",
      tags: ["ai-app-connected"],
    });
  };
}
