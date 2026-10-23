// TODO(#15): migrate to React Email if/when the react-email dep family is
// adopted. Plain functions keep the `{ subject, html, text }` contract stable.
import { msg, plural } from "@lingui/core/macro";

import { emailI18n, renderLayout, renderParagraphs, type EmailRenderOptions } from "./layout";

const APP_NAME = "Health";

export type MagicLinkEmailInput = {
  url: string;
  correlationId?: string;
  expiresInMinutes?: number;
};

export type RenderedMagicLinkEmail = {
  subject: string;
  html: string;
  text: string;
};

/** The subject in `options.locale` (English by default). */
export function magicLinkEmailSubject(options: EmailRenderOptions = {}): string {
  const appName = APP_NAME;
  return emailI18n(options)._(msg`Sign in to ${appName}`);
}

/** Text in the recipient's language (#231); `options.locale` defaults to English. */
export function renderMagicLinkEmail(
  input: MagicLinkEmailInput,
  options: EmailRenderOptions = {},
): RenderedMagicLinkEmail {
  const i18n = emailI18n(options);
  const appName = APP_NAME;
  const minutes = input.expiresInMinutes;
  const expiresLine = minutes
    ? i18n._(
        msg`${plural(minutes, {
          one: "For your security, this link expires in # minute.",
          other: "For your security, this link expires in # minutes.",
        })}`,
      )
    : i18n._(msg`For your security, this link expires soon.`);

  const subject = magicLinkEmailSubject(options);
  const bodyLines = [
    i18n._(msg`You requested a secure sign-in link for ${appName}.`),
    i18n._(msg`Use the button below to continue.`),
    expiresLine,
    i18n._(msg`If you did not request this email, you can safely ignore it.`),
  ];
  const url = input.url;

  // The URL is server-built, so only HTML-escaping is applied — the query
  // string (which carries the token) is never re-encoded.
  const layout = renderLayout(
    {
      title: i18n._(msg`Secure sign-in link`),
      preheader: i18n._(msg`Use this link to securely sign in to ${appName}.`),
      bodyHtml: renderParagraphs(bodyLines),
      bodyText: [
        ...bodyLines,
        i18n._(msg`If the button does not work, paste this link into your browser: ${url}`),
      ].join("\n\n"),
      ctaLabel: i18n._(msg`Sign in`),
      ctaUrl: url,
      footerText: i18n._(msg`This is an automated security message from ${appName}.`),
    },
    options,
  );

  return { subject, html: layout.html, text: layout.text };
}
