/** @jsxImportSource react */
import { msg } from "@lingui/core/macro";

import { emailI18n, renderLayout, renderParagraphs, type EmailRenderOptions } from "./layout";

const APP_NAME = "OpenValens";

export type AiAppConnectedEmailInput = {
  /** The app's self-declared name (unverified; a client value, not translated). */
  appName: string;
  /** Host of the app's client id URL, or `null` for a dynamically registered app. */
  clientIdHost: string | null;
  workspaceName: string;
  /** When the connection was approved, already formatted for the recipient. */
  connectedAt: string;
  /** Settings page where the member can revoke it. */
  manageUrl: string;
};

export type RenderedAiAppConnectedEmail = { subject: string; html: string; text: string };

/**
 * Security notice sent when a member connects an AI app with OAuth (#439,
 * M1b), in the member's language. It names the app as the app describes
 * itself (unverified), the workspace and the time, and tells the member how
 * to revoke it if they did not approve it. Revoking sends nothing.
 */
export async function renderAiAppConnectedEmail(
  input: AiAppConnectedEmailInput,
  options: EmailRenderOptions = {},
): Promise<RenderedAiAppConnectedEmail> {
  const i18n = emailI18n(options);
  const { appName, clientIdHost, workspaceName, connectedAt } = input;
  const productName = APP_NAME;

  const subject = i18n._(msg`A new AI app was connected to ${productName}`);
  const bodyLines = [
    clientIdHost
      ? i18n._(
          msg`An AI app calling itself "${appName}" (from ${clientIdHost}) was connected on ${connectedAt} to the workspace ${workspaceName}.`,
        )
      : i18n._(
          msg`An AI app calling itself "${appName}" was connected on ${connectedAt} to the workspace ${workspaceName}.`,
        ),
    i18n._(
      msg`Anything this connection reads goes to that app, under the app's own terms. The app's name is not verified.`,
    ),
    i18n._(msg`Not you? Revoke the connection now from Connected AI apps in your settings.`),
  ];

  const layout = await renderLayout(
    {
      title: i18n._(msg`New AI app connection`),
      preheader: i18n._(msg`An app that can read your records was just connected.`),
      bodyHtml: renderParagraphs(bodyLines),
      bodyText: bodyLines.join("\n\n"),
      ctaLabel: i18n._(msg`Review your connections`),
      ctaUrl: input.manageUrl,
      footerText: i18n._(msg`This is an automated security notice from ${productName}.`),
    },
    options,
  );

  return { subject, html: layout.html, text: layout.text };
}
