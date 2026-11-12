/** @jsxImportSource react */
import { msg } from "@lingui/core/macro";

import { emailI18n, renderLayout, renderParagraphs, type EmailRenderOptions } from "./layout";

const APP_NAME = "OpenValens";

export type AiAppKeyCreatedEmailInput = {
  /** The member's own name for the key (a user value, not translated). */
  keyName: string;
  /** `ov_` and six characters: enough to recognise the key, never the key. */
  keyPrefix: string;
  workspaceName: string;
  /** When the key was created, already formatted for the recipient. */
  createdAt: string;
  /** When it stops working, already formatted; `null` for a key that never expires. */
  expiresAt: string | null;
  /** Settings page where the member can revoke it. */
  manageUrl: string;
};

export type RenderedAiAppKeyCreatedEmail = { subject: string; html: string; text: string };

/**
 * Security notice sent when a personal API key for AI apps is created (#439),
 * in the member's language. It names the key, never the key itself, and tells
 * the member how to revoke it if they did not create it. Revoking and expiry
 * send nothing.
 */
export async function renderAiAppKeyCreatedEmail(
  input: AiAppKeyCreatedEmailInput,
  options: EmailRenderOptions = {},
): Promise<RenderedAiAppKeyCreatedEmail> {
  const i18n = emailI18n(options);
  const { keyName, keyPrefix, workspaceName, createdAt, expiresAt } = input;
  const appName = APP_NAME;

  const subject = i18n._(msg`A new personal API key was created for ${appName}`);
  const bodyLines = [
    i18n._(
      msg`A personal API key named "${keyName}" (${keyPrefix}…) was created on ${createdAt} for the workspace ${workspaceName}.`,
    ),
    i18n._(
      msg`Anything this key reads goes to the AI app or script that uses it, under that app's own terms.`,
    ),
    expiresAt
      ? i18n._(msg`The key stops working on ${expiresAt}.`)
      : i18n._(msg`The key does not expire. It works until you revoke it.`),
    i18n._(msg`Not you? Revoke the key now from Connected AI apps in your settings.`),
  ];

  const layout = await renderLayout(
    {
      title: i18n._(msg`New personal API key`),
      preheader: i18n._(msg`A key that can read your records was just created.`),
      bodyHtml: renderParagraphs(bodyLines),
      bodyText: bodyLines.join("\n\n"),
      ctaLabel: i18n._(msg`Review your keys`),
      ctaUrl: input.manageUrl,
      footerText: i18n._(msg`This is an automated security notice from ${appName}.`),
    },
    options,
  );

  return { subject, html: layout.html, text: layout.text };
}
